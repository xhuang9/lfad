import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Cog } from 'lucide-react'

import { applyTheme, storedTheme, type ThemeChoice } from '../theme'
import { getBoardLayoutSnapshot, getCommandPrefixSnapshot, loadBoardLayout, loadCommandPrefix, setBoardLayout, setCommandPrefix, subscribeBoardLayout, subscribeCommandPrefix, type BoardLayout, type CommandPrefix } from '../api'

const MENU_ID = 'topbar-settings-menu'

interface SettingsMenuProps {
  onConfigurePrompts: () => void
}

export function SettingsMenu({ onConfigurePrompts }: SettingsMenuProps) {
  const [open, setOpen] = useState(false)
  const [prefixAvailable, setPrefixAvailable] = useState(true)
  const [layoutAvailable, setLayoutAvailable] = useState(true)
  const [theme, setTheme] = useState<ThemeChoice>(storedTheme)
  const prefix = useSyncExternalStore(subscribeCommandPrefix, getCommandPrefixSnapshot)
  const layout = useSyncExternalStore(subscribeBoardLayout, getBoardLayoutSnapshot)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    loadCommandPrefix().then(() => setPrefixAvailable(true)).catch(() => setPrefixAvailable(false))
    loadBoardLayout().then(() => setLayoutAvailable(true)).catch(() => setLayoutAvailable(false))
  }, [])

  useEffect(() => {
    if (!open) return

    const dismissOutside = (event: PointerEvent): void => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const dismissOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }

    document.addEventListener('pointerdown', dismissOutside)
    document.addEventListener('keydown', dismissOnEscape)
    return () => {
      document.removeEventListener('pointerdown', dismissOutside)
      document.removeEventListener('keydown', dismissOnEscape)
    }
  }, [open])

  const choosePrefix = (choice: CommandPrefix): void => {
    setCommandPrefix(choice).then(() => setPrefixAvailable(true)).catch(() => setPrefixAvailable(false))
  }

  const chooseLayout = (choice: BoardLayout): void => {
    setBoardLayout(choice).then(() => setLayoutAvailable(true)).catch(() => setLayoutAvailable(false))
  }

  const chooseTheme = (choice: ThemeChoice): void => {
    applyTheme(choice)
    setTheme(choice)
  }

  const configurePrompts = (): void => {
    setOpen(false)
    onConfigurePrompts()
  }

  return (
    <div className="settings-menu" ref={wrapperRef}>
      <button
        ref={triggerRef}
        className={`btn topbar-icon settings-trigger ${open ? 'is-open' : ''}`}
        type="button"
        onClick={() => setOpen((current) => !current)}
        title="Settings"
        aria-label="Settings"
        aria-haspopup="menu"
        aria-controls={MENU_ID}
        aria-expanded={open}
      >
        <Cog aria-hidden="true" focusable="false" />
      </button>
      {open ? (
        <div id={MENU_ID} className="settings-popover" role="menu" aria-label="Settings">
          <div className="settings-label">Theme</div>
          <div className="settings-prefix" role="group" aria-label="Theme">
            {([['system', 'System'], ['light', 'Light'], ['dark', 'Dark']] as const).map(([choice, label]) => (
              <button key={choice} className={`settings-prefix-btn ${theme === choice ? 'on' : ''}`} type="button" onClick={() => chooseTheme(choice)} aria-pressed={theme === choice}>
                {label}
              </button>
            ))}
          </div>
          <div className="settings-divider" />
          <div className="settings-label">Command prefix</div>
          <div className="settings-prefix" role="group" aria-label="Command target" title={prefixAvailable ? 'Copied command prefix' : 'Requires a daemon restart'}>
            {([['/', 'Claude Code'], ['$', 'Codex']] as const).map(([choice, label]) => (
              <button key={choice} className={`settings-prefix-btn ${prefix === choice ? 'on' : ''}`} type="button" onClick={() => choosePrefix(choice)} aria-pressed={prefix === choice} disabled={!prefixAvailable}>
                {label} <b>{choice}</b>
              </button>
            ))}
          </div>
          <div className="settings-note">Command target applies to copied board commands.</div>
          <div className="settings-divider" />
          <div className="settings-label">Layout</div>
          <div className="settings-prefix settings-layout" role="group" aria-label="Board layout" title={layoutAvailable ? 'Board arrangement and drawer position' : 'Requires a daemon restart'}>
            {([['auto', 'Auto'], ['landscape', 'Landscape'], ['portrait', 'Portrait']] as const).map(([choice, label]) => (
              <button key={choice} className={`settings-prefix-btn ${layout === choice ? 'on' : ''}`} type="button" onClick={() => chooseLayout(choice)} aria-pressed={layout === choice} disabled={!layoutAvailable}>
                {label}
              </button>
            ))}
          </div>
          <div className="settings-note">Auto follows the window shape; Landscape splits side-by-side, Portrait stacks.</div>
          <div className="settings-divider" />
          <div className="settings-label">Action prompts</div>
          <button className="settings-prompts" type="button" role="menuitem" onClick={configurePrompts} aria-label="Configure run button prompts">
            <span>Run button prompts</span>
            <span className="settings-prompts-chevron" aria-hidden="true">›</span>
          </button>
          <div className="settings-note settings-prompts-note">Edits the prompts behind the Run button.</div>
        </div>
      ) : null}
    </div>
  )
}
