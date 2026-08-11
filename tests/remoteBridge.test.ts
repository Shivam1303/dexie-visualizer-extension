import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRemoteBridgeSource } from '../src/datasource/remoteBridge'
import { encode } from '../src/shared/codec'

let sendMessage: ReturnType<typeof vi.fn>

beforeEach(() => {
  sendMessage = vi.fn()
  ;(globalThis as any).chrome = { runtime: { sendMessage } }
})

describe('RemoteBridgeSource', () => {
  it('wraps calls in an RPC envelope', async () => {
    sendMessage.mockResolvedValue({ ok: true, data: encode([{ name: 'POSdb', version: 5 }]) })
    const result = await createRemoteBridgeSource().listDatabases()
    expect(sendMessage).toHaveBeenCalledWith({ type: 'RPC', payload: { op: 'LIST_DATABASES', args: {} } })
    expect(result).toEqual([{ name: 'POSdb', version: 5 }])
  })

  it('decodes tagged values back into real types', async () => {
    sendMessage.mockResolvedValue({
      ok: true,
      data: encode({ rows: [{ key: 'u1', value: { at: new Date(0) } }], total: 1, page: 0, pageSize: 50 }),
    })
    const page = await createRemoteBridgeSource().query('db', 'store', { page: 0, pageSize: 50 })
    expect((page.rows[0].value as any).at).toBeInstanceOf(Date)
  })

  it('cancels a remote query when its signal is aborted', async () => {
    sendMessage.mockImplementation(({ payload }) => {
      if (payload.op === 'CANCEL_QUERY') {
        return Promise.resolve({ ok: true, data: encode(undefined) })
      }
      return new Promise(() => {})
    })
    const controller = new AbortController()
    const pending = createRemoteBridgeSource().query(
      'db',
      'store',
      { page: 0, pageSize: 50 },
      { signal: controller.signal },
    )
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'RPC',
      payload: {
        op: 'CANCEL_QUERY',
        args: { requestId: expect.stringMatching(/^query-/) },
      },
    })
  })

  it('rejects with the relay error message', async () => {
    sendMessage.mockResolvedValue({ ok: false, error: 'No tab is connected.' })
    await expect(createRemoteBridgeSource().listDatabases()).rejects.toThrow('No tab is connected.')
  })

  it('rejects when the relay returns nothing at all', async () => {
    sendMessage.mockResolvedValue(undefined)
    await expect(createRemoteBridgeSource().listDatabases()).rejects.toThrow(/did not respond/i)
  })

  it('passes patches through on update', async () => {
    sendMessage.mockResolvedValue({ ok: true, data: encode({ name: 'x' }) })
    await createRemoteBridgeSource().update('db', 'store', 'k', [{ path: ['name'], value: 'x' }])
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'RPC',
      payload: {
        op: 'PATCH',
        args: {
          dbName: 'db',
          storeName: 'store',
          key: 'k',
          patches: [{ path: ['name'], value: 'x' }],
        },
      },
    })
  })

  it('encodes a Date primary key so it survives the trip', async () => {
    sendMessage.mockResolvedValue({ ok: true, data: encode(undefined) })
    await createRemoteBridgeSource().deleteRow('db', 'store', new Date('2026-01-01T00:00:00.000Z'))
    const { args } = sendMessage.mock.calls[0][0].payload
    expect(args.key).toEqual({ __dvxT: 'date', v: '2026-01-01T00:00:00.000Z' })
  })
})
