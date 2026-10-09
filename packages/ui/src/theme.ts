export type ThemeChoice = 'system' | 'light' | 'dark'

const THEME_KEY = 'lfad-theme'
const LEGACY_THEME_KEY = 'hitloop-theme'

export function storedTheme(): ThemeChoice {
  const value = localStorage.getItem(THEME_KEY) ?? localStorage.getItem(LEGACY_THEME_KEY)
  return value === 'light' || value === 'dark' ? value : 'system'
}

export function applyTheme(choice: ThemeChoice): void {
  if (choice === 'system') {
    localStorage.removeItem(THEME_KEY)
    document.documentElement.removeAttribute('data-theme')
  } else {
    localStorage.setItem(THEME_KEY, choice)
    document.documentElement.dataset.theme = choice
  }
}
