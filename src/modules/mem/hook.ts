import fs from 'node:fs';
import path from 'node:path';
import { getModuleDataDir, resolveNovDataDir } from '../../core/config.js';
import type { NormalizedHookPayload } from '../../core/types.js';
import { isSensitiveFilePath, MemoryStore } from './store.js';

export const MAX_TRANSCRIPT_TAIL_BYTES = 256 * 1024; // 256 KiB

function isSensitiveOrSymlinkToSensitive(filePath: string): boolean {
  if (isSensitiveFilePath(filePath)) return true;
  try {
    const real = fs.realpathSync(filePath);
    if (isSensitiveFilePath(real)) return true;
  } catch {
    // Missing or unreadable target falls back to lexical sensitivity check
  }
  return false;
}

export function extractEditedFilesFromTranscript(
  transcriptPath?: string,
  maxTailBytes = MAX_TRANSCRIPT_TAIL_BYTES,
): string[] {
  if (!transcriptPath) return [];
  const files = new Set<string>();
  let fd: number | undefined;
  try {
    fd = fs.openSync(transcriptPath, 'r');
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size === 0) return [];

    const bytesToRead = Math.min(stat.size, maxTailBytes);
    const startOffset = stat.size - bytesToRead;
    const buf = Buffer.alloc(bytesToRead);
    let totalRead = 0;

    while (totalRead < bytesToRead) {
      const n = fs.readSync(fd, buf, totalRead, bytesToRead - totalRead, startOffset + totalRead);
      if (n <= 0) break;
      totalRead += n;
    }

    let text = buf.subarray(0, totalRead).toString('utf8');
    if (startOffset > 0) {
      const firstNewline = text.indexOf('\n');
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : '';
    }

    const lines = text.split(/\r?\n/).slice(-120);
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as {
          tool_calls?: Array<{ name?: string; args?: Record<string, unknown> }>;
          toolCalls?: Array<{ name?: string; args?: Record<string, unknown> }>;
        };
        const calls = obj.tool_calls ?? obj.toolCalls ?? [];
        for (const tc of calls) {
          if (!tc.name || !/edit|write|replace/i.test(tc.name)) continue;
          const rawPath =
            tc.args?.Path ??
            tc.args?.path ??
            tc.args?.TargetFile ??
            tc.args?.target_file ??
            tc.args?.file_path ??
            tc.args?.filePath;
          if (typeof rawPath === 'string') {
            const clean = rawPath.replace(/^["']|["']$/g, '').trim();
            if (clean.startsWith('/') && !isSensitiveOrSymlinkToSensitive(clean)) {
              files.add(clean);
            }
          }
        }
      } catch {
        // ignore malformed line
      }
    }
  } catch {
    // ignore file error
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore close failure
      }
    }
  }
  return Array.from(files).slice(0, 6);
}

export function handleMemSessionStartHook(
  payload: NormalizedHookPayload,
  rootDataDir: string,
): { injectSteps?: unknown[] } {
  try {
    const resolvedRoot = resolveNovDataDir(rootDataDir);
    const dataDir = getModuleDataDir(resolvedRoot, 'mem');
    const storeFile = path.join(dataDir, 'memories.json');
    if (!fs.existsSync(storeFile)) {
      return {};
    }
    const workspacePaths =
      payload.workspacePaths.length > 0
        ? payload.workspacePaths
        : payload.workspaceRoot
          ? [payload.workspaceRoot]
          : [];
    const store = new MemoryStore(dataDir, false, workspacePaths[0]);
    const injected = store.buildSessionStartInjection(workspacePaths, 8);
    if (!injected) return {};
    return {
      injectSteps: [
        {
          systemMessage: {
            systemMessage: injected,
          },
        },
      ],
    };
  } catch {
    return {};
  }
}

export function handleMemStopHook(
  payload: NormalizedHookPayload,
  rootDataDir: string,
): void {
  try {
    const editedFiles = extractEditedFilesFromTranscript(payload.transcriptPath);
    const userPrompt = (payload.lastUserInput ?? '').replace(/\s+/g, ' ').trim();
    if (editedFiles.length === 0 || userPrompt.length < 16) {
      return;
    }
    const resolvedRoot = resolveNovDataDir(rootDataDir);
    const dataDir = getModuleDataDir(resolvedRoot, 'mem');
    const workspacePath = payload.workspacePaths[0] ?? payload.workspaceRoot;
    const convId = payload.conversationId ?? 'session';
    const store = new MemoryStore(dataDir, false, workspacePath);
    store.remember({
      id: `mem_auto_${convId.slice(0, 12)}`,
      kind: 'decision',
      title: `Session recap: ${userPrompt.slice(0, 56)}${userPrompt.length > 56 ? '…' : ''}`,
      content: `Auto-captured from conversation ${convId.slice(0, 8)}. Modified ${editedFiles.length} file(s): ${editedFiles.map((f) => path.basename(f)).join(', ')}.`,
      tags: ['auto-capture'],
      workspacePath,
      sourceConversationId: convId,
      anchors: editedFiles.map((filePath) => ({ filePath })),
      pinned: false,
    });
  } catch {
    // fail-open on capture write failures
  }
}
