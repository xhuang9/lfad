import type { Ticket } from './types'

export const INTERVIEW_CLARITY_THRESHOLD = 80

/** Derives the flow:next button text from the current step and interview score. */
export function deriveNextActionLabel(ticket: Ticket | undefined, nextLabel: string): string {
  const clarityPercent = ticket?.extras?.clarityPercent
  if (
    ticket?.status === 'interview'
    && typeof clarityPercent === 'number'
    && Number.isFinite(clarityPercent)
    && clarityPercent < INTERVIEW_CLARITY_THRESHOLD
  ) {
    return `Continue Interview ${clarityPercent}%`
  }
  return `${nextLabel} →`
}
