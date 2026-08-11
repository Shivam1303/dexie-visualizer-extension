import type { SourceMode } from '../store'
import { ChevronIcon } from './Icons'

export function WorkspaceHeader({
  contextDisplay,
  contextLabel,
  onBackToOverview,
  sourceMode,
}: {
  contextDisplay?: string
  contextLabel?: string
  onBackToOverview?: () => void
  sourceMode: SourceMode
}) {
  return (
    <header className="topbar">
      {onBackToOverview && (
        <button className="overview-back" onClick={onBackToOverview} type="button">
          <ChevronIcon direction="left" />
          Back to overview
        </button>
      )}
      <div className={`live-status ${sourceMode}`} role="status" title={contextLabel ?? ''}>
        <span className={sourceMode === 'live' ? 'live-dot' : 'local-dot'} />
        <span>{sourceMode === 'live' ? 'Live editing' : 'Local copy'}</span>
        <strong>{contextDisplay}</strong>
      </div>
    </header>
  )
}
