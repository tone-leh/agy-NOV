import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MODULE_CATALOG, MODULE_IDS } from '../src/core/catalog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const ALL_SKILL_NAMES = [
  'agy-nov',
  'nov-spec',
  'nov-debug',
  'nov-review',
  'nov-handoff',
  'nov-workflow',
] as const;

const NEW_PLAYBOOK_SKILLS = [
  'nov-spec',
  'nov-debug',
  'nov-review',
  'nov-handoff',
  'nov-workflow',
] as const;

const NEW_READONLY_AGENTS = [
  'nov-blind-reviewer',
  'nov-security-auditor',
] as const;

const ALLOWED_READONLY_AGENT_TOOLS = new Set([
  'read_file',
]);

const FORBIDDEN_WRITE_OR_EXEC_TOOLS = new Set([
  'write_file',
  'edit_file',
  'run_command',
  'replace_file_content',
  'multi_replace_file_content',
  'delete_file',
  'bash',
  'shell',
  'exec',
  'apply_patch',
]);

const CANONICAL_CLI_COMMANDS = new Set([
  'status',
  'enable',
  'disable',
  'preset',
  'locale',
  'statusline',
  'recommend',
  'doctor',
  'compact-run',
  'compile-spec',
  'audit-once',
]);

const CANONICAL_MODEL_TOOLS = new Set<string>([
  'nov_open',
  'nov_status',
  ...MODULE_IDS.flatMap((id) => MODULE_CATALOG[id].modelToolNames),
]);

const MCP_NAMESPACE_PREFIXES = new Set<string>(['nov', 'app', ...MODULE_IDS]);

interface ParsedFrontmatter {
  scalars: Record<string, string | boolean>;
  lists: Record<string, string[]>;
  keys: string[];
  body: string;
}

function unquoteYamlScalar(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(markdown: string, fileLabel: string): ParsedFrontmatter {
  const normalized = markdown.replace(/\r\n/g, '\n');
  assert.ok(
    normalized.startsWith('---\n'),
    `${fileLabel}: must begin with YAML frontmatter delimiter "---"`,
  );
  const closingIdx = normalized.indexOf('\n---\n', 4);
  assert.ok(
    closingIdx > 0,
    `${fileLabel}: missing closing YAML frontmatter delimiter "---"`,
  );

  const rawHeader = normalized.slice(4, closingIdx);
  const body = normalized.slice(closingIdx + 5).trim();
  const lines = rawHeader.split('\n');

  const scalars: Record<string, string | boolean> = {};
  const lists: Record<string, string[]> = {};
  const keys: string[] = [];

  let activeListKey: string | null = null;

  for (const rawLine of lines) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) {
      continue;
    }

    const listItemMatch = /^\s+-\s+(.+)$/.exec(rawLine);
    if (listItemMatch) {
      assert.ok(
        activeListKey !== null,
        `${fileLabel}: unexpected YAML list item "${rawLine}" without parent key`,
      );
      lists[activeListKey].push(unquoteYamlScalar(listItemMatch[1]));
      continue;
    }

    const kvMatch = /^([A-Za-z][A-Za-z0-9_-]*):(.*)$/.exec(rawLine);
    assert.ok(kvMatch, `${fileLabel}: invalid frontmatter line "${rawLine}"`);
    const [, key, rest] = kvMatch;
    assert.ok(!keys.includes(key), `${fileLabel}: duplicate frontmatter key "${key}"`);
    keys.push(key);

    const val = rest.trim();
    if (val === '') {
      lists[key] = [];
      activeListKey = key;
    } else if (val.startsWith('[') && val.endsWith(']')) {
      activeListKey = null;
      const inner = val.slice(1, -1).trim();
      lists[key] = inner
        ? inner.split(',').map((item) => unquoteYamlScalar(item))
        : [];
    } else {
      activeListKey = null;
      if (val === 'true') {
        scalars[key] = true;
      } else if (val === 'false') {
        scalars[key] = false;
      } else {
        scalars[key] = unquoteYamlScalar(val);
      }
    }
  }

  return { scalars, lists, keys, body };
}

function extractBacktickMcpTools(markdown: string): string[] {
  const found: string[] = [];
  const codeSpanRe = /`([^`\n]+)`/g;
  const snakeIdentRe = /\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g;

  let spanMatch: RegExpExecArray | null;
  while ((spanMatch = codeSpanRe.exec(markdown)) !== null) {
    const span = spanMatch[1];
    let identMatch: RegExpExecArray | null;
    while ((identMatch = snakeIdentRe.exec(span)) !== null) {
      const ident = identMatch[1];
      const prefix = ident.split('_')[0];
      if (MCP_NAMESPACE_PREFIXES.has(prefix)) {
        found.push(ident);
      }
    }
  }
  return found;
}

function extractCliSubcommands(markdown: string): string[] {
  const found: string[] = [];
  const cliRe = /node\s+dist\/cli\.cjs\s+([a-z][a-z0-9-]*)/g;
  let match: RegExpExecArray | null;
  while ((match = cliRe.exec(markdown)) !== null) {
    found.push(match[1]);
  }
  return found;
}

const FORBIDDEN_RHETORIC_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: 'ZH not-A-but-B', regex: /(?:并?不是|并非)[^。！？\n]{1,60}而是/u },
  { label: 'ZH not-A-is-B', regex: /不是[^。！？\n]{1,40}[，,]是/u },
  { label: 'ZH rather-than', regex: /与其说[^。！？\n]{1,60}不如说/u },
  { label: 'ZH not-only-but-also', regex: /(?:不仅?只是|不仅仅是)[^。！？\n]{1,60}更是/u },
  { label: 'ZH seems-actually', regex: /看似[^。！？\n]{1,60}(?:实则|其实)/u },
  { label: 'EN not-X-but-Y', regex: /\bnot\b[^.!?\n]{1,120}\bbut\b/i },
];

const FORBIDDEN_SECRET_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: 'OpenAI-like key', regex: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { label: 'GitHub PAT', regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { label: 'AWS Access Key', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'PEM Private Key', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

describe('v0.9.0 native /nov-* playbook skills', () => {
  it('all 5 official skills exist with valid frontmatter and matching directory names', () => {
    for (const skillName of ALL_SKILL_NAMES) {
      const skillPath = path.join(REPO_ROOT, 'skills', skillName, 'SKILL.md');
      assert.ok(fs.existsSync(skillPath), `Missing skill file: ${skillPath}`);

      const content = fs.readFileSync(skillPath, 'utf8');
      const parsed = parseFrontmatter(content, `skills/${skillName}/SKILL.md`);

      assert.equal(
        parsed.scalars.name,
        skillName,
        `skills/${skillName}/SKILL.md: frontmatter "name" must match directory "${skillName}"`,
      );
      assert.match(
        String(parsed.scalars.name),
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        `skills/${skillName}/SKILL.md: "name" must be lowercase kebab-case`,
      );
      assert.equal(
        typeof parsed.scalars.description,
        'string',
        `skills/${skillName}/SKILL.md: "description" must be a non-empty string`,
      );
      assert.ok(
        String(parsed.scalars.description).trim().length >= 20,
        `skills/${skillName}/SKILL.md: "description" is too short`,
      );
      assert.ok(
        parsed.body.length > 200,
        `skills/${skillName}/SKILL.md: body must contain substantive playbook steps`,
      );
    }
  });

  it('4 new /nov-* skills stay compact (800 B – 6,000 B) and use official frontmatter keys only', () => {
    for (const skillName of NEW_PLAYBOOK_SKILLS) {
      const skillPath = path.join(REPO_ROOT, 'skills', skillName, 'SKILL.md');
      const content = fs.readFileSync(skillPath, 'utf8');
      const byteSize = Buffer.byteLength(content, 'utf8');

      assert.ok(
        byteSize >= 800 && byteSize <= 6_000,
        `skills/${skillName}/SKILL.md: byte size ${byteSize} must be within 800..6000 B`,
      );

      const parsed = parseFrontmatter(content, `skills/${skillName}/SKILL.md`);
      assert.deepEqual(
        [...parsed.keys].sort(),
        ['description', 'name'],
        `skills/${skillName}/SKILL.md: frontmatter should contain only name and description`,
      );
      const desc = String(parsed.scalars.description);
      assert.ok(
        desc.length >= 30 && desc.length <= 360,
        `skills/${skillName}/SKILL.md: description length ${desc.length} must stay compact (30..360 chars)`,
      );
    }
  });

  it('each /nov-* playbook covers its required agy-NOV workflow invariants', () => {
    const readSkill = (name: (typeof NEW_PLAYBOOK_SKILLS)[number]) =>
      fs.readFileSync(path.join(REPO_ROOT, 'skills', name, 'SKILL.md'), 'utf8');

    const specText = readSkill('nov-spec');
    for (const token of [
      '`nov_status`',
      '`spec_create_or_update`',
      '`spec_update_task`',
      '`SpecPanel`',
      '`requireUiApproval`',
      '`enforcePlanBeforeWrite`',
      'delta',
      'full',
    ]) {
      assert.ok(specText.includes(token), `nov-spec missing required token: ${token}`);
    }

    const debugText = readSkill('nov-debug');
    for (const token of [
      '`turbo_batch_search`',
      'mode: "references"',
      '`turbo_read_outline`',
      '`depPackage`',
      '`readonly-audit`',
      '`guard_create_checkpoint`',
      '`verify_run_checks`',
      '`review_get_summary`',
    ]) {
      assert.ok(debugText.includes(token), `nov-debug missing required token: ${token}`);
    }

    const reviewText = readSkill('nov-review');
    for (const token of [
      'Stage 1',
      'Stage 2',
      '`spec_get_state`',
      '`review_open`',
      '`review_get_summary`',
      '`nov-blind-reviewer`',
      '`nov-security-auditor`',
    ]) {
      assert.ok(reviewText.includes(token), `nov-review missing required token: ${token}`);
    }

    const handoffText = readSkill('nov-handoff');
    for (const token of [
      '`xray_analyze_context`',
      '`xray_export_brief`',
      'format: "handoff"',
      '`spec_get_state`',
      '`ready`',
      '`mem_remember`',
      '<private>',
      'Clean Fork',
    ]) {
      assert.ok(handoffText.includes(token), `nov-handoff missing required token: ${token}`);
    }

    const workflowText = readSkill('nov-workflow');
    for (const token of [
      '`nov_status`',
      '`spec_get_state`',
      '`spec_update_task`',
      '`verify_run_checks`',
      'compile-spec',
      '/run-workflow',
      '/swarm',
      '`nov-blind-reviewer`',
      '`nov-security-auditor`',
    ]) {
      assert.ok(workflowText.includes(token), `nov-workflow missing required token: ${token}`);
    }
  });
});

describe('v0.9.0 read-only specialist subagents', () => {
  it('both agents exist with subagent=true, mainAgent=false, model=inherit, and strictly read-only tools', () => {
    for (const agentName of NEW_READONLY_AGENTS) {
      const agentPath = path.join(REPO_ROOT, 'agents', `${agentName}.md`);
      assert.ok(fs.existsSync(agentPath), `Missing agent file: ${agentPath}`);

      const content = fs.readFileSync(agentPath, 'utf8');
      const byteSize = Buffer.byteLength(content, 'utf8');
      assert.ok(
        byteSize >= 800 && byteSize <= 5_000,
        `agents/${agentName}.md: byte size ${byteSize} must be within 800..5000 B`,
      );

      const parsed = parseFrontmatter(content, `agents/${agentName}.md`);
      assert.equal(parsed.scalars.name, agentName);
      assert.match(String(parsed.scalars.name), /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      assert.equal(parsed.scalars.subagent, true, `${agentName}: subagent must be true`);
      assert.equal(parsed.scalars.mainAgent, false, `${agentName}: mainAgent must be false`);
      assert.equal(parsed.scalars.model, 'inherit', `${agentName}: model must be inherit`);

      const desc = String(parsed.scalars.description ?? '');
      assert.ok(desc.length >= 30 && desc.length <= 360, `${agentName}: compact description required`);

      const tools = parsed.lists.tools;
      assert.ok(Array.isArray(tools) && tools.length > 0, `${agentName}: tools list must be non-empty`);
      for (const tool of tools) {
        assert.ok(
          !FORBIDDEN_WRITE_OR_EXEC_TOOLS.has(tool),
          `${agentName}: forbidden write/exec tool "${tool}" found in tools list`,
        );
        assert.ok(
          ALLOWED_READONLY_AGENT_TOOLS.has(tool),
          `${agentName}: unexpected tool "${tool}" outside read-only allowlist`,
        );
      }
      assert.deepEqual(
        [...tools].sort(),
        [...ALLOWED_READONLY_AGENT_TOOLS].sort(),
        `${agentName}: should declare native read-only tools only`,
      );
    }
  });

  it('blind reviewer and security auditor include required audit contracts', () => {
    const blindText = fs.readFileSync(
      path.join(REPO_ROOT, 'agents', 'nov-blind-reviewer.md'),
      'utf8',
    );
    for (const token of ['Stage 1', 'Stage 2', 'file:line', '`PASS`', '`CHANGES_REQUESTED`']) {
      assert.ok(blindText.includes(token), `nov-blind-reviewer missing token: ${token}`);
    }

    const secText = fs.readFileSync(
      path.join(REPO_ROOT, 'agents', 'nov-security-auditor.md'),
      'utf8',
    );
    for (const token of [
      'OWASP',
      '`realpath`',
      'ReDoS',
      '<private>',
      'Critical',
      'High',
      'Medium',
      'Low',
    ]) {
      assert.ok(secText.includes(token), `nov-security-auditor missing token: ${token}`);
    }
  });
});

describe('v0.9.0 canonical MCP tool allowlist & hygiene guardrails', () => {
  const NEW_FILES = [
    ...NEW_PLAYBOOK_SKILLS.map((name) => ({
      label: `skills/${name}/SKILL.md`,
      fullPath: path.join(REPO_ROOT, 'skills', name, 'SKILL.md'),
      isSkill: true,
    })),
    ...NEW_READONLY_AGENTS.map((name) => ({
      label: `agents/${name}.md`,
      fullPath: path.join(REPO_ROOT, 'agents', `${name}.md`),
      isSkill: false,
    })),
  ];

  it('canonical model tool catalog contains exactly 47 tools', () => {
    assert.equal(CANONICAL_MODEL_TOOLS.size, 47);
  });

  it('every backticked agy-NOV MCP tool name and CLI command across all new skills/agents is real', () => {
    for (const entry of NEW_FILES) {
      const content = fs.readFileSync(entry.fullPath, 'utf8');
      const tools = extractBacktickMcpTools(content);

      if (entry.isSkill) {
        assert.ok(
          tools.length >= 2,
          `${entry.label}: expected at least 2 canonical MCP tool references, got ${tools.length}`,
        );
      }

      for (const toolName of tools) {
        assert.ok(
          CANONICAL_MODEL_TOOLS.has(toolName),
          `${entry.label}: unknown or non-model MCP tool "${toolName}" (must exist in src/core/catalog.ts 47-tool allowlist)`,
        );
      }

      const cliCmds = extractCliSubcommands(content);
      for (const cmd of cliCmds) {
        assert.ok(
          CANONICAL_CLI_COMMANDS.has(cmd),
          `${entry.label}: unknown CLI subcommand "${cmd}"`,
        );
      }
    }
  });

  it('enforces zero default always-on rule bloat (no rules/AGENTS.md), zero local paths, zero secrets, and zero forbidden phrasing', () => {
    assert.equal(
      fs.existsSync(path.join(REPO_ROOT, 'rules', 'AGENTS.md')),
      false,
      'rules/AGENTS.md must not exist (zero always-on rule bloat)',
    );

    for (const entry of NEW_FILES) {
      const content = fs.readFileSync(entry.fullPath, 'utf8');

      assert.equal(
        content.includes('/Users/'),
        false,
        `${entry.label}: must not contain local /Users/ absolute paths`,
      );
      assert.equal(
        /C:\\Users\\|\/home\/[a-zA-Z0-9._-]+\//.test(content),
        false,
        `${entry.label}: must not contain local home directory paths`,
      );

      for (const { label, regex } of FORBIDDEN_SECRET_PATTERNS) {
        assert.equal(
          regex.test(content),
          false,
          `${entry.label}: must not contain secret-like pattern (${label})`,
        );
      }

      for (const { label, regex } of FORBIDDEN_RHETORIC_PATTERNS) {
        assert.equal(
          regex.test(content),
          false,
          `${entry.label}: forbidden rhetoric pattern matched (${label})`,
        );
      }
    }
  });
});
