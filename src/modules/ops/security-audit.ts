import crypto from 'node:crypto';
import {
  containsSecretPattern,
  ENV_VAR_GLOBAL_RE,
  JWT_LIKE_RE,
  listFilesStrictNoSymlink,
  PURE_ENV_REF_RE,
  readFileStrictNoSymlink,
  redactSecretsInMessage,
  sanitizeMcpIdentifier,
  SENSITIVE_KEY_NAME_RE,
  UNRESOLVED_PLACEHOLDER_RE,
} from './paths.js';
import {
  MAX_SECURITY_SCAN_FILE_BYTES,
  MAX_SECURITY_SCAN_FILES,
  type OpsSecurityFinding,
  type OpsSecuritySeverity,
} from './types.js';

const SECURITY_DEDUCTION: Record<OpsSecuritySeverity, number> = {
  high: 25,
  medium: 10,
  low: 4,
};

export function calculateSecurityScore(findings: readonly OpsSecurityFinding[]): number {
  let deduction = 0;
  for (const f of findings) {
    deduction += SECURITY_DEDUCTION[f.severity] ?? 0;
  }
  return Math.max(0, 100 - deduction);
}

function sanitizeSecurityFinding(finding: OpsSecurityFinding): OpsSecurityFinding {
  return {
    id: finding.id,
    severity: finding.severity,
    category: finding.category,
    file: redactSecretsInMessage(finding.file),
    title: redactSecretsInMessage(finding.title),
    summary: redactSecretsInMessage(finding.summary),
    remediation: redactSecretsInMessage(finding.remediation),
  };
}

function makeFindingSlug(relPath: string, suffix: string): string {
  const hash = crypto.createHash('sha256').update(`${relPath}:${suffix}`).digest('hex').slice(0, 8);
  return `${suffix}-${hash}`;
}

const PI_OVERRIDE_RE =
  /\b(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+)?(?:previous|prior|above|system)\s+(?:instructions?|rules?|prompts?|policies?)\b/i;
const PI_JAILBREAK_RE =
  /\byou\s+are\s+now\s+(?:in\s+)?(?:developer|unrestricted|jailbreak)\s+mode\b/i;
const PI_EXFIL_SECRET_RE =
  /\b(?:exfiltrate|steal|leak|dump|upload|post|send|transmit)\b[^\r\n]{0,100}\b(?:secret|secrets|token|tokens|api[_ -]?key|keys|credential|credentials|\.env|id_rsa|ssh|password|passwd)\b/i;
const PI_EXFIL_NET_RE =
  /\b(?:curl|wget|fetch|nc|netcat)\b[^\r\n]{0,120}(?:https?:\/\/|\$\(|\.(?:env|ssh)|id_rsa|secret|token|password|api[_ -]?key)/i;
const PI_EXFIL_URL_SEND_RE =
  /\b(?:send|post|upload|exfiltrate)\b[^\r\n]{0,100}https?:\/\//i;

const BROAD_ALLOW_KEYS = new Set([
  'allow',
  'allowedtools',
  'allowed_tools',
  'autoapprove',
  'auto_approve',
  'alwaysallow',
  'always_allow',
  'allowedcommands',
  'allowed_commands',
  'approvecommands',
  'approvedtools',
]);

const BROAD_WILDCARD_VALUE_RE = /^(?:\*{1,2}|(?:bash|shell|exec|terminal|run_command|command)\(\*\))$/i;
const DANGEROUS_SKIP_PERM_RE = /--dangerously-skip-permissions\b/i;
const DANGEROUS_YOLO_RE = /(?:^|[\s`"'])--yolo(?=$|[\s`"'])/i;
const DANGEROUS_CHMOD_777_RE = /\bchmod\s+(?:-R\s+)?(?:0?777|a\+rwx)\b/i;
const NEGATION_CONTEXT_RE =
  /\b(?:never|do not|don't|avoid|forbid|forbidden|prohibit|prohibited|block|blocked|deny|denied|reject|rejected|ban|banned|disallow|disallowed)\b|严禁|禁止|不要|不得/i;

const HOOK_PIPE_SHELL_RE =
  /\b(?:curl|wget)\b[^|\r\n]{0,240}\|\s*(?:sudo\s+)?(?:\/(?:usr\/)?bin\/)?(?:sh|bash|zsh|dash|ksh|python3?|node)\b/i;
const HOOK_RM_RF_ROOT_RE =
  /\brm\s+(?:-[a-zA-Z]*[rf][a-zA-Z]*\s+){1,2}(?:--no-preserve-root\s+)?(?:\/(?:\s|$|\*|[;&|])|~\/?(?:\s|$|[;&|])|\$HOME\/?(?:\s|$|[;&|]))/i;
const HOOK_EVAL_RE =
  /(?:^|[;&|]\s*|\b(?:sh|bash|zsh)\s+-c\s+["']?)\beval(?:\s+["'$A-Za-z0-9_(]|\s*$)/i;

const SAFE_LITERAL_ENV_VALUES_RE =
  /^(?:true|false|yes|no|on|off|0|1|none|null|empty|disabled|enabled|readonly|dev|prod|staging|local|test)$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUTH_SCHEME_ONLY_RE = /^(?:Bearer|Basic|Token|ApiKey|Digest)$/i;

function computeShannonEntropy(input: string): number {
  if (!input) return 0;
  const freq = new Map<string, number>();
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  let entropy = 0;
  const len = input.length;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function isHighEntropySecretLiteral(val: string): boolean {
  if (val.length < 24 || val.length > 512) return false;
  if (/\s/.test(val)) return false;
  if (val.includes('${') || val.includes('{{')) return false;
  if (/^https?:\/\//i.test(val)) return false;
  if (val.includes('/') || val.includes('\\')) return false;
  if (UUID_RE.test(val)) return false;
  const hasLower = /[a-z]/.test(val);
  const hasUpper = /[A-Z]/.test(val);
  const hasDigit = /[0-9]/.test(val);
  if (!(hasLower && hasUpper && hasDigit)) return false;
  return computeShannonEntropy(val) >= 4.0;
}

function isLoopbackHost(rawHost: string): boolean {
  const host = rawHost.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return false;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  if (host.endsWith('.localhost')) return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  return false;
}

function extractSafeHttpHost(urlCandidate: string): string {
  try {
    const parsed = new URL(urlCandidate);
    return parsed.hostname;
  } catch {
    const withoutScheme = urlCandidate.replace(/^http:\/\//i, '');
    const authority = withoutScheme.split(/[/?#]/)[0] ?? '';
    const hostPort = authority.includes('@') ? authority.slice(authority.lastIndexOf('@') + 1) : authority;
    if (hostPort.startsWith('[')) {
      const endBracket = hostPort.indexOf(']');
      return endBracket > 0 ? hostPort.slice(0, endBracket + 1) : hostPort;
    }
    return hostPort.split(':')[0] ?? '';
  }
}

function scanPromptInjection(
  relPath: string,
  text: string,
  push: (finding: OpsSecurityFinding) => void,
): void {
  // 1. O(n) single-pass scan for covert BiDi overrides & zero-width steganography runs
  let bidiCount = 0;
  let zwRun = 0;
  let maxZwRun = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) {
      bidiCount += 1;
    }
    if (code === 0x200b || code === 0x200c || code === 0x200d || code === 0xfeff) {
      zwRun += 1;
      if (zwRun > maxZwRun) maxZwRun = zwRun;
    } else {
      zwRun = 0;
    }
  }

  if (bidiCount > 0) {
    push({
      id: makeFindingSlug(relPath, 'pi-bidi'),
      severity: 'high',
      category: 'prompt-injection',
      file: relPath,
      title: 'Covert BiDi directional control characters detected',
      summary: `Found ${bidiCount} Unicode BiDi control character(s) (U+202A–U+202E / U+2066–U+2069) that can disguise hidden prompt instructions.`,
      remediation:
        'Remove all hidden Unicode BiDi override characters from rule and skill markdown files and inspect surrounding lines in plain hex/ASCII view.',
    });
  }

  if (maxZwRun >= 4) {
    push({
      id: makeFindingSlug(relPath, 'pi-zw'),
      severity: 'high',
      category: 'prompt-injection',
      file: relPath,
      title: 'Zero-width steganographic character sequence detected',
      summary: `Found a contiguous run of ${maxZwRun} zero-width characters (U+200B–U+200D / U+FEFF), commonly used for invisible prompt smuggling.`,
      remediation:
        'Strip contiguous zero-width characters from the instruction file and re-verify diff history for unauthorized edits.',
    });
  }

  // 2. Instruction override paired with concrete exfiltration/network sink (zero false positives on security docs)
  const hasOverride = PI_OVERRIDE_RE.test(text) || PI_JAILBREAK_RE.test(text);
  const hasExfil =
    PI_EXFIL_SECRET_RE.test(text) || PI_EXFIL_NET_RE.test(text) || PI_EXFIL_URL_SEND_RE.test(text);
  if (hasOverride && hasExfil) {
    push({
      id: makeFindingSlug(relPath, 'pi-override-exfil'),
      severity: 'high',
      category: 'prompt-injection',
      file: relPath,
      title: 'Prompt override combined with secret exfiltration pattern',
      summary:
        'Instruction file combines system/previous-instruction override phrasing with secret exfiltration or outbound network commands.',
      remediation:
        'Remove untrusted override directives and outbound secret-handling instructions from workspace rule or skill files.',
    });
  }
}

function scanJsonBroadCommandAllow(
  relPath: string,
  text: string,
  push: (finding: OpsSecurityFinding) => void,
): void {
  const reportedSubtypes = new Set<string>();
  const reportOnce = (subtype: string, title: string, summary: string, remediation: string) => {
    if (reportedSubtypes.has(subtype)) return;
    reportedSubtypes.add(subtype);
    push({
      id: makeFindingSlug(relPath, `broad-${subtype}`),
      severity: 'high',
      category: 'broad-command-allow',
      file: relPath,
      title,
      summary,
      remediation,
    });
  };

  const inspectStringForFlags = (str: string) => {
    if (DANGEROUS_SKIP_PERM_RE.test(str)) {
      reportOnce(
        'skip-permissions',
        'Unrestricted permission bypass flag (--dangerously-skip-permissions)',
        'Configuration enables --dangerously-skip-permissions, disabling host confirmation gates.',
        'Remove --dangerously-skip-permissions and rely on explicit allowlists or Guard permission modes.',
      );
    }
    if (DANGEROUS_YOLO_RE.test(str)) {
      reportOnce(
        'yolo-flag',
        'Unrestricted auto-approval flag (--yolo)',
        'Configuration enables --yolo auto-execution without safety prompts.',
        'Remove --yolo and scope permitted commands explicitly.',
      );
    }
    if (DANGEROUS_CHMOD_777_RE.test(str)) {
      reportOnce(
        'chmod-777',
        'World-writable permission command (chmod 777)',
        'Configuration invokes chmod 777 / a+rwx, granting unrestricted read/write/execute permissions.',
        'Replace chmod 777 with least-privilege permissions (for example 0600 for secrets or 0755 for executables).',
      );
    }
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    if (/"(?:allow|allowedTools|allowed_tools|autoApprove|alwaysAllow)"\s*:\s*\[\s*"\*"\s*\]/i.test(text)) {
      reportOnce(
        'wildcard-allow',
        'Wildcard command/tool allowlist ("*") detected',
        'Configuration grants wildcard "*" allowlist access to all commands or tools.',
        'Replace wildcard "*" allowlists with an explicit, minimal list of safe read-only tools or commands.',
      );
    }
    inspectStringForFlags(text);
    return;
  }

  const walk = (node: unknown, depth: number): void => {
    if (depth > 12 || node === null || node === undefined) return;
    if (typeof node === 'string') {
      inspectStringForFlags(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node === 'object') {
      for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
        const lowerKey = key.toLowerCase();
        if (BROAD_ALLOW_KEYS.has(lowerKey)) {
          const checkWildcard = (candidate: unknown): boolean =>
            typeof candidate === 'string' && BROAD_WILDCARD_VALUE_RE.test(candidate.trim());
          if (checkWildcard(val) || (Array.isArray(val) && val.some(checkWildcard))) {
            reportOnce(
              'wildcard-allow',
              `Wildcard permission allowlist in "${key}"`,
              `Configuration sets "${key}" to a wildcard ("*"), permitting unrestricted tool or shell execution.`,
              `Replace wildcard entries in "${key}" with explicit, least-privilege tool or command names.`,
            );
          }
        } else if (
          (lowerKey === 'defaultmode' || lowerKey === 'permissionmode') &&
          typeof val === 'string' &&
          /^(?:bypasspermissions|dangerously-skip-permissions|yolo)$/i.test(val.trim())
        ) {
          reportOnce(
            'bypass-mode',
            `Unrestricted permission mode ("${val.trim()}")`,
            `Configuration sets "${key}" to an unrestricted bypass mode.`,
            'Use a guarded permission mode such as balanced-dev or strict-gate.',
          );
        }
        walk(val, depth + 1);
      }
    }
  };

  walk(parsed, 0);
}

function scanTextBroadCommandAllow(
  relPath: string,
  text: string,
  push: (finding: OpsSecurityFinding) => void,
): void {
  const reportedSubtypes = new Set<string>();
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line || NEGATION_CONTEXT_RE.test(line)) continue;
    if (!reportedSubtypes.has('skip-permissions') && DANGEROUS_SKIP_PERM_RE.test(line)) {
      reportedSubtypes.add('skip-permissions');
      push({
        id: makeFindingSlug(relPath, 'broad-text-skip-permissions'),
        severity: 'high',
        category: 'broad-command-allow',
        file: relPath,
        title: 'Rule/skill recommends --dangerously-skip-permissions',
        summary:
          'Instruction text directs the agent to pass --dangerously-skip-permissions without safety constraints.',
        remediation:
          'Remove --dangerously-skip-permissions directives from workspace rules and skills.',
      });
    }
    if (!reportedSubtypes.has('yolo-flag') && DANGEROUS_YOLO_RE.test(line)) {
      reportedSubtypes.add('yolo-flag');
      push({
        id: makeFindingSlug(relPath, 'broad-text-yolo'),
        severity: 'high',
        category: 'broad-command-allow',
        file: relPath,
        title: 'Rule/skill recommends --yolo auto-execution',
        summary: 'Instruction text directs the agent to run commands with --yolo unrestricted approval.',
        remediation: 'Remove --yolo directives and require explicit user approval for destructive commands.',
      });
    }
    if (!reportedSubtypes.has('chmod-777') && DANGEROUS_CHMOD_777_RE.test(line)) {
      reportedSubtypes.add('chmod-777');
      push({
        id: makeFindingSlug(relPath, 'broad-text-chmod-777'),
        severity: 'high',
        category: 'broad-command-allow',
        file: relPath,
        title: 'Rule/skill recommends world-writable chmod 777',
        summary: 'Instruction text includes chmod 777 / a+rwx, exposing workspace files to world-writable access.',
        remediation: 'Replace chmod 777 with minimal file permissions (0600 / 0644 / 0755).',
      });
    }
  }
}

function scanRiskyHooks(
  relPath: string,
  text: string,
  push: (finding: OpsSecurityFinding) => void,
): void {
  const commands: string[] = [];
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Fallback linear extraction when JSON syntax is malformed
    const cmdLineRe = /"(?:command|cmd|script)"\s*:\s*"([^"\r\n]{1,500})"/g;
    let m: RegExpExecArray | null;
    while ((m = cmdLineRe.exec(text)) !== null) {
      commands.push(m[1]);
      if (commands.length >= 64) break;
    }
  }

  if (parsed && typeof parsed === 'object') {
    const walk = (node: unknown, depth: number): void => {
      if (depth > 12 || !node || typeof node !== 'object' || commands.length >= 64) return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item, depth + 1);
        return;
      }
      const obj = node as Record<string, unknown>;
      for (const field of ['command', 'cmd', 'script'] as const) {
        const rawCmd = obj[field];
        if (typeof rawCmd === 'string' && rawCmd.trim()) {
          const argList = Array.isArray(obj.args)
            ? obj.args.filter((a): a is string => typeof a === 'string').join(' ')
            : '';
          commands.push(argList ? `${rawCmd.trim()} ${argList}` : rawCmd.trim());
        }
      }
      for (const val of Object.values(obj)) {
        if (val && typeof val === 'object') walk(val, depth + 1);
      }
    };
    walk(parsed, 0);
  }

  const reported = new Set<string>();
  for (const cmd of commands) {
    if (!reported.has('pipe-sh') && HOOK_PIPE_SHELL_RE.test(cmd)) {
      reported.add('pipe-sh');
      push({
        id: makeFindingSlug(relPath, 'hook-pipe-sh'),
        severity: 'high',
        category: 'risky-hook',
        file: relPath,
        title: 'Hook pipes remote download directly into shell interpreter',
        summary:
          'Lifecycle hook command executes a remote script via curl/wget piped directly into a shell or runtime.',
        remediation:
          'Pin and verify scripts locally inside the repository with checksum verification instead of piping remote downloads into sh/bash.',
      });
    }
    if (!reported.has('rm-rf-root') && HOOK_RM_RF_ROOT_RE.test(cmd)) {
      reported.add('rm-rf-root');
      push({
        id: makeFindingSlug(relPath, 'hook-rm-rf-root'),
        severity: 'high',
        category: 'risky-hook',
        file: relPath,
        title: 'Hook executes destructive root/home deletion (rm -rf)',
        summary:
          'Lifecycle hook command contains a destructive recursive rm targeting /, /*, ~, or $HOME.',
        remediation:
          'Remove destructive root/home rm commands from hooks and restrict cleanup strictly to explicit workspace temp paths.',
      });
    }
    if (!reported.has('eval') && HOOK_EVAL_RE.test(cmd)) {
      reported.add('eval');
      push({
        id: makeFindingSlug(relPath, 'hook-eval'),
        severity: 'high',
        category: 'risky-hook',
        file: relPath,
        title: 'Hook invokes dynamic eval execution',
        summary:
          'Lifecycle hook command calls shell eval, enabling arbitrary command injection from untrusted hook payloads.',
        remediation:
          'Replace eval with direct argv invocation (for example node ./dist/hook.cjs with explicit CLI flags).',
      });
    }
  }
}

function scanMcpUnsafeEnv(
  relPath: string,
  text: string,
  push: (finding: OpsSecurityFinding) => void,
): void {
  let parsed: Record<string, unknown>;
  try {
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    parsed = raw as Record<string, unknown>;
  } catch {
    return;
  }

  const serversObj =
    parsed.mcpServers && typeof parsed.mcpServers === 'object' && !Array.isArray(parsed.mcpServers)
      ? (parsed.mcpServers as Record<string, unknown>)
      : parsed.servers && typeof parsed.servers === 'object' && !Array.isArray(parsed.servers)
        ? (parsed.servers as Record<string, unknown>)
        : null;
  if (!serversObj) return;

  for (const [serverName, rawDef] of Object.entries(serversObj)) {
    if (!rawDef || typeof rawDef !== 'object' || Array.isArray(rawDef)) continue;
    const def = rawDef as Record<string, unknown>;
    const safeServerName = sanitizeMcpIdentifier(serverName);

    // 1. Hardcoded literal secrets inside env (zero value echo — only serverName & key name)
    if (def.env && typeof def.env === 'object' && !Array.isArray(def.env)) {
      for (const [rawKey, rawVal] of Object.entries(def.env as Record<string, unknown>)) {
        if (typeof rawVal !== 'string') continue;
        const val = rawVal.trim();
        if (!val) continue;
        if (PURE_ENV_REF_RE.test(val) || UNRESOLVED_PLACEHOLDER_RE.test(val)) continue;

        const stripped = val.replace(ENV_VAR_GLOBAL_RE, '').trim();
        if (!stripped || AUTH_SCHEME_ONLY_RE.test(stripped)) continue;

        const cleanedKey = rawKey.replace(/[^\w.-]/g, '').slice(0, 64) || 'key';
        const safeKey = sanitizeMcpIdentifier(cleanedKey);

        const knownSecret = containsSecretPattern(val) || JWT_LIKE_RE.test(val);
        const sensitiveKeyLiteral =
          SENSITIVE_KEY_NAME_RE.test(rawKey) &&
          stripped.length >= 4 &&
          !SAFE_LITERAL_ENV_VALUES_RE.test(stripped);
        const highEntropy = isHighEntropySecretLiteral(stripped);

        if (knownSecret || sensitiveKeyLiteral || highEntropy) {
          push({
            id: makeFindingSlug(relPath, `mcp-env-${safeServerName}-${safeKey}`),
            severity: 'high',
            category: 'mcp-unsafe-env',
            file: relPath,
            title: `Hardcoded credential in MCP env (${safeServerName}.${safeKey})`,
            summary: `MCP server "${safeServerName}" defines a hardcoded non-placeholder value for env.${safeKey} (secret value redacted).`,
            remediation: `Replace the literal value in "${safeServerName}" env.${safeKey} with a \${${safeKey}} placeholder or host keychain injection.`,
          });
        }
      }
    }

    // 2. Plaintext http:// remote MCP endpoint (non-loopback)
    const urlCandidate =
      typeof def.url === 'string'
        ? def.url.trim()
        : typeof def.serverUrl === 'string'
          ? def.serverUrl.trim()
          : typeof def.httpUrl === 'string'
            ? def.httpUrl.trim()
            : '';

    if (urlCandidate && /^http:\/\//i.test(urlCandidate)) {
      const host = extractSafeHttpHost(urlCandidate);
      if (host && !isLoopbackHost(host)) {
        const safeHost =
          containsSecretPattern(host) || SENSITIVE_KEY_NAME_RE.test(host)
            ? '<redacted-host>'
            : host.slice(0, 80);
        push({
          id: makeFindingSlug(relPath, `mcp-http-${safeServerName}`),
          severity: 'medium',
          category: 'mcp-unsafe-env',
          file: relPath,
          title: `Unencrypted remote http:// MCP endpoint (${safeServerName})`,
          summary: `MCP server "${safeServerName}" points to remote host "${safeHost}" over plaintext http://.`,
          remediation: `Use https:// with TLS for remote MCP server "${safeServerName}", or confine plaintext http:// strictly to localhost / 127.0.0.1 / [::1].`,
        });
      }
    }
  }
}

type SecurityScanTargetKind = 'rule' | 'skill' | 'hook' | 'mcp' | 'client-settings';

export function auditStaticSecurityReadOnly(
  realRoot: string,
): { securityFindings: OpsSecurityFinding[]; securityScore: number } {
  const findings: OpsSecurityFinding[] = [];
  const seenFindingIds = new Set<string>();
  const pushFinding = (finding: OpsSecurityFinding): void => {
    const clean = sanitizeSecurityFinding(finding);
    if (seenFindingIds.has(clean.id)) return;
    seenFindingIds.add(clean.id);
    findings.push(clean);
  };

  const candidates: Array<{ relPath: string; kind: SecurityScanTargetKind }> = [];
  const seenCandidates = new Set<string>();
  const addCandidate = (relPath: string, kind: SecurityScanTargetKind): void => {
    const norm = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!norm || seenCandidates.has(norm) || candidates.length >= MAX_SECURITY_SCAN_FILES * 2) return;
    seenCandidates.add(norm);
    candidates.push({ relPath: norm, kind });
  };

  // Fixed root rule / hook / MCP / settings files
  addCandidate('AGENTS.md', 'rule');
  addCandidate('GEMINI.md', 'rule');
  addCandidate('CLAUDE.md', 'rule');
  addCandidate('hooks.json', 'hook');
  addCandidate('.agents/hooks.json', 'hook');
  addCandidate('hooks/hooks.json', 'hook');
  addCandidate('mcp_config.json', 'mcp');
  addCandidate('.mcp.json', 'mcp');
  addCandidate('.cursor/mcp.json', 'mcp');
  addCandidate('.gemini/mcp_config.json', 'mcp');
  addCandidate('.claude/settings.json', 'client-settings');

  // Dynamic bounded directories (strictly no symlinks)
  for (const rel of listFilesStrictNoSymlink(
    realRoot,
    '.agents/rules',
    4,
    MAX_SECURITY_SCAN_FILES,
    (_rel, name) => /\.(?:md|mdx|txt)$/i.test(name),
  )) {
    addCandidate(rel, 'rule');
  }

  for (const rel of listFilesStrictNoSymlink(
    realRoot,
    '.cursor/rules',
    4,
    MAX_SECURITY_SCAN_FILES,
    (_rel, name) => /\.(?:mdc|md|mdx|txt)$/i.test(name),
  )) {
    addCandidate(rel, 'rule');
  }

  for (const rel of listFilesStrictNoSymlink(
    realRoot,
    'skills',
    2,
    MAX_SECURITY_SCAN_FILES,
    (_rel, name) => name.toUpperCase() === 'SKILL.MD',
  )) {
    addCandidate(rel, 'skill');
  }

  for (const rel of listFilesStrictNoSymlink(
    realRoot,
    '.agents/skills',
    2,
    MAX_SECURITY_SCAN_FILES,
    (_rel, name) => name.toUpperCase() === 'SKILL.MD',
  )) {
    addCandidate(rel, 'skill');
  }

  let scannedCount = 0;
  for (const target of candidates) {
    if (scannedCount >= MAX_SECURITY_SCAN_FILES) break;
    const read = readFileStrictNoSymlink(
      realRoot,
      target.relPath,
      MAX_SECURITY_SCAN_FILE_BYTES,
    );
    if (!read.ok) continue;
    scannedCount += 1;

    if (target.kind === 'rule' || target.kind === 'skill') {
      scanPromptInjection(read.relPath, read.text, pushFinding);
      scanTextBroadCommandAllow(read.relPath, read.text, pushFinding);
    } else if (target.kind === 'hook') {
      scanJsonBroadCommandAllow(read.relPath, read.text, pushFinding);
      scanRiskyHooks(read.relPath, read.text, pushFinding);
    } else if (target.kind === 'mcp') {
      scanJsonBroadCommandAllow(read.relPath, read.text, pushFinding);
      scanMcpUnsafeEnv(read.relPath, read.text, pushFinding);
    } else if (target.kind === 'client-settings') {
      scanJsonBroadCommandAllow(read.relPath, read.text, pushFinding);
    }
  }

  const severityRank: Record<OpsSecuritySeverity, number> = { high: 0, medium: 1, low: 2 };
  findings.sort(
    (a, b) =>
      severityRank[a.severity] - severityRank[b.severity] ||
      a.file.localeCompare(b.file) ||
      a.id.localeCompare(b.id),
  );

  return {
    securityFindings: findings,
    securityScore: calculateSecurityScore(findings),
  };
}
