import { describe, expect, it } from 'vitest'

import { KEYWORD_NEUTRALS, KEYWORD_PALETTE, KEYWORD_SHADES, cardTags, ticketMatchesKeyword } from '../src/keywords'

describe('project keywords', () => {
  it('exposes the shared five-shade hue and neutral matrices', () => {
    expect(KEYWORD_SHADES).toEqual([100, 300, 500, 700, 900])
    expect(KEYWORD_PALETTE).toHaveLength(18)
    expect(KEYWORD_NEUTRALS.map((row) => row.name)).toEqual(['Gray', 'Zinc', 'Stone'])
  })

  it('matches ticket tags case-insensitively and exactly', () => {
    expect(ticketMatchesKeyword(['Blog'], 'blog')).toBe(true)
    expect(ticketMatchesKeyword(['blog-post'], 'blog')).toBe(false)
  })

  it('prioritises matched tags by registry order, then caps all tags with overflow', () => {
    const result = cardTags(['blog', 'neutral', 'audit', 'other'], {
      maxShown: 3,
      items: [
        { word: 'audit', color: '#d97706' },
        { word: 'BLOG', color: '#0284c7' },
      ],
    })

    expect(result.visible.map(({ tag }) => tag)).toEqual(['audit', 'blog', 'neutral'])
    expect(result.visible.map(({ keyword }) => keyword?.word)).toEqual(['audit', 'BLOG', undefined])
    expect(result.overflow).toBe(1)
  })
})
