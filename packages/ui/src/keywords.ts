import type { KeywordSettings, ProjectKeyword } from './types'

export { KEYWORD_NEUTRALS, KEYWORD_PALETTE, KEYWORD_SHADES } from '@lfad/core/keywords'

export const DEFAULT_KEYWORD_SETTINGS: KeywordSettings = { maxShown: 3, items: [] }

export interface VisibleTag {
  tag: string
  keyword?: ProjectKeyword
}

export interface CardTags {
  visible: VisibleTag[]
  overflow: number
}

export function normalizeKeyword(word: string): string {
  return word.toLocaleLowerCase()
}

export function ticketMatchesKeyword(tags: string[], word: string): boolean {
  const target = normalizeKeyword(word)
  return tags.some((tag) => normalizeKeyword(tag) === target)
}

/** Registry matches first (registry order), followed by neutral tags in ticket order. */
export function cardTags(tags: string[], settings: KeywordSettings): CardTags {
  const priority = new Map(settings.items.map((keyword, index) => [normalizeKeyword(keyword.word), { keyword, index }]))
  const ordered = tags
    .map((tag, index) => ({ tag, index, match: priority.get(normalizeKeyword(tag)) }))
    .sort((a, b) => {
      if (a.match !== undefined && b.match !== undefined) return a.match.index - b.match.index || a.index - b.index
      if (a.match !== undefined) return -1
      if (b.match !== undefined) return 1
      return a.index - b.index
    })
  const maxShown = Math.max(1, settings.maxShown)
  return {
    visible: ordered.slice(0, maxShown).map(({ tag, match }) => ({
      tag,
      ...(match !== undefined ? { keyword: match.keyword } : {}),
    })),
    overflow: Math.max(0, ordered.length - maxShown),
  }
}
