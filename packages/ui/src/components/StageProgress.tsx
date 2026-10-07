// Build-stage progress for a multi-stage ticket, read from `extras.buildStages`.
// `bar` = the compact card strip (Stage N / total + segments); `rail` = the
// drawer's per-stage list. Renders nothing when the ticket is single-pass.

import { BUILD_STAGE_STATUSES } from '@lfad/core/build-stages'

import type { BuildStage, BuildStages } from '../types'

type StageState = 'done' | 'now' | 'pending'
type StageStatus = BuildStage['status']

interface RenderStage {
  key: string
  title: string
  status: StageStatus | null
}

interface RenderStages {
  total: number
  current: number
  items: RenderStage[]
}

const BUILD_STAGE_STATUS_SET = new Set<string>(BUILD_STAGE_STATUSES)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stageStatus(value: unknown): StageStatus | null {
  return typeof value === 'string' && BUILD_STAGE_STATUS_SET.has(value)
    ? value as StageStatus
    : null
}

/** Keep malformed hand-authored markers renderable without changing valid output. */
function renderStages(value: unknown): RenderStages | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null
  const items = value.items.map((raw, index): RenderStage => {
    const item = isRecord(raw) ? raw : {}
    return {
      key: typeof item.key === 'string' && item.key.length > 0 ? item.key : `stage-${index + 1}`,
      title: typeof item.title === 'string' ? item.title : `Stage ${index + 1}`,
      status: stageStatus(item.status),
    }
  })
  const total = typeof value.total === 'number'
    && Number.isInteger(value.total)
    && value.total === items.length
    ? value.total
    : items.length
  const current = typeof value.current === 'number' && Number.isInteger(value.current)
    ? Math.min(Math.max(value.current, 1), Math.max(total, 1))
    : 1
  return { total, current, items }
}

/** Segment/dot state per stage, folding the flight index into the item status. */
function segState(item: RenderStage): StageState {
  if (item.status === 'approved') return 'done'
  if (item.status === 'building' || item.status === 'review' || item.status === 'changes') return 'now'
  return 'pending'
}

export function StageBar({ stages }: { stages: BuildStages }) {
  const view = renderStages(stages)
  if (view === null || view.total <= 1) return null
  const now = view.items.find((item) => segState(item) === 'now')
  return (
    <div className="stage-bar">
      <div className="stage-bar-head">
        <span className="stage-count">
          Stage <b>{view.current}</b> / {view.total}
        </span>
        {now !== undefined && <span className="stage-now">{now.title}</span>}
      </div>
      <div className="stage-segs" role="img" aria-label={`Stage ${view.current} of ${view.total}`}>
        {view.items.map((item) => (
          <span key={item.key} className={`stage-seg stage-seg-${segState(item)}`} />
        ))}
      </div>
    </div>
  )
}

export function StageRail({ stages }: { stages: BuildStages }) {
  const view = renderStages(stages)
  if (view === null || view.total <= 1) return null
  const doneCount = view.items.filter((item) => item.status === 'approved').length
  return (
    <div className="stage-rail">
      <div className="stage-rail-cap">
        <span>Build stages</span>
        <span>{doneCount} / {view.total} approved</span>
      </div>
      {view.items.map((item, i) => {
        const state = segState(item)
        return (
          <div key={item.key} className={`stage-row ${state === 'now' ? 'is-cur' : ''}`}>
            <span className={`stage-dot stage-dot-${state}`} />
            <span className="stage-idx">{String(i + 1).padStart(2, '0')}</span>
            <span className="stage-row-title">{item.title}</span>
            <span className={item.status === null ? 'stage-status' : `stage-status stage-status-${item.status}`}>
              {item.status ?? 'unknown'}
            </span>
          </div>
        )
      })}
    </div>
  )
}
