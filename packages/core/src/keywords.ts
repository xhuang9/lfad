/** Shade columns shown by the project keyword colour picker. */
export const KEYWORD_SHADES = [100, 300, 500, 700, 900] as const

/** Tailwind hue rows shown in the main colour matrix. */
export const KEYWORD_PALETTE = [
  { name: 'Red', colors: ['#fee2e2', '#fca5a5', '#ef4444', '#b91c1c', '#7f1d1d'] },
  { name: 'Orange', colors: ['#ffedd5', '#fdba74', '#f97316', '#c2410c', '#7c2d12'] },
  { name: 'Amber', colors: ['#fef3c7', '#fcd34d', '#f59e0b', '#b45309', '#78350f'] },
  { name: 'Yellow', colors: ['#fef9c3', '#fde047', '#eab308', '#a16207', '#713f12'] },
  { name: 'Lime', colors: ['#ecfccb', '#bef264', '#84cc16', '#4d7c0f', '#365314'] },
  { name: 'Green', colors: ['#dcfce7', '#86efac', '#22c55e', '#15803d', '#14532d'] },
  { name: 'Emerald', colors: ['#d1fae5', '#6ee7b7', '#10b981', '#047857', '#064e3b'] },
  { name: 'Teal', colors: ['#ccfbf1', '#5eead4', '#14b8a6', '#0f766e', '#134e4a'] },
  { name: 'Cyan', colors: ['#cffafe', '#67e8f9', '#06b6d4', '#0e7490', '#164e63'] },
  { name: 'Sky', colors: ['#e0f2fe', '#7dd3fc', '#0ea5e9', '#0369a1', '#0c4a6e'] },
  { name: 'Blue', colors: ['#dbeafe', '#93c5fd', '#3b82f6', '#1d4ed8', '#1e3a8a'] },
  { name: 'Indigo', colors: ['#e0e7ff', '#a5b4fc', '#6366f1', '#4338ca', '#312e81'] },
  { name: 'Violet', colors: ['#ede9fe', '#c4b5fd', '#8b5cf6', '#6d28d9', '#4c1d95'] },
  { name: 'Purple', colors: ['#f3e8ff', '#d8b4fe', '#a855f7', '#7e22ce', '#581c87'] },
  { name: 'Fuchsia', colors: ['#fae8ff', '#f0abfc', '#d946ef', '#a21caf', '#701a75'] },
  { name: 'Pink', colors: ['#fce7f3', '#f9a8d4', '#ec4899', '#be185d', '#831843'] },
  { name: 'Rose', colors: ['#ffe4e6', '#fda4af', '#f43f5e', '#be123c', '#881337'] },
  { name: 'Slate', colors: ['#f1f5f9', '#cbd5e1', '#64748b', '#334155', '#0f172a'] },
] as const

/** Low-saturation rows kept separate from the hue matrix. */
export const KEYWORD_NEUTRALS = [
  { name: 'Gray', colors: ['#f3f4f6', '#d1d5db', '#6b7280', '#374151', '#111827'] },
  { name: 'Zinc', colors: ['#f4f4f5', '#d4d4d8', '#71717a', '#3f3f46', '#18181b'] },
  { name: 'Stone', colors: ['#f5f5f4', '#d6d3d1', '#78716c', '#44403c', '#1c1917'] },
] as const

/** Existing Tailwind 600 values remain valid for saved keyword settings. */
export const LEGACY_KEYWORD_COLORS = [
  '#dc2626', '#ea580c', '#d97706', '#ca8a04', '#65a30d', '#16a34a',
  '#059669', '#0d9488', '#0891b2', '#0284c7', '#2563eb', '#4f46e5',
  '#7c3aed', '#9333ea', '#c026d3', '#db2777', '#e11d48', '#475569',
] as const

/** Complete backend allowlist: every picker colour plus the legacy 600 values. */
export const KEYWORD_COLORS: readonly string[] = [
  ...KEYWORD_PALETTE.flatMap((row) => row.colors),
  ...KEYWORD_NEUTRALS.flatMap((row) => row.colors),
  ...LEGACY_KEYWORD_COLORS,
]
