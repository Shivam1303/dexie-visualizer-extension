import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MSG_GET_CONNECTION, MSG_RPC, OPS, type Connection } from '../src/shared/rpc'

type RuntimeListener = (
  message: any,
  sender: unknown,
  sendResponse: (response: any) => void,
) => boolean | undefined

let runtimeListener: RuntimeListener
let actionClick: (tab: { id?: number }) => Promise<void>
let tabUpdate: (
  tabId: number,
  info: { status?: string; url?: string },
  tab: { url?: string },
) => Promise<void>
let tabsCreate: ReturnType<typeof vi.fn>
let tabsSendMessage: ReturnType<typeof vi.fn>
let executeScript: ReturnType<typeof vi.fn>

beforeEach(async () => {
  vi.resetModules()

  const saved: Connection = {
    tabId: 42,
    origin: 'https://example.test',
    title: 'Example',
    status: 'connected',
  }
  tabsCreate = vi.fn().mockResolvedValue(undefined)
  executeScript = vi.fn().mockResolvedValue(undefined)
  tabsSendMessage = vi.fn().mockImplementation((_tabId, message) =>
    message.op === OPS.HELLO
      ? Promise.resolve({
          ok: true,
          data: { origin: 'https://example.test', title: 'Example' },
        })
      : Promise.resolve({ ok: true, data: ['restored'] }),
  )

  ;(globalThis as any).chrome = {
    action: { onClicked: { addListener: vi.fn((listener) => (actionClick = listener)) } },
    runtime: {
      getURL: vi.fn((path) => `chrome-extension://test/${path}`),
      onMessage: { addListener: vi.fn((listener) => (runtimeListener = listener)) },
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
    scripting: { executeScript },
    storage: {
      session: {
        get: vi.fn().mockResolvedValue({ connection: saved }),
        set: vi.fn().mockResolvedValue(undefined),
      },
    },
    tabs: {
      create: tabsCreate,
      onRemoved: { addListener: vi.fn() },
      onUpdated: { addListener: vi.fn((listener) => (tabUpdate = listener)) },
      sendMessage: tabsSendMessage,
    },
  }

  await import('../src/background/background')
})

function sendToBackground(message: any): Promise<any> {
  return new Promise((resolve) => {
    expect(runtimeListener(message, {}, resolve)).toBe(true)
  })
}

describe('background connection persistence', () => {
  it('opens a full-page visualizer after connecting the clicked site tab', async () => {
    await actionClick({ id: 7 })

    expect(tabsSendMessage).toHaveBeenCalledWith(7, { op: OPS.HELLO, args: {} })
    expect(tabsCreate).toHaveBeenCalledWith({
      url: 'chrome-extension://test/src/panel/index.html',
    })
  })

  it('restores the connected tab before answering connection and RPC messages', async () => {
    await expect(sendToBackground({ type: MSG_GET_CONNECTION })).resolves.toMatchObject({
      tabId: 42,
      status: 'connected',
    })

    await expect(
      sendToBackground({ type: MSG_RPC, payload: { op: OPS.LIST_DATABASES, args: {} } }),
    ).resolves.toEqual({ ok: true, data: ['restored'] })
    expect(tabsSendMessage).toHaveBeenCalledWith(42, {
      op: OPS.LIST_DATABASES,
      args: {},
    })
  })

  it('keeps the connection and reinjects the bridge after same-origin navigation', async () => {
    const url = 'https://example.test/orders/42'
    await tabUpdate(42, { status: 'loading', url }, { url })

    await expect(sendToBackground({ type: MSG_GET_CONNECTION })).resolves.toMatchObject({
      tabId: 42,
      status: 'connected',
    })
    expect(executeScript).not.toHaveBeenCalled()

    await tabUpdate(42, { status: 'complete' }, { url })

    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 42 },
      files: ['content.js'],
    })
    await expect(sendToBackground({ type: MSG_GET_CONNECTION })).resolves.toMatchObject({
      tabId: 42,
      origin: 'https://example.test',
      status: 'connected',
    })
  })

  it('marks the connection stale when the tab moves to another origin', async () => {
    const url = 'https://other.test/account'
    await tabUpdate(42, { status: 'loading', url }, { url })

    await expect(sendToBackground({ type: MSG_GET_CONNECTION })).resolves.toMatchObject({
      tabId: 42,
      status: 'stale',
      error: expect.stringMatching(/different site/i),
    })
    expect(executeScript).not.toHaveBeenCalled()
  })
})
