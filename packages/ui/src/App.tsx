import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { getCommandPrefixSnapshot, getKeywordSettings, getManual, getPromptTemplates, getSkillPrefixSnapshot, subscribeCommandPrefix, subscribeSkillPrefix } from './api'
import { DEFAULT_KEYWORD_SETTINGS, normalizeKeyword } from './keywords'
import { DEFAULT_PROMPT_TEMPLATES, renderRunAllPrompt, type PromptTemplates } from './prompts'
import type { Category, KeywordSettings } from './types'
import { useBoard } from './useBoard'
import { useRoute } from './useRoute'
import { Archive } from './components/Archive'
import { Parked } from './components/Parked'
import { Board } from './components/Board'
import { Dashboard } from './components/Dashboard'
import { ManualModal } from './components/ManualModal'
import { NewIdeaModal } from './components/NewIdeaModal'
import { KeywordModal } from './components/keywords/KeywordModal'
import { PromptModal } from './components/prompts/PromptModal'
import { Sidebar } from './components/Sidebar'
import type { View } from './components/Sidebar'
import { TicketDrawer } from './components/TicketDrawer'
import { TopBar } from './components/TopBar'
import { useCopied } from './useCopied'
import { isNeedsActionOrHeld } from './needsAction'
import { isRunnableInBatch } from './runnable'
import { useSystemStores } from './useSystemStores'

export function App() {
  const { steps, tickets, error, refresh, version } = useBoard()
  const nextAll = useCopied()
  const commandPrefix = useSyncExternalStore(subscribeCommandPrefix, getCommandPrefixSnapshot)
  const skillPrefix = useSyncExternalStore(subscribeSkillPrefix, getSkillPrefixSnapshot)
  useEffect(() => { getManual().catch(() => undefined) }, [])
  const { route, navigate } = useRoute()
  const [view, setView] = useState<View>('board')
  const [collapsed, setCollapsed] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<Set<Category>>(new Set())
  const [keywordFilter, setKeywordFilter] = useState<Set<string>>(new Set())
  const [keywords, setKeywords] = useState<KeywordSettings>(DEFAULT_KEYWORD_SETTINGS)
  const [keywordsOpen, setKeywordsOpen] = useState(false)
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplates>(DEFAULT_PROMPT_TEMPLATES)
  const [promptsOpen, setPromptsOpen] = useState(false)
  const [needsActionOn, setNeedsActionOn] = useState(() => (localStorage.getItem('lfad-needs-action') ?? localStorage.getItem('hitloop-needs-action')) === '1')
  const { archived, parked, park, unpark } = useSystemStores(version, refresh)
  const searchRef = useRef<HTMLInputElement>(null)
  const lastKey = useRef<{ key: string; at: number }>({ key: '', at: 0 })

  // Drawer open-state is URL-driven. A ticket URL leaves the base view as-is, so
  // a drawer opened from the dashboard/archive returns there on close.
  const openId = route.ticketId
  useEffect(() => {
    if (route.base === 'dashboard') setView('dashboard')
    else if (route.base === 'board') setView('board')
    else if (route.base === 'archive') setView('archive')
    else if (route.base === 'parked') setView('parked')
  }, [route.base])

  useEffect(() => {
    let cancelled = false
    getKeywordSettings()
      .then((settings) => {
        if (!cancelled) setKeywords(settings)
      })
      .catch(() => {
        if (!cancelled) setKeywords(DEFAULT_KEYWORD_SETTINGS)
      })
    return () => {
      cancelled = true
    }
  }, [version])

  useEffect(() => {
    const available = new Set(keywords.items.map((keyword) => normalizeKeyword(keyword.word)))
    setKeywordFilter((current) => new Set([...current].filter((word) => available.has(word))))
  }, [keywords.items])

  useEffect(() => {
    let cancelled = false
    getPromptTemplates()
      .then((templates) => {
        if (!cancelled) setPromptTemplates(templates)
      })
      .catch(() => {
        if (!cancelled) setPromptTemplates(DEFAULT_PROMPT_TEMPLATES)
      })
    return () => {
      cancelled = true
    }
  }, [version])

  function toggleCategory(c: Category) {
    setCategoryFilter((prev) => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c)
      else next.add(c)
      return next
    })
  }

  function toggleKeyword(word: string) {
    const normalized = normalizeKeyword(word)
    setKeywordFilter((previous) => {
      const next = new Set(previous)
      if (next.has(normalized)) next.delete(normalized)
      else next.add(normalized)
      return next
    })
  }

  // Global keyboard shortcuts: `/` search, `g d` / `g b` to jump.
  // Suppressed while typing in a field so they never eat real input.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const typing =
        target !== null &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (typing) return

      if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
        return
      }
      const now = Date.now()
      if (lastKey.current.key === 'g' && now - lastKey.current.at < 800) {
        if (e.key === 'd') navigate('/dashboard')
        if (e.key === 'b') navigate('/')
        lastKey.current = { key: '', at: 0 }
        return
      }
      lastKey.current = { key: e.key, at: now }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  const stepByKey = useMemo(() => new Map(steps.map((step) => [step.key, step])), [steps])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tickets.filter((t) => {
      if (categoryFilter.size > 0 && !categoryFilter.has(t.category)) return false
      if (keywordFilter.size > 0 && !t.tags.some((tag) => keywordFilter.has(normalizeKeyword(tag)))) return false
      if (q.length > 0 && !`#${t.id} ${t.title} ${t.tags.join(' ')}`.toLowerCase().includes(q)) return false
      if (view === 'board' && needsActionOn && !isNeedsActionOrHeld(t, stepByKey.get(t.status))) return false
      return true
    })
  }, [tickets, search, categoryFilter, keywordFilter, view, needsActionOn, stepByKey])

  // Tickets an agent can advance right now — the "next-all" set. A ticket is
  // unblocked when its step is agent-typed, or a gate with no open questions;
  // gates with open questions, Manual tickets, terminal/queue steps, and the
  // lateral blocked lane are waiting on a human (or on nothing) and are
  // excluded (see isRunnableInBatch). Computed over the whole board (not the
  // search-filtered view) so "process all" means all.
  const nextAllIds = useMemo(() => {
    return tickets
      .filter((t) => isRunnableInBatch(t, stepByKey.get(t.status)))
      .map((t) => t.id)
      .sort((a, b) => a - b)
  }, [tickets, stepByKey])
  const needsActionCount = useMemo(
    () =>
      new Set(
        tickets
          .filter((ticket) => isNeedsActionOrHeld(ticket, stepByKey.get(ticket.status)))
          .map((ticket) => ticket.id),
      ).size,
    [tickets, stepByKey],
  )
  const runningCount = tickets.filter((ticket) => ticket.running !== undefined).length

  function toggleNeedsAction(): void {
    setNeedsActionOn((current) => {
      const next = !current
      localStorage.setItem('lfad-needs-action', next ? '1' : '0')
      return next
    })
  }

  const nextAllPrompt = useMemo(
    () => renderRunAllPrompt(promptTemplates.runAll, nextAllIds, commandPrefix, skillPrefix),
    [commandPrefix, skillPrefix, nextAllIds, promptTemplates.runAll],
  )

  // Drawer read-only mode derives from the ticket's DATA — membership in the
  // `_archive` collection — never from which view opened it: the same archived
  // ticket is read-only via any path (deep link, board history), and a live
  // ticket stays editable even while the Archive view is underneath. The
  // collection refetches on every board change, so archiving/reactivating a
  // ticket while its drawer is open flips the mode live.
  const openTicketArchived = openId !== null && archived.some((t) => t.id === openId)
  const openTicketParked = openId !== null && parked.some((t) => t.id === openId)
  const openTicketBlocked = openId !== null && tickets.some((ticket) => ticket.id === openId && ticket.status === 'blocked')

  const baseHref = view === 'dashboard' ? '/dashboard' : view === 'archive' ? '/archive' : view === 'parked' ? '/parked' : '/'
  const viewHref = (v: View): string => (v === 'dashboard' ? '/dashboard' : v === 'archive' ? '/archive' : v === 'parked' ? '/parked' : '/')
  const title = view === 'dashboard' ? 'Dashboard' : view === 'archive' ? 'Archive' : view === 'parked' ? 'Parked' : 'Board'

  return (
    <div className="app">
      <Sidebar
        view={view}
        onView={(v) => navigate(viewHref(v))}
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        categoryFilter={categoryFilter}
        onToggleCategory={toggleCategory}
        keywordFilter={keywordFilter}
        onToggleKeyword={toggleKeyword}
        keywords={keywords}
        onConfigureKeywords={() => setKeywordsOpen(true)}
        tickets={tickets}
        archiveCount={archived.length}
        parkedCount={parked.length}
        onManual={() => setManualOpen(true)}
      />
      <div className="main">
        <TopBar
          title={title}
          search={search}
          onSearch={setSearch}
          onNew={() => setNewOpen(true)}
          onConfigurePrompts={() => setPromptsOpen(true)}
          onNextAll={() => nextAll.copy(nextAllPrompt)}
          nextAllCopied={nextAll.copied}
          nextAllCount={nextAllIds.length}
          needsActionOn={needsActionOn}
          onToggleNeedsAction={toggleNeedsAction}
          needsActionCount={needsActionCount}
          showNeedsAction={view === 'board'}
          runningCount={runningCount}
          searchRef={searchRef}
        />
        {error && (
          <div className="banner banner-error" role="alert">
            <span>{error}</span>
            <button className="banner-x" onClick={refresh}>
              retry
            </button>
          </div>
        )}
        <main className="content">
          {view === 'archive' ? (
            <Archive tickets={archived} onOpen={(id) => navigate(`/t/${id}`)} />
          ) : view === 'parked' ? (
            <Parked tickets={parked} onOpen={(id) => navigate(`/t/${id}`)} onRestore={unpark} />
          ) : view === 'dashboard' ? (
            <Dashboard
              tickets={filtered}
              steps={steps}
              onOpen={(id) => navigate(`/t/${id}`)}
              onOpenInput={(id) => navigate(`/t/${id}/input`)}
            />
          ) : (
            <Board
              tickets={filtered}
              steps={steps}
              onOpen={(id) => navigate(`/t/${id}`)}
              onOpenInput={(id) => navigate(`/t/${id}/input`)}
              keywords={keywords}
            />
          )}
        </main>
      </div>

      {openId !== null && (
        <TicketDrawer
          ticketId={openId}
          sectionSlug={route.section}
          anchor={route.anchor}
          steps={steps}
          keywords={keywords}
          boardVersion={version}
          readOnly={openTicketArchived || openTicketParked}
          lifecycleAction={openTicketParked ? 'restore' : openTicketArchived || openTicketBlocked ? undefined : 'park'}
          onLifecycleAction={openTicketParked
            ? async () => { await unpark(openId); navigate('/') }
            : async () => { await park(openId); navigate('/parked') }}
          candidates={tickets}
          archivedCandidates={archived}
          onClose={() => navigate(baseHref)}
          onSection={(slug, anchor) => {
            // An empty slug returns to the plain ticket URL (input mode exits
            // to the doc view's default section).
            const path = slug === '' ? `/t/${openId}` : `/t/${openId}/${slug.split('/').map(encodeURIComponent).join('/')}`
            navigate(anchor === undefined ? path : `${path}#${anchor}`)
          }}
        />
      )}
      {newOpen && <NewIdeaModal steps={steps} onClose={() => setNewOpen(false)} onCreated={refresh} />}
      {manualOpen && <ManualModal onClose={() => setManualOpen(false)} />}
      {keywordsOpen && (
        <KeywordModal
          settings={keywords}
          onClose={() => setKeywordsOpen(false)}
          onSaved={(next) => {
            setKeywords(next)
            refresh()
            setKeywordsOpen(false)
          }}
        />
      )}
      {promptsOpen && (
        <PromptModal
          templates={promptTemplates}
          onClose={() => setPromptsOpen(false)}
          onSaved={(next) => {
            setPromptTemplates(next)
            setPromptsOpen(false)
          }}
        />
      )}
    </div>
  )
}
