import path from 'node:path';
import { countEnabledModelTools, createDefaultConfig } from '../../core/config.js';
import { summarizeMigrationPreview } from './migration.js';
import { calculateSecurityScore } from './security-audit.js';
import {
  TOOL_BUDGET_HARD_LIMIT,
  type OpsSecurityFinding,
  type WorkspaceAssetEntry,
  type WorkspaceAuditReport,
} from './types.js';

export function createDemoOpsAuditReport(
  workspaceRoot: string,
  enabledNovTools?: number,
): WorkspaceAuditReport {
  const workspaceName = path.basename(path.resolve(workspaceRoot)) || 'agy-NOV';
  const novTools =
    typeof enabledNovTools === 'number' && Number.isFinite(enabledNovTools) && enabledNovTools >= 0
      ? Math.floor(enabledNovTools)
      : countEnabledModelTools(createDefaultConfig().modules);
  const externalServersCount = 3;
  const estimatedExternalTools = 28;
  const estimatedTotalTools = novTools + estimatedExternalTools;
  const usagePercent = Math.round((estimatedTotalTools / TOOL_BUDGET_HARD_LIMIT) * 100);
  const toolBudgetStatus: 'ok' | 'warn' | 'critical' =
    estimatedTotalTools >= 95 ? 'critical' : estimatedTotalTools >= 75 ? 'warn' : 'ok';

  const demoSecurityFindings: OpsSecurityFinding[] = [
    {
      id: 'demo-sec-mcp-http-docs',
      severity: 'medium',
      category: 'mcp-unsafe-env',
      file: '.mcp.json',
      title: 'Unencrypted remote http:// MCP endpoint (docs-search)',
      summary:
        'MCP server "docs-search" points to remote host "mcp-docs.staging.internal" over plaintext http://.',
      remediation:
        'Use https:// with TLS for remote MCP server "docs-search", or confine plaintext http:// strictly to localhost / 127.0.0.1 / [::1].',
    },
  ];
  const demoSecurityScore = calculateSecurityScore(demoSecurityFindings);

  const demoMigrationPreview = summarizeMigrationPreview([
    {
      client: 'claude',
      sourcePath: 'CLAUDE.md',
      bytes: 3420,
      estimatedTokens: 855,
      duplicatePercent: 82,
      duplicateLines: 41,
      totalLines: 50,
      recommendedTarget: 'AGENTS.md',
      action: 'dedupe-merge',
    },
    {
      client: 'cursor',
      sourcePath: '.cursor/rules/typescript.mdc',
      bytes: 2180,
      estimatedTokens: 545,
      duplicatePercent: 64,
      duplicateLines: 25,
      totalLines: 39,
      recommendedTarget: 'AGENTS.md',
      action: 'dedupe-merge',
    },
    {
      client: 'claude',
      sourcePath: '.claude/commands/release.md',
      bytes: 1240,
      estimatedTokens: 310,
      duplicatePercent: 15,
      duplicateLines: 3,
      totalLines: 20,
      recommendedTarget: '.agents/skills/',
      action: 'migrate-unique',
    },
    {
      client: 'codex',
      sourcePath: '.codex/config.toml',
      bytes: 480,
      estimatedTokens: 120,
      duplicatePercent: 0,
      duplicateLines: 0,
      totalLines: 14,
      recommendedTarget: '.agy-nov.json',
      action: 'keep-pointer',
    },
  ]);

  const assets: WorkspaceAssetEntry[] = [
    {
      relPath: 'AGENTS.md',
      kind: 'rules',
      bytes: 4280,
      chars: 4020,
      estimatedTokens: 1005,
      lineCount: 68,
    },
    {
      relPath: '.agents/rules/security.md',
      kind: 'agent-config',
      bytes: 2840,
      chars: 2680,
      estimatedTokens: 670,
      lineCount: 44,
    },
    {
      relPath: 'skills/agy-nov/SKILL.md',
      kind: 'skill',
      bytes: 1960,
      chars: 1840,
      estimatedTokens: 460,
      lineCount: 38,
    },
    {
      relPath: '.mcp.json',
      kind: 'mcp',
      bytes: 880,
      chars: 880,
      estimatedTokens: 220,
      lineCount: 34,
      meta: {
        serverCount: externalServersCount,
        serverNames: ['github', 'postgres-readonly', 'docs-search'],
        literalEnvEntries: 0,
        estimatedTools: estimatedExternalTools,
      },
    },
    {
      relPath: 'plugin.json',
      kind: 'manifest',
      bytes: 720,
      chars: 720,
      estimatedTokens: 180,
      lineCount: 24,
    },
    {
      relPath: 'hooks/hooks.json',
      kind: 'hooks',
      bytes: 940,
      chars: 940,
      estimatedTokens: 235,
      lineCount: 31,
    },
  ];
  return {
    mode: 'demo',
    workspaceName,
    scannedAt: new Date().toISOString(),
    healthScore: 94,
    summary: {
      assetCount: assets.length,
      totalBytes: 11_620,
      totalChars: 11_080,
      totalEstimatedTokens: 2770,
      skippedSymlinks: 0,
      skippedSensitive: 0,
      byKind: {
        rules: { count: 1, estimatedTokens: 1005 },
        skill: { count: 1, estimatedTokens: 460 },
        manifest: { count: 1, estimatedTokens: 180 },
        mcp: { count: 1, estimatedTokens: 220 },
        hooks: { count: 1, estimatedTokens: 235 },
        'agent-config': { count: 1, estimatedTokens: 670 },
      },
    },
    assets,
    storage: {
      rootDataDirExists: true,
      totalBytes: 186_420,
      totalFiles: 14,
      modules: [
        { moduleId: 'guard', bytes: 112_640, files: 7 },
        { moduleId: 'xray', bytes: 42_180, files: 3 },
        { moduleId: 'mem', bytes: 19_200, files: 2 },
        { moduleId: 'radar', bytes: 8_400, files: 1 },
        { moduleId: 'ops', bytes: 4_000, files: 1 },
      ],
    },
    recommendations: [
      {
        level: 'info',
        code: 'ops.healthy',
        title: 'Workspace rules & tool budget are within safe bounds',
        detail: `Largest rule file is 4.2 KB (< 24 KB limit) and estimated tool load is ${estimatedTotalTools}/100 (${usagePercent}%).`,
      },
    ],
    ruleBloat: {
      status: 'ok',
      singleFileLimitBytes: 24576,
      aggregateTokenLimit: 20000,
      largestFileBytes: 4280,
      largestFilePath: 'AGENTS.md',
      totalRuleBytes: 7120,
      totalRuleTokens: 1675,
      offendingFiles: [],
    },
    toolBudget: {
      agyNovTools: novTools,
      externalServersCount,
      estimatedExternalTools,
      estimatedTotalTools,
      hardLimit: 100,
      usagePercent,
      status: toolBudgetStatus,
    },
    mcpHealthFindings: [
      {
        severity: 'info',
        serverName: 'postgres-readonly',
        file: '.mcp.json',
        message: 'Server "postgres-readonly" uses env var placeholder references (zero hardcoded literals detected).',
      },
      {
        severity: 'warn',
        serverName: 'docs-search',
        file: '.mcp.json',
        message: 'Server "docs-search" defines a static OAuth/token expiry field (value redacted); verify auto-refresh is enabled.',
      },
    ],
    teamPreset: {
      found: true,
      filePath: '.agy-nov.json',
      valid: true,
      preset: 'power',
      enableModules: ['verify', 'ops'],
      verifyCommands: [
        { label: 'TypeScript Typecheck', executable: 'npm', args: ['run', 'typecheck'] },
        { label: 'Unit Tests', executable: 'npm', args: ['test'] },
      ],
      specTemplatesCount: 2,
      warnings: [],
      errors: [],
    },
    crossClientFindings: [
      {
        severity: 'warn',
        code: 'mcp-unexpanded-env',
        client: 'antigravity',
        file: '.mcp.json',
        message:
          'Server "github" references static env placeholder(s) (env.GITHUB_TOKEN (${GITHUB_TOKEN})). Antigravity 2.0 static MCP configs may not auto-expand ${ENV_VAR} across all transports (#233).',
        suggestion:
          'Verify host-level environment injection or use OS keychain / a thin local wrapper script instead of relying on static ${ENV_VAR} expansion in MCP JSON.',
      },
      {
        severity: 'info',
        code: 'cross-client-rules',
        client: 'cursor',
        file: '.cursor/rules/typescript.mdc',
        message: 'Detected 1 Cursor rule file(s) (.cursor/rules/typescript.mdc).',
        suggestion:
          'Keep shared workspace rules in AGENTS.md or modular skills/ so Antigravity and Cursor coexist without rule drift.',
      },
    ],
    securityFindings: demoSecurityFindings,
    securityScore: demoSecurityScore,
    migrationPreview: demoMigrationPreview,
  };
}

export const createDemoWorkspaceAudit = createDemoOpsAuditReport;
