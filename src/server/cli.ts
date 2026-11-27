import fs from 'node:fs';
import path from 'node:path';
import {
  applyPresetConfig,
  isModuleId,
  isNovLocale,
  isPresetId,
  LOCALE_IDS,
  MODULE_IDS,
  PRESET_DEFINITIONS,
  PRESET_IDS,
  resolveNovDataDir,
  setModuleEnabled,
  setNovLocale,
  TEAM_CONFIG_FILENAME,
} from '../core/config.js';
import { canonicalRealpathSync, hasCliFlag, parseCliFlag } from '../core/utils.js';
import { compileActiveSpecWorkflowReadOnly } from '../modules/spec/core.js';
import { executeSafeCompactRun } from '../modules/turbo/auto-rtk.js';
import { runDoctor } from './cli/doctor.js';
import { CLI_VERSION, printHelp, printStatus } from './cli/helpers.js';
import {
  buildTeamPresetDraft,
  buildWorkspaceRecommendation,
  writeTeamPresetDraft,
  type OfflineModuleId,
  type SafeRecommendedPreset,
  type TeamPresetDraft,
  type WorkspaceRecommendation,
} from './cli/recommend.js';
import {
  buildStatusLine,
  parseHostStatusLineStdin,
  parseStatusLineSegments,
  readHostStatusLineStdinAsync,
  STATUSLINE_SEGMENTS,
  type BuildStatusLineOptions,
  type StatusLineHostStdinPayload,
  type StatusLineSegmentId,
  type StatusLineSnapshot,
} from './cli/statusline.js';
import {
  getHealthSweepReportPath,
  MAX_HEALTH_SWEEP_BYTES,
  runReadOnlyHealthSweep,
  writeHealthSweepReportIfPermitted,
  type HealthSweepFindingSummary,
  type HealthSweepOptions,
  type HealthSweepOverallStatus,
  type HealthSweepReport,
  type WriteHealthSweepReportResult,
} from './sidecar.js';

export {
  buildStatusLine,
  buildTeamPresetDraft,
  buildWorkspaceRecommendation,
  getHealthSweepReportPath,
  MAX_HEALTH_SWEEP_BYTES,
  parseHostStatusLineStdin,
  parseStatusLineSegments,
  runReadOnlyHealthSweep,
  STATUSLINE_SEGMENTS,
  writeHealthSweepReportIfPermitted,
};
export type {
  BuildStatusLineOptions,
  HealthSweepFindingSummary,
  HealthSweepOptions,
  HealthSweepOverallStatus,
  HealthSweepReport,
  OfflineModuleId,
  SafeRecommendedPreset,
  StatusLineHostStdinPayload,
  StatusLineSegmentId,
  StatusLineSnapshot,
  TeamPresetDraft,
  WorkspaceRecommendation,
  WriteHealthSweepReportResult,
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv.find((a) => !a.startsWith('-')) ?? 'status';
  const positional = argv.filter((a) => !a.startsWith('-'));
  const dataDir = resolveNovDataDir(parseCliFlag(argv, '--data-dir'));

  if (cmd === 'help' || argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return;
  }

  if (cmd === 'status') {
    printStatus(dataDir);
    return;
  }

  if (cmd === 'enable' || cmd === 'disable') {
    const target = positional[1];
    if (!isModuleId(target)) {
      console.error(`Unknown module "${target ?? ''}". Valid modules: ${MODULE_IDS.join(', ')}`);
      process.exit(2);
    }
    const next = setModuleEnabled(dataDir, target, cmd === 'enable');
    console.log(
      `${cmd === 'enable' ? 'Enabled' : 'Disabled'} module "${target}". Preset is now "${next.preset}".`,
    );
    return;
  }

  if (cmd === 'preset') {
    const target = positional[1];
    if (!isPresetId(target)) {
      console.error(`Unknown preset "${target ?? ''}". Valid presets: ${PRESET_IDS.join(', ')}`);
      process.exit(2);
    }
    const next = applyPresetConfig(dataDir, target);
    const def = PRESET_DEFINITIONS[target];
    console.log(`Applied preset "${def.label}" (${next.preset}).`);
    printStatus(dataDir);
    return;
  }

  if (cmd === 'locale') {
    const target = positional[1];
    if (!isNovLocale(target)) {
      console.error(`Unknown locale "${target ?? ''}". Valid locales: ${LOCALE_IDS.join(', ')}`);
      process.exit(2);
    }
    const next = setNovLocale(dataDir, target);
    console.log(`Updated agy-NOV UI locale to "${next.locale}".`);
    return;
  }

  if (cmd === 'statusline') {
    const asJson = hasCliFlag(argv, '--json');
    const compact = hasCliFlag(argv, '--compact');
    const rawSegmentsFlag = parseCliFlag(argv, '--segments');
    const rawSegments =
      rawSegmentsFlag !== undefined ? rawSegmentsFlag : process.env.AGY_NOV_STATUSLINE_SEGMENTS;
    const segments = parseStatusLineSegments(rawSegments);
    const hostStdin = await readHostStatusLineStdinAsync();
    const snap = buildStatusLine(dataDir, compact, { segments, hostStdin });
    console.log(asJson ? JSON.stringify(snap) : snap.line);
    return;
  }

  if (cmd === 'recommend') {
    const ws = parseCliFlag(argv, '--workspace') ?? process.cwd();
    const asJson = hasCliFlag(argv, '--json');
    const exportPreset = hasCliFlag(argv, '--export-preset');
    const confirmWrite = hasCliFlag(argv, '--confirm');
    const forceOverwrite = hasCliFlag(argv, '--force');
    const rec = buildWorkspaceRecommendation(ws);

    if (exportPreset) {
      const draft = buildTeamPresetDraft(rec, ws);
      const targetPath = path.join(rec.workspaceRoot, TEAM_CONFIG_FILENAME);
      let exists = false;
      try {
        fs.lstatSync(targetPath);
        exists = true;
      } catch {
        exists = false;
      }

      if (!confirmWrite) {
        if (asJson) {
          console.log(
            JSON.stringify(
              {
                ...rec,
                exportPreset: {
                  written: false,
                  path: targetPath,
                  exists,
                  draft,
                },
              },
              null,
              2,
            ),
          );
        } else {
          console.log(
            'Preview only (no file written). Re-run with --export-preset --confirm to write .agy-nov.json',
          );
          console.log(
            `Target: ${targetPath}${exists ? ' (already exists; add --force to overwrite)' : ''}`,
          );
          console.log(JSON.stringify(draft, null, 2));
        }
        return;
      }

      const writeRes = writeTeamPresetDraft(ws, draft, forceOverwrite);
      if (!writeRes.ok) {
        console.error(`[agy-NOV] ${writeRes.error}`);
        process.exit(1);
      }

      if (asJson) {
        console.log(
          JSON.stringify(
            {
              ...rec,
              exportPreset: {
                written: true,
                path: writeRes.path,
                exists: writeRes.existed,
                draft,
                audit: writeRes.audit,
              },
            },
            null,
            2,
          ),
        );
      } else {
        console.log(
          `Wrote ${TEAM_CONFIG_FILENAME} to ${writeRes.path} (validated via loadTeamPresetReadOnly: valid=${String(writeRes.audit.valid)}, errors=${writeRes.audit.errors.length}).`,
        );
        console.log(JSON.stringify(draft, null, 2));
      }
      return;
    }

    if (asJson) {
      console.log(JSON.stringify(rec, null, 2));
    } else {
      console.log(`agy-NOV v${CLI_VERSION} Workspace Recommendation (Read-Only)`);
      console.log(`  Workspace:   ${rec.workspaceRoot}`);
      console.log(
        `  Stacks:      ${rec.detectedStacks.length > 0 ? rec.detectedStacks.join(', ') : 'Generic'}`,
      );
      if (rec.teamPreset.found) {
        console.log(
          `  Team Preset: .agy-nov.json (${rec.teamPreset.valid ? 'valid' : 'invalid'}${rec.teamPreset.preset ? ` · preset=${rec.teamPreset.preset}` : ''} · ${rec.teamPreset.verifyCommandCount} verify cmd(s) · ${rec.teamPreset.warningCount} warn(s))`,
        );
      }
      console.log(
        `  Recommended: preset "${rec.recommendedPreset}"${rec.suggestedExtraModules.length > 0 ? ` + [${rec.suggestedExtraModules.join(', ')}]` : ''}`,
      );
      for (const r of rec.reasons) {
        console.log(`  - ${r}`);
      }
      console.log(`  Apply:       ${rec.applyCommand}`);
    }
    return;
  }

  if (cmd === 'doctor') {
    process.exit(runDoctor(dataDir));
  }

  if (cmd === 'compact-run') {
    const payloadB64 = parseCliFlag(argv, '--payload');
    if (!payloadB64) {
      console.error('[agy-NOV Auto-RTK] Missing required --payload=<base64url> argument.');
      process.exit(2);
    }
    const result = executeSafeCompactRun({
      payloadB64,
      cwd: process.cwd(),
      dataDir,
    });
    if (result.output) {
      process.stdout.write(result.output.endsWith('\n') ? result.output : `${result.output}\n`);
    }
    process.exit(result.exitCode);
  }

  if (cmd === 'compile-spec') {
    const specId = parseCliFlag(argv, '--spec');
    const rawFormat = (parseCliFlag(argv, '--format') ?? parseCliFlag(argv, '--target') ?? 'both')
      .trim()
      .toLowerCase();
    const format: 'workflow' | 'swarm' | 'both' =
      rawFormat === 'workflow' || rawFormat === 'swarm' ? rawFormat : 'both';
    const asJson = hasCliFlag(argv, '--json');
    const includeCompleted = hasCliFlag(argv, '--include-completed');
    const includeReviewGate = !hasCliFlag(argv, '--no-review') && !hasCliFlag(argv, '--no-review-gate');
    const includeVerifyGate = !hasCliFlag(argv, '--no-verify') && !hasCliFlag(argv, '--no-verify-gate');
    const workspaceFlag = (parseCliFlag(argv, '--workspace') ?? '').trim().toLowerCase();
    const useShareWorkspace =
      !hasCliFlag(argv, '--inherit-workspace') && workspaceFlag !== 'inherit';
    const rawModel = (parseCliFlag(argv, '--model') ?? 'inherit').trim().toLowerCase();
    const modelTier: 'inherit' | 'flash' | 'pro' =
      rawModel === 'flash' || rawModel === 'pro' ? rawModel : 'inherit';

    const compiled = compileActiveSpecWorkflowReadOnly(dataDir, specId, {
      target: format,
      includeCompleted,
      includeReviewGate,
      includeVerifyGate,
      useShareWorkspace,
      modelTier,
    });

    if (!compiled.ok) {
      if (asJson) {
        console.log(JSON.stringify(compiled, null, 2));
      } else {
        console.error(`[agy-NOV compile-spec] ${compiled.error}`);
      }
      process.exit(1);
    }

    if (asJson) {
      console.log(JSON.stringify(compiled, null, 2));
      return;
    }

    const pyText = compiled.workflowPython ?? '';
    const swarmText = compiled.swarmPlanJson ?? '';

    if (format === 'workflow') {
      process.stdout.write(pyText.endsWith('\n') ? pyText : `${pyText}\n`);
      return;
    }

    if (format === 'swarm') {
      process.stdout.write(swarmText.endsWith('\n') ? swarmText : `${swarmText}\n`);
      return;
    }

    console.log(
      `# agy-NOV Compiled Spec Workflow (${compiled.specId} · ${compiled.status} · ${compiled.waves.length} wave(s))`,
    );
    console.log('\n## /run-workflow Python Blueprint\n');
    console.log(pyText);
    console.log('\n## /swarm plan.json Blueprint\n');
    console.log(swarmText);
    return;
  }

  if (cmd === 'audit-once') {
    const workspaceRoot = parseCliFlag(argv, '--workspace') ?? process.cwd();
    const asJson = hasCliFlag(argv, '--json');
    const writeReport = hasCliFlag(argv, '--write-report');

    const report = runReadOnlyHealthSweep({ workspaceRoot, dataDir });
    const writeResult = writeReport
      ? writeHealthSweepReportIfPermitted(dataDir, report)
      : undefined;

    if (asJson) {
      if (writeResult) {
        console.log(
          JSON.stringify(
            {
              ...report,
              reportWrite: {
                written: writeResult.written,
                ...(writeResult.written ? { file: 'health-sweep.json' } : {}),
                ...(writeResult.bytes !== undefined ? { bytes: writeResult.bytes } : {}),
                ...(writeResult.reason ? { reason: writeResult.reason } : {}),
              },
            },
            null,
            2,
          ),
        );
      } else {
        console.log(JSON.stringify(report, null, 2));
      }
      return;
    }

    console.log(`agy-NOV v${CLI_VERSION} Read-Only Health Sweep (${report.overallStatus})`);
    console.log(`  Workspace:   ${report.workspaceName}`);
    console.log(
      `  Config:      preset=${report.config.preset} · ${report.config.enabledModulesCount}/${report.config.totalModules} modules (${report.config.exposedModelTools} tools) · remote=${report.config.remoteEnabled ? 'ON' : 'OFF'}`,
    );
    console.log(
      `  Ops Audit:   health=${report.ops.healthScore}/100 · security=${report.ops.securityScore}/100 · ruleBloat=${report.ops.ruleBloatStatus} (${report.ops.ruleTotalTokens} tok) · toolBudget=${report.ops.toolBudgetStatus} (${report.ops.estimatedTotalTools}/${report.ops.toolBudgetLimit}) · highSec=${report.ops.highSecurityFindingsCount}`,
    );
    console.log(
      `  Memory:      total=${report.mem.totalMemories} · stale=${report.mem.staleCount} · expiredUnpinned=${report.mem.expiredUnpinnedCount}`,
    );
    console.log(
      `  Verify:      last=${report.verify.verifyLastStatus} · dirtyFiles=${report.verify.dirtyFilesCount}`,
    );
    console.log(`  Guard:       blocked=${report.guard.guardBlockedCount}`);
    if (report.ops.topFindings.length > 0) {
      console.log('  Findings:');
      for (const finding of report.ops.topFindings) {
        console.log(
          `    - [${finding.severity.toUpperCase()}] ${finding.category} · ${finding.file} — ${finding.title}`,
        );
      }
    }
    if (report.recommendations.length > 0) {
      console.log('  Recommendations:');
      for (const rec of report.recommendations) {
        console.log(`    - ${rec}`);
      }
    }
    if (writeResult) {
      console.log(
        writeResult.written
          ? `  Report:      written (${writeResult.bytes} bytes -> health-sweep.json)`
          : `  Report:      skipped (${writeResult.reason ?? 'not permitted'})`,
      );
    }
    return;
  }

  console.error(`Unknown command "${cmd}".`);
  printHelp();
  process.exit(2);
}

function isCliEntrypoint(): boolean {
  try {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    const base = path.basename(argv1).toLowerCase();
    if (
      base === 'cli.ts' ||
      base === 'cli.cjs' ||
      base === 'cli.js' ||
      base === 'agy-nov-cli' ||
      base === 'agy-nov'
    ) {
      return true;
    }
    const realBase = path.basename(canonicalRealpathSync(argv1)).toLowerCase();
    return (
      realBase === 'cli.ts' ||
      realBase === 'cli.cjs' ||
      realBase === 'cli.js' ||
      realBase === 'agy-nov-cli'
    );
  } catch {
    return false;
  }
}

if (isCliEntrypoint()) {
  void main();
}
