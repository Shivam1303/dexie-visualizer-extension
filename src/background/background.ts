/**
 * Tracks the single connected site tab and relays RPC between the full-page
 * visualizer and that tab's content script.
 */
import {
  ERROR_NO_TAB,
  MSG_CONNECTION_CHANGED,
  MSG_GET_CONNECTION,
  MSG_RPC,
  NO_CONNECTION,
  OPS,
  type Connection,
} from '../shared/rpc'

const CONTENT_SCRIPT_PATH = 'content.js'
const WORKSPACE_PATH = 'src/panel/index.html'
const CONNECTION_STORAGE_KEY = 'connection'

let connection: Connection = { ...NO_CONNECTION }

// MV3 service workers are routinely suspended between events. Keep the selected
// tab in session storage so waking the worker does not look like a disconnect.
// Session storage is cleared when the browser exits, matching activeTab's lifetime.
const connectionReady = chrome.storage.session
  .get(CONNECTION_STORAGE_KEY)
  .then((stored) => {
    const saved = stored[CONNECTION_STORAGE_KEY] as Connection | undefined
    if (saved) connection = saved
  })
  .catch(() => {})

async function broadcast(): Promise<void> {
  // Rejects when no visualizer tab is listening, which is normal and not an error.
  await chrome.runtime.sendMessage({ type: MSG_CONNECTION_CHANGED, connection }).catch(() => {})
}

async function setConnection(next: Connection): Promise<void> {
  connection = next
  await chrome.storage.session.set({ [CONNECTION_STORAGE_KEY]: connection })
  await broadcast()
}

async function injectBridge(tabId: number): Promise<{ origin: string; title: string }> {
  await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT_PATH] })
  const hello = await chrome.tabs.sendMessage(tabId, { op: OPS.HELLO, args: {} })
  if (!hello?.ok) throw new Error(hello?.error ?? 'The content script did not respond.')
  return hello.data
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return
  const tabId = tab.id

  await connectionReady

  try {
    const page = await injectBridge(tabId)
    await setConnection({
      tabId,
      origin: page.origin,
      title: page.title,
      status: 'connected',
    })
  } catch (error: any) {
    await setConnection({
      ...NO_CONNECTION,
      error: `Can't connect to this page. ${error?.message ?? ''}`.trim(),
    })
  } finally {
    // Open only after injection so the activeTab grant still targets the site the
    // user clicked, not this extension-owned workspace.
    await chrome.tabs.create({ url: chrome.runtime.getURL(WORKSPACE_PATH) })
  }
})

function originOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

// Chrome retains activeTab access while the selected tab stays on the same origin.
// A full navigation replaces the document (and therefore the content script), so
// reinject the bridge after loading without forcing the user to reconnect.
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  await connectionReady
  if (tabId !== connection.tabId || !connection.origin) return

  const nextOrigin = originOf(info.url ?? tab.url)
  if (nextOrigin && nextOrigin !== connection.origin) {
    await setConnection({
      ...connection,
      status: 'stale',
      error: 'The connected tab moved to a different site. Click the extension icon there to reconnect.',
    })
    return
  }

  if (info.status !== 'complete') return

  try {
    const page = await injectBridge(tabId)
    if (page.origin !== connection.origin || connection.tabId !== tabId) return
    await setConnection({
      ...connection,
      title: page.title,
      status: 'connected',
      error: undefined,
    })
  } catch (error: any) {
    if (connection.tabId !== tabId) return
    await setConnection({
      ...connection,
      status: 'stale',
      error: `Could not reconnect after navigation. ${error?.message ?? ''}`.trim(),
    })
  }
})

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await connectionReady
  if (tabId === connection.tabId) await setConnection({ ...NO_CONNECTION })
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === MSG_GET_CONNECTION) {
    void connectionReady.then(() => sendResponse(connection))
    return true
  }

  if (message?.type !== MSG_RPC) return undefined

  void connectionReady.then(async () => {
    if (connection.status !== 'connected' || connection.tabId === null) {
      sendResponse({ ok: false, error: connection.error ?? ERROR_NO_TAB })
      return
    }

    try {
      const response = await chrome.tabs.sendMessage(connection.tabId, message.payload)
      sendResponse(response ?? { ok: false, error: 'The page did not respond.' })
    } catch (error: any) {
      // The content script is gone (navigation, crash, or the tab closed).
      await setConnection({ ...connection, status: 'stale' })
      sendResponse({ ok: false, error: error?.message ?? 'Lost contact with the page.' })
    }
  })

  return true
})
