import { DatabaseIcon, PlugIcon } from '../../components/Icons'
import type { Connection } from '../../../shared/rpc'

/**
 * Every not-connected state. The stale case gets a real explanation rather than an
 * error, because losing the connection on navigation is how per-click activeTab
 * access is designed to work — not a malfunction.
 */
export function ConnectScreen({ connection }: { connection: Connection }) {
  const stale = connection.status === 'stale'

  return (
    <main className="connect-screen">
      <div className="brand-mark">{stale ? <PlugIcon /> : <DatabaseIcon />}</div>

      {stale ? (
        <>
          <h1>Reconnect to continue</h1>
          <p>
            {connection.origin ?? 'That page'} reloaded or navigated away, which ends the extension's
            access to it.
          </p>
          <p className="connect-hint">Click the extension icon on that tab again to reconnect.</p>
        </>
      ) : (
        <>
          <h1>Pick a tab to inspect</h1>
          <p>Click the extension icon on the tab whose IndexedDB you want to browse.</p>
          <p className="connect-hint">
            Access is granted per click and covers only that tab, so nothing is read until you ask.
          </p>
        </>
      )}

      {connection.error && (
        <div className="inline-error" role="alert">
          {connection.error}
        </div>
      )}
    </main>
  )
}
