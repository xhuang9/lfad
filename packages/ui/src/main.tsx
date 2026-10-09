import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { storedTheme } from './theme'
import './styles.css'

const theme = storedTheme()
if (theme !== 'system') document.documentElement.dataset.theme = theme

const container = document.getElementById('root')
if (!container) throw new Error('Root element #root not found')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
