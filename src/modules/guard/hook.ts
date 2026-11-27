import path from 'node:path';
import { getModuleDataDir } from '../../core/config.js';
import type { NormalizedHookPayload } from '../../core/types.js';
import { evaluateToolCall, extractCommandLine, extractTargetPath, redactCommand } from './policy.js';
import { appendAuditEvent, capturePreEditSnapshot, loadPolicy, resolveRealPathWithMissingTail } from './store.js';

const MUTATING_FILE_TOOL_RE =
  /^(edit_file|write_file|write_to_file|create_file|patch_file|apply_patch|replace_file_content|multi_replace_file_content|delete_file)$/i;

/**
 * Pure PreToolUse hook handler for the Guard module.
 * Reads directly from NormalizedHookPayload (`toolName`, `toolInput`, `workspaceRoot` / `cwd`)
 * so both Antigravity camelCase (`toolCall` + `workspacePaths`) and snake_case (`tool_name` + `tool_input`)
 * payloads are handled identically.
 */
export function handleGuardPreToolHook(
  payload: NormalizedHookPayload,
  rootDataDir: string,
): { decision: 'allow' | 'ask' | 'deny'; reason?: string } {
  if (payload.event !== 'PreToolUse') {
    return { decision: 'allow' };
  }

  const moduleDataDir = getModuleDataDir(rootDataDir, 'guard');
  const workspaceRoot = payload.workspaceRoot || payload.cwd || payload.workspacePaths[0] || process.cwd();
  const toolName = payload.toolName ?? '';
  const toolInput = payload.toolInput ?? {};
  const policy = loadPolicy(moduleDataDir);

  // 1. Evaluate deterministic security policy (including resolved symlink target)
  const targetPath = extractTargetPath(toolInput);
  let resolvedTargetPath: string | undefined;
  let symlinkLoopBlocked = false;
  if (targetPath) {
    const absTarget = path.isAbsolute(targetPath) ? targetPath : path.resolve(workspaceRoot, targetPath);
    try {
      resolvedTargetPath = resolveRealPathWithMissingTail(absTarget);
    } catch {
      symlinkLoopBlocked = true;
    }
  }

  const evalResult = symlinkLoopBlocked && policy.enabled && policy.protectEnvAndKeys !== 'allow'
    ? {
        decision: policy.protectEnvAndKeys,
        category: 'sensitive-file' as const,
        ruleId: 'path.symlink-loop',
        reason: `Blocked ${toolName} on unresolvable/cyclic symlink target (${path.basename(targetPath ?? '')})`,
        findings: [],
      }
    : evaluateToolCall(toolName, toolInput, policy, { resolvedTargetPath });
  const commandLine = extractCommandLine(toolInput);
  const targetDisplay = targetPath
    ? path.relative(workspaceRoot, path.resolve(workspaceRoot, targetPath)) || path.basename(targetPath)
    : commandLine
      ? redactCommand(commandLine).slice(0, 100)
      : toolName;

  if (evalResult.decision === 'deny' || evalResult.decision === 'ask') {
    const safeReason = redactCommand(evalResult.reason);
    try {
      appendAuditEvent(moduleDataDir, {
        event: 'PreToolUse',
        toolName,
        decision: evalResult.decision,
        category: evalResult.category,
        target: targetDisplay,
        summary: safeReason,
        ruleId: evalResult.ruleId,
      });
    } catch {
      // Never suppress security decision if audit log write fails
    }
    return {
      decision: evalResult.decision,
      reason: `[Agy NOV Guard] ${safeReason}`,
    };
  }

  // 2. Capture automatic pre-edit snapshot before mutating workspace files
  if (policy.enabled && policy.autoSnapshotBeforeEdit && MUTATING_FILE_TOOL_RE.test(toolName) && targetPath) {
    try {
      const resolvedPath = path.isAbsolute(targetPath) ? targetPath : path.resolve(workspaceRoot, targetPath);
      capturePreEditSnapshot({
        dataDir: moduleDataDir,
        filePath: resolvedPath,
        toolName,
        reason: `Automatic pre-edit snapshot before ${toolName}`,
        policy,
        workspaceRoot,
      });
    } catch {
      // Never break user workflow if snapshot storage is temporarily unavailable or path is outside workspace
    }
  }

  return { decision: 'allow' };
}
