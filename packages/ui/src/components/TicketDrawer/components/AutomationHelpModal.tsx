import { useEffect, useRef, useSyncExternalStore } from 'react'

import { useFocusTrap } from '../../../useFocusTrap'
import { getCommandPrefixSnapshot, getSkillPrefixSnapshot, subscribeCommandPrefix, subscribeSkillPrefix } from '../../../api'
import { pluginCommand } from '../../../commands'

interface AutomationHelpModalProps {
  onClose: () => void
}

export function AutomationHelpModal({ onClose }: AutomationHelpModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const commandPrefix = useSyncExternalStore(subscribeCommandPrefix, getCommandPrefixSnapshot)
  const skillPrefix = useSyncExternalStore(subscribeSkillPrefix, getSkillPrefixSnapshot)

  useFocusTrap(panelRef)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        event.stopPropagation()
        onClose()
      }}
    >
      <div
        className="modal automation-help-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="automation-help-title"
        ref={panelRef}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="automation-help-title">Automation levels</h2>
          <button className="btn" type="button" onClick={onClose} aria-label="Close (Esc)">
            Close
          </button>
        </div>
        <div className="modal-body">
          <ul className="automation-help-levels">
            <li className="automation-help-level lv-express">
              <p>
                <strong>Express</strong>
                The agent skips steps it judges unnecessary (often interview / mock / design); each skip is recorded as a fast-pass you can review and reopen.
              </p>
            </li>
            <li className="automation-help-level lv-normal">
              <p>
                <strong>Normal</strong>
                The standard flow; every step runs.
              </p>
            </li>
            <li className="automation-help-level lv-manual">
              <p>
                <strong>Manual</strong>
                Excluded from batch runs (Run (N) / Next-all); only a named <code>{`${pluginCommand('next', commandPrefix, skillPrefix)} <id>`}</code> advances it — fully hand-driven.
              </p>
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}
