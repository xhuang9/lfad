// @lfad/core public barrel
// A pure library over the filesystem: schema types, the per-board `board.yml`
// config (steps + agent adapters), frontmatter validation, and the ticket
// file-operation surface. No UI, no daemon, no git.

export type {
  Step,
  Category,
  AutomationLevel,
  StepNote,
  HistoryEntry,
  DependencyMilestone,
  DependencyEdge,
  DependencyEdgeState,
  EvaluatedDependency,
  DependencyEvaluation,
  Ticket,
  CreateTicketInput,
  MoveOpts,
  Issue,
} from './types.js'

export {
  dependencyCyclePath,
  dependencyHoldForMove,
  evaluateDependencies,
  inferDependencyBoundary,
} from './dependencies.js'

export type {
  AdapterOutput,
  AgentAdapter,
  BoardConfig,
  StepConfig,
  StepRow,
  StepType,
} from './config.js'

export {
  BOARD_CONFIG_FILE,
  BUILT_IN_ADAPTER,
  DEFAULT_BOARD_CONFIG,
  DEFAULT_SKILL_PREFIX,
  adapterForStep,
  defaultBoardConfig,
  defaultEntryStep,
  isAgentStep,
  isGate,
  isQueue,
  isTerminal,
  linearSteps,
  loadBoardConfig,
  nextStep,
  parseBoardConfig,
  stepByKey,
  stepKeys,
  verifyConfigMatchesDisk,
  writeBoardConfig,
} from './config.js'

export { ARCHIVE_DIR, BLOCKED_DIR, PARKED_DIR } from './steps.js'

export { isRunnableInBatch } from './runnable.js'
export type { BatchRunnabilitySignals } from './runnable.js'

export {
  KEYWORD_COLORS,
  KEYWORD_NEUTRALS,
  KEYWORD_PALETTE,
  KEYWORD_SHADES,
  LEGACY_KEYWORD_COLORS,
} from './keywords.js'

export { allocateId } from './ids.js'

export {
  BUILD_STAGE_STATUSES,
  buildStageSchema,
  buildStagesSchema,
  buildStageStatusSchema,
  validateBuildStages,
} from './build-stages.js'
export type { BuildStage, BuildStages } from './build-stages.js'

export { buildTicketSchema, validateTicket } from './validation.js'
export type { TicketSchema } from './validation.js'

export type {
  WorktreeInfo,
  BlockPayload,
  ResolveBlockOpts,
  TagRename,
  RenameActiveTagsResult,
  ArchiveOpts,
  LogEntry,
  StatusRepair,
} from './fileops.js'

export {
  readTicket,
  readBoard,
  listStep,
  listArchive,
  listParked,
  listTicketFiles,
  createTicket,
  moveTicket,
  updateFrontmatter,
  renameActiveTicketTags,
  setBody,
  appendArtifact,
  appendLog,
  appendLogAt,
  reconcileStatus,
  setStepNote,
  setWorktree,
  setSession,
  setBlocked,
  resolveBlock,
  parkTicket,
  unparkTicket,
  archiveTicket,
  reactivateTicket,
} from './fileops.js'
export { withLegacyEnv } from './env.js'
