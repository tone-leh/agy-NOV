/**
 * Verify Gate core facade.
 *
 * Re-exports the complete backwards-compatible Verify API surface composed from
 * single-responsibility submodules (`types`, `sanitize`, `allowlist`, `store`,
 * `runner`, `detect`, `pr-summary`, and `demo`) with a strictly acyclic dependency graph.
 */

export * from './types.js';
export { formatFailureTailSnippet, redactVerifyOutput } from './sanitize.js';
export {
  clampCommandTimeout,
  clampMaxConsecutiveBlocks,
  validateAndBuildPolicy,
  validateVerifyCommand,
} from './allowlist.js';
export {
  appendEvidenceToState,
  buildVerifyStateView,
  clearVerifyHistory,
  clearVerifyHistoryInState,
  computeVerifyStats,
  createDefaultVerifyState,
  createEvidenceId,
  getVerifyStatePath,
  inspectWorkspaceFile,
  loadVerifyStateReadOnly,
  resolveRealPathWithMissingTail,
  saveVerifyState,
  scanEmptyWorkspaceFiles,
  updateVerifyPolicy,
} from './store.js';
export {
  executeVerifyCommand,
  listVerifyWorktreesReadOnly,
  resolveAllowedVerifyTargetRoot,
  runVerifyChecksLive,
  runVerifyCommands,
} from './runner.js';
export { detectWorkspaceVerifyCommands } from './detect.js';
export { buildPrDeliverySummary, loadSpecSummaryForPrReadOnly } from './pr-summary.js';
export {
  createDemoSpecSummaryForPr,
  createDemoVerifyDetection,
  createDemoVerifyState,
} from './demo.js';
