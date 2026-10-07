/**
 * System directory constants for @lfad/core.
 *
 * Step folders are board data, not code: a step's on-disk folder IS its
 * config key (see `config.ts`). Only two directories are system-owned and can
 * never appear as config steps: `blocked/` (the lateral status), `parked/`
 * (the resumable holding store), and `_archive/` (cold store).
 */

/** Folder holding blocked tickets (the lateral status; never a config step). */
export const BLOCKED_DIR = 'blocked'

/** Folder holding tickets deliberately set aside for later (never a config step). */
export const PARKED_DIR = 'parked'

/** Cold-store directory name (not a Step; lives alongside step folders). */
export const ARCHIVE_DIR = '_archive'
