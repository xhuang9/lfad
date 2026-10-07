import type { CSSProperties } from 'react'
import { Fragment, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSortable } from '@dnd-kit/sortable'

import { KEYWORD_NEUTRALS, KEYWORD_PALETTE, KEYWORD_SHADES } from '../../keywords'

export interface DraftKeyword {
  id: string
  word: string
  color: string
  originalWord?: string
}

interface KeywordRowProps {
  keyword: DraftKeyword
  changed: boolean
  onChange: (next: DraftKeyword) => void
  onDelete: () => void
}

interface PalettePosition {
  left: number
  top: number
}

type PaletteRows = readonly { name: string, colors: readonly string[] }[]

export function KeywordRow({ keyword, changed, onChange, onDelete }: KeywordRowProps) {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [palettePosition, setPalettePosition] = useState<PalettePosition | null>(null)
  const colorButtonRef = useRef<HTMLButtonElement>(null)
  const paletteRef = useRef<HTMLDivElement>(null)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: keyword.id })
  const style: CSSProperties = {
    transform: transform === null ? undefined : `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    transition,
  }

  useLayoutEffect(() => {
    if (!paletteOpen) return

    function placePalette() {
      const anchor = colorButtonRef.current
      const palette = paletteRef.current
      if (anchor === null || palette === null) return

      const margin = 12
      const gap = 8
      const anchorRect = anchor.getBoundingClientRect()
      const paletteRect = palette.getBoundingClientRect()
      const maxLeft = window.innerWidth - paletteRect.width - margin
      const left = Math.max(margin, Math.min(anchorRect.left, maxLeft))
      const below = anchorRect.bottom + gap
      const top = below + paletteRect.height <= window.innerHeight - margin
        ? below
        : Math.max(margin, anchorRect.top - paletteRect.height - gap)
      setPalettePosition({ left, top })
    }

    placePalette()
    window.addEventListener('resize', placePalette)
    window.addEventListener('scroll', placePalette, true)
    return () => {
      window.removeEventListener('resize', placePalette)
      window.removeEventListener('scroll', placePalette, true)
    }
  }, [paletteOpen])

  function paletteRows(rows: PaletteRows) {
    return rows.map((row) => (
      <Fragment key={row.name}>
        <span className="keyword-palette-row-name">{row.name}</span>
        {row.colors.map((color, index) => {
          const label = `${row.name} ${KEYWORD_SHADES[index]}`
          return (
            <button
              key={color}
              type="button"
              title={label}
              aria-label={label}
              aria-selected={color === keyword.color}
              role="option"
              className={color === keyword.color ? 'keyword-palette-selected' : ''}
              style={{ background: color }}
              onClick={() => {
                onChange({ ...keyword, color })
                setPaletteOpen(false)
              }}
            />
          )
        })}
      </Fragment>
    ))
  }

  const palette = paletteOpen ? createPortal(
    <div
      ref={paletteRef}
      className="keyword-palette"
      style={{
        left: palettePosition?.left ?? 0,
        top: palettePosition?.top ?? 0,
        visibility: palettePosition === null ? 'hidden' : 'visible',
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="keyword-palette-title">Choose colour</div>
      <div className="keyword-palette-matrix" role="listbox" aria-label="Keyword colour">
        <span />
        {KEYWORD_SHADES.map((shade) => <span key={shade} className="keyword-palette-shade">{shade}</span>)}
        {paletteRows(KEYWORD_PALETTE)}
        <span className="keyword-palette-divider" />
        <span className="keyword-palette-subhead">Neutrals</span>
        {paletteRows(KEYWORD_NEUTRALS)}
      </div>
    </div>,
    document.body,
  ) : null

  return (
    <div ref={setNodeRef} style={style} className={`keyword-edit-row ${changed ? 'keyword-edit-changed' : ''} ${isDragging ? 'keyword-edit-dragging' : ''}`}>
      <button className="keyword-grip" type="button" aria-label={`Reorder ${keyword.word || 'keyword'}`} {...attributes} {...listeners}>
        Move
      </button>
      <div className="keyword-palette-wrap">
        <button
          ref={colorButtonRef}
          className="keyword-color-button"
          type="button"
          style={{ '--keyword-color': keyword.color } as CSSProperties}
          onClick={() => {
            setPalettePosition(null)
            setPaletteOpen((open) => !open)
          }}
          aria-label={`Choose colour for ${keyword.word || 'keyword'}`}
          aria-expanded={paletteOpen}
        >
          <span aria-hidden="true" />
          <span>Colour</span>
        </button>
        {palette}
      </div>
      <input
        className="text-input keyword-word-input"
        value={keyword.word}
        onChange={(event) => onChange({ ...keyword, word: event.target.value })}
        placeholder="keyword"
        aria-label="Keyword wording"
      />
      <button className="keyword-delete" type="button" onClick={onDelete}>Delete</button>
    </div>
  )
}
