/**
 * Environment variables are named `LFAD_*`. Boards installed before the rename
 * still have `HITLOOP_*` in their `.env`; each legacy name is copied to its
 * `LFAD_*` name when the new name is unset, so those boards keep working.
 */
export function withLegacyEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const merged = { ...env }
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('HITLOOP_') || value === undefined) continue
    const next = `LFAD_${key.slice('HITLOOP_'.length)}`
    if (merged[next] === undefined) merged[next] = value
  }
  return merged
}
