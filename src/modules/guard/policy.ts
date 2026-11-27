import path from 'node:path';
import type { GuardDecision, GuardPermissionMode, GuardPolicy, PolicyEvaluation, SecretFinding } from './types.js';

const VALID_PERMISSION_MODES = new Set<GuardPermissionMode>([
  'readonly-audit',
  'balanced-dev',
  'strict-gate',
]);

export const MUTATING_FILE_TOOL_NAMES = new Set<string>([
  'edit_file',
  'write_file',
  'write_to_file',
  'create_file',
  'patch_file',
  'apply_patch',
  'replace_file_content',
  'multi_replace_file_content',
  'replace_in_file',
  'str_replace_editor',
  'delete_file',
  'remove_file',
  'rm_file',
  'unlink_file',
  'move_file',
  'rename_file',
  'write',
  'edit',
  'multi_edit',
  'multiedit',
  'notebook_edit',
  'notebookedit',
]);

export const COMMAND_EXEC_TOOL_NAMES = new Set<string>([
  'run_command',
  'run_shell_command',
  'run_terminal_command',
  'send_command_input',
  'exec_command',
  'bash',
  'shell',
  'execute_command',
]);

export function normalizeGuardToolName(toolName: string): string {
  const trimmed = toolName.trim().toLowerCase();
  const sepIdx = Math.max(trimmed.lastIndexOf(':'), trimmed.lastIndexOf('/'));
  return sepIdx >= 0 ? trimmed.slice(sepIdx + 1) : trimmed;
}

export function normalizePermissionMode(value: unknown): GuardPermissionMode {
  if (typeof value === 'string' && VALID_PERMISSION_MODES.has(value as GuardPermissionMode)) {
    return value as GuardPermissionMode;
  }
  return 'balanced-dev';
}

export function normalizeBlockInboundPromptSecrets(value: unknown): boolean {
  return value === false ? false : true;
}

export function isMutatingFileToolName(toolName: string): boolean {
  return MUTATING_FILE_TOOL_NAMES.has(normalizeGuardToolName(toolName));
}

export function isCommandExecToolName(toolName: string): boolean {
  return COMMAND_EXEC_TOOL_NAMES.has(normalizeGuardToolName(toolName));
}

const DECISION_SEVERITY: Record<GuardDecision, number> = {
  allow: 0,
  ask: 1,
  force_ask: 2,
  deny: 3,
};

interface SecretPattern {
  ruleId: string;
  label: string;
  severity: 'critical' | 'high' | 'medium';
  regex: RegExp;
}

const SECRET_PATTERNS: SecretPattern[] = [
  {
    ruleId: 'secret.private-key',
    label: 'Private Key Block',
    severity: 'critical',
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
  },
  {
    ruleId: 'secret.aws-access-key',
    label: 'AWS Access Key ID',
    severity: 'critical',
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    ruleId: 'secret.github-token',
    label: 'GitHub Personal Access Token',
    severity: 'critical',
    regex: /\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|gho_[A-Za-z0-9]{30,})\b/g,
  },
  {
    ruleId: 'secret.google-api-key',
    label: 'Google / Gemini API Key',
    severity: 'high',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    ruleId: 'secret.openai-anthropic',
    label: 'OpenAI / Anthropic / Stripe Secret Key',
    severity: 'critical',
    regex: /\b(?:sk-ant-[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{32,})\b/g,
  },
  {
    ruleId: 'secret.slack-token',
    label: 'Slack API Token',
    severity: 'high',
    regex: /\bxox[baprs]-[0-9A-Za-z-]{16,}\b/g,
  },
  {
    ruleId: 'secret.jwt-bearer',
    label: 'Hardcoded Bearer JWT',
    severity: 'high',
    regex: /Bearer\s+eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  },
  {
    ruleId: 'secret.generic-assignment',
    label: 'Hardcoded Secret Assignment',
    severity: 'medium',
    regex: /\b(?:API_KEY|SECRET_KEY|ACCESS_TOKEN|PRIVATE_TOKEN|DB_PASSWORD|DATABASE_PASSWORD)\s*[:=]\s*['"`](?!YOUR_|REPLACE_|EXAMPLE_|TEST_|DUMMY_|<|\$\{)[A-Za-z0-9_/+=-]{18,}['"`]/g,
  },
];

const SAFE_ENV_SUFFIXES = ['.example', '.sample', '.template', '.dist'];

const SENSITIVE_BASENAMES = new Set([
  '.env',
  '.npmrc',
  '.netrc',
  '.pypirc',
  'id_rsa',
  'id_ed25519',
  'id_dsa',
  'id_ecdsa',
  'credentials',
  'secrets.yaml',
  'secrets.yml',
  'secrets.json',
  'master.key',
]);

const SHELL_SENSITIVE_BASENAMES = new Set([
  'id_rsa',
  'id_ed25519',
  'id_dsa',
  'id_ecdsa',
  '.netrc',
  '.npmrc',
  '.pypirc',
]);

const SENSITIVE_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore']);

const SENSITIVE_PATH_REGEXES: Array<{ ruleId: string; regex: RegExp; label: string }> = [
  { ruleId: 'path.ssh-dir', regex: /(?:^|[/\\])\.ssh(?:[/\\]|$)/i, label: 'SSH key directory (~/.ssh)' },
  { ruleId: 'path.aws-dir', regex: /(?:^|[/\\])\.aws[/\\](?:credentials|config)(?:[/\\]|$)/i, label: 'AWS credentials directory' },
  { ruleId: 'path.kube-config', regex: /(?:^|[/\\])\.kube[/\\]config$/i, label: 'Kubernetes config' },
  { ruleId: 'path.gcp-sa', regex: /service[-_]?account.*\.json$/i, label: 'GCP service account JSON' },
  { ruleId: 'path.gnupg', regex: /(?:^|[/\\])\.gnupg(?:[/\\]|$)/i, label: 'GPG private keyring' },
];

const WIN_CATASTROPHIC_TARGET_SOURCE = [
  '[a-z]:[\\\\/](?:\\*(?:\\.\\*)?)?(?=$|[\\s"\'`;|&)])',
  '[a-z]:[\\\\/]windows(?:[\\\\/][^\\s"\'`;|&]{0,120})?(?=$|[\\s"\'`;|&)])',
  '[a-z]:[\\\\/]program\\s+files(?:\\s*\\(x86\\))?(?:[\\\\/][^\\r\\n"\'`;|&]{0,120})?(?=$|[\\s"\'`;|&)])',
  '[a-z]:[\\\\/]users(?:[\\\\/](?:\\*(?:\\.\\*)?)?)?(?=$|[\\s"\'`;|&)])',
  '%userprofile%(?:[\\\\/](?:\\*(?:\\.\\*)?)?)?(?=$|[\\s"\'`;|&)])',
  '\\$env:userprofile(?:[\\\\/](?:\\*(?:\\.\\*)?)?)?(?=$|[\\s"\'`;|&)])',
  '%(?:systemroot|windir)%(?:[\\\\/][^\\s"\'`;|&]{0,120})?(?=$|[\\s"\'`;|&)])',
  '\\$env:(?:systemroot|windir)(?:[\\\\/][^\\s"\'`;|&]{0,120})?(?=$|[\\s"\'`;|&)])',
].join('|');

const WIN_PS_TARGET_SOURCE = [
  WIN_CATASTROPHIC_TARGET_SOURCE,
  '~(?:[\\\\/](?:\\*)?)?(?=$|[\\s"\'`;|&)])',
  '\\/(?:\\*)?(?=$|[\\s"\'`;|&)])',
].join('|');

const WIN_CMD_RMDIR_TARGET_SOURCE = [
  WIN_PS_TARGET_SOURCE,
  '\\*(?:\\.\\*)?(?=$|[\\s"\'`;|&)])',
].join('|');

const DESTRUCTIVE_COMMAND_RULES: Array<{ ruleId: string; regex: RegExp; label: string }> = [
  {
    ruleId: 'cmd.git-force-push',
    regex: /\bgit\s+push\b[^\n]*(?:\s--force\b|\s-f\b|\s--force-with-lease\b)/,
    label: 'Git force push',
  },
  {
    ruleId: 'cmd.git-reset-hard',
    regex: /\bgit\s+(?:reset\s+--hard|clean\s+-[a-zA-Z]*f[a-zA-Z]*d)/,
    label: 'Destructive git reset --hard / clean -fd',
  },
  {
    ruleId: 'cmd.disk-format',
    regex: /\b(?:mkfs\.[a-z0-9]+|dd\s+if=.*of=\/dev\/|diskutil\s+eraseDisk)\b/i,
    label: 'Raw disk wipe / format command',
  },
  {
    ruleId: 'cmd.win-ps-rm-root',
    regex: new RegExp(
      `\\b(?:remove-item|ri|rm|del|erase|rd|rmdir)(?:\\.exe)?\\b(?=[^\\r\\n;&|]{0,200}\\s-(?:r|re|rec|recu|recur|recurs|recurse)\\b)[^\\r\\n;&|]{0,200}(?:[\\s"'\`=]|-(?:literal)?path:)(?:${WIN_PS_TARGET_SOURCE})`,
      'i',
    ),
    label: 'Destructive PowerShell recursive delete targeting drive root or system/user directory',
  },
  {
    ruleId: 'cmd.win-cmd-rmdir-root',
    regex: new RegExp(
      `\\b(?:rmdir|rd)(?:\\.exe)?\\b(?=[^\\r\\n;&|]{0,200}(?:\\s|(?<=\\b(?:rmdir|rd)(?:\\.exe)?))(?:\\/[a-z]){0,3}\\/s(?=$|[\\s/"'\`;|&]))[^\\r\\n;&|]{0,200}[\\s"'\`](?:${WIN_CMD_RMDIR_TARGET_SOURCE})`,
      'i',
    ),
    label: 'Destructive cmd rmdir /s targeting drive root, system/user directory, or wildcard',
  },
  {
    ruleId: 'cmd.win-cmd-del-root',
    regex: new RegExp(
      `\\b(?:del|erase)(?:\\.exe)?\\b(?=[^\\r\\n;&|]{0,200}(?:\\s|(?<=\\b(?:del|erase)(?:\\.exe)?))(?:\\/[a-z]){0,3}\\/s(?=$|[\\s/"'\`;|&]))[^\\r\\n;&|]{0,200}[\\s"'\`](?:${WIN_CATASTROPHIC_TARGET_SOURCE})`,
      'i',
    ),
    label: 'Destructive cmd del/erase /s targeting drive root or system/user directory',
  },
  {
    ruleId: 'cmd.win-disk-wipe',
    regex: /(?:^|[;&|(\r\n]\s*|\bcmd(?:\.exe)?\s+\/[ck]\s+["']?\s*|\b(?:powershell|pwsh)(?:\.exe)?\s+(?:-[a-z0-9_-]{1,24}\s+){0,4}["']?\s*)(?:format(?:\.com|\.exe)?\s+(?:\/[a-z0-9:_-]{1,24}\s+){0,6}[a-z]:(?=$|[\s"'`;|&)])|(?:clear-disk|diskpart(?:\.exe)?)(?=$|[\s"'`;|&)]))/i,
    label: 'Windows disk format / wipe command (format / Clear-Disk / diskpart)',
  },
  {
    ruleId: 'cmd.chmod-777',
    regex: /\bchmod\s+(?:-R\s+)?0?777\b/,
    label: 'World-writable chmod 777 permission change',
  },
  {
    ruleId: 'cmd.fork-bomb',
    regex: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    label: 'Shell fork bomb',
  },
];

const SQL_DESTRUCTIVE_REGEX = /\b(?:DROP\s+(?:DATABASE|SCHEMA|TABLE)|TRUNCATE\s+TABLE)\b/i;

const NETWORK_PIPE_RULES: Array<{ ruleId: string; regex: RegExp; label: string }> = [
  {
    ruleId: 'cmd.curl-pipe-shell',
    regex: /\b(?:curl|wget)(?:\.exe)?\b[^\r\n|]{0,300}\|\s*(?:sudo\s+)?(?:sh|bash|zsh|fish|python3?|node|powershell(?:\.exe)?|pwsh(?:\.exe)?|iex|invoke-expression)\b/i,
    label: 'Remote script piped directly into shell/interpreter',
  },
  {
    ruleId: 'cmd.ps-irm-iex',
    regex: /\b(?:irm|iwr|invoke-restmethod|invoke-webrequest)\b[^\r\n|]{0,240}\|\s*(?:iex|invoke-expression|powershell(?:\.exe)?|pwsh(?:\.exe)?|sh|bash)\b/i,
    label: 'PowerShell remote script piped directly into Invoke-Expression',
  },
  {
    ruleId: 'cmd.ps-iex-subexpr',
    regex: /\b(?:iex|invoke-expression)\s*\([^)\r\n]{0,240}\b(?:irm|iwr|invoke-restmethod|invoke-webrequest|downloadstring)\b/i,
    label: 'PowerShell Invoke-Expression executing remote downloaded script',
  },
];

const CATASTROPHIC_SYSTEM_ROOT_PREFIX_RE =
  /^\/(?:etc|usr|bin|sbin|lib|lib64|boot|dev|proc|sys|root|System|Library)(?:\/|$)/;
const CATASTROPHIC_TOP_LEVEL_DIR_RE =
  /^\/(?:var|home|Users|Applications|opt)(?:\/?\*?)?$/;
const CATASTROPHIC_WIN_TARGET_RE = new RegExp(`^(?:${WIN_CATASTROPHIC_TARGET_SOURCE})$`, 'i');

function isWindowsPathBackslash(current: string, nextChar: string | undefined): boolean {
  if (/^[A-Za-z]:/.test(current)) return true;
  if (/^\.\.?$/.test(current) && nextChar !== undefined && !/[\s"'|&;<>]/.test(nextChar)) {
    return true;
  }
  if (/^\.\.?\\/.test(current)) return true;
  if ((current === '' && nextChar === '\\') || current === '\\' || current.startsWith('\\\\')) {
    return true;
  }
  return false;
}

function normalizeShellCommandName(rawToken: string): string {
  const base = path.posix.basename(rawToken.replace(/\\/g, '/')).toLowerCase();
  return base.replace(/\.(?:exe|cmd|bat)$/i, '');
}

function splitShellSegments(commandLine: string): Array<{ segment: string; pipedToNext: boolean }> {
  const segments: Array<{ segment: string; pipedToNext: boolean }> = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let quoteStartIdx = -1;
  let escaped = false;

  for (let i = 0; i < commandLine.length; i++) {
    const ch = commandLine[i];
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\' && quote !== "'") {
      if (quote === '"' && commandLine[i + 1] === '"' && quoteStartIdx >= 0) {
        const inside = current.slice(quoteStartIdx);
        if (/^(?:[A-Za-z]:|\.\.?\\|\\\\)/.test(inside)) {
          current += ch;
          continue;
        }
      }
      current += ch;
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
        quoteStartIdx = -1;
      }
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      quoteStartIdx = current.length + 1;
      current += ch;
      continue;
    }
    const next = commandLine[i + 1];
    if (ch === '\n' || ch === ';') {
      if (current.trim()) segments.push({ segment: current.trim(), pipedToNext: false });
      current = '';
      continue;
    }
    if ((ch === '&' && next === '&') || (ch === '|' && next === '|')) {
      if (current.trim()) segments.push({ segment: current.trim(), pipedToNext: false });
      current = '';
      i++;
      continue;
    }
    if (ch === '|') {
      if (current.trim()) segments.push({ segment: current.trim(), pipedToNext: true });
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) segments.push({ segment: current.trim(), pipedToNext: false });
  return segments;
}

function tokenizeSimpleShellSegment(segment: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\' && quote !== "'") {
      if (isWindowsPathBackslash(current, segment[i + 1])) {
        current += ch;
        continue;
      }
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

function stripCommandWrappers(tokens: string[]): string[] {
  let idx = 0;
  while (idx < tokens.length) {
    const tok = tokens[idx];
    const normTok = normalizeShellCommandName(tok);
    if (
      normTok === 'sudo' ||
      normTok === 'env' ||
      normTok === 'command' ||
      normTok === 'nohup' ||
      normTok === 'time'
    ) {
      idx++;
      while (idx < tokens.length && tokens[idx].startsWith('-')) {
        const flag = tokens[idx];
        idx++;
        if ((flag === '-u' || flag === '-g' || flag === '-C') && idx < tokens.length) idx++;
      }
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) {
      idx++;
      continue;
    }
    break;
  }
  return tokens.slice(idx);
}

function isCatastrophicRmTarget(rawTarget: string): boolean {
  const trimmed = rawTarget.trim();
  if (!trimmed) return false;
  if (CATASTROPHIC_WIN_TARGET_RE.test(trimmed)) {
    return true;
  }
  const collapsed = trimmed.replace(/\/+/g, '/');
  const candidates = [collapsed];
  if (collapsed.startsWith('/')) {
    const normalizedAbs = path.posix.normalize(collapsed);
    if (normalizedAbs !== collapsed) candidates.push(normalizedAbs);
  }

  for (const target of candidates) {
    if (
      target === '/' ||
      target === '/*' ||
      target === '/.' ||
      target === '~' ||
      target === '~/' ||
      target === '~/*' ||
      target === '$HOME' ||
      target === '$HOME/' ||
      target === '$HOME/*' ||
      target === '${HOME}' ||
      target === '${HOME}/' ||
      target === '${HOME}/*' ||
      target === '*' ||
      target === '.' ||
      target === './' ||
      target === './*' ||
      target === '..' ||
      target === '../' ||
      target === '../*'
    ) {
      return true;
    }

    if (CATASTROPHIC_SYSTEM_ROOT_PREFIX_RE.test(target)) return true;
    if (CATASTROPHIC_TOP_LEVEL_DIR_RE.test(target)) return true;
  }
  return false;
}

function isCatastrophicRmCommand(commandLine: string): boolean {
  for (const { segment } of splitShellSegments(commandLine)) {
    const tokens = stripCommandWrappers(tokenizeSimpleShellSegment(segment));
    if (tokens.length < 2) continue;
    const cmd = normalizeShellCommandName(tokens[0]);
    if (cmd !== 'rm') continue;

    let hasRecursive = false;
    let endOfFlags = false;
    const targets: string[] = [];

    for (let i = 1; i < tokens.length; i++) {
      const tok = tokens[i];
      if (!endOfFlags && tok === '--') {
        endOfFlags = true;
        continue;
      }
      if (!endOfFlags && tok.startsWith('--')) {
        if (tok === '--recursive') hasRecursive = true;
        continue;
      }
      if (!endOfFlags && tok.startsWith('-') && tok.length > 1) {
        if (/[rR]/.test(tok.slice(1))) hasRecursive = true;
        continue;
      }
      targets.push(tok);
    }

    if (hasRecursive && targets.some((t) => isCatastrophicRmTarget(t))) {
      return true;
    }
  }
  return false;
}

function hasUnquotedRedirection(segment: string): boolean {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '>') return true;
  }
  return false;
}

function hasDangerousSqlCommand(commandLine: string): boolean {
  if (!SQL_DESTRUCTIVE_REGEX.test(commandLine)) return false;

  const segments = splitShellSegments(commandLine);
  for (const { segment, pipedToNext } of segments) {
    if (!SQL_DESTRUCTIVE_REGEX.test(segment)) continue;
    const tokens = stripCommandWrappers(tokenizeSimpleShellSegment(segment));
    if (tokens.length === 0) return true;

    const cmd = normalizeShellCommandName(tokens[0]);
    const sub = (tokens[1] ?? '').toLowerCase();

    const hasRedirection = hasUnquotedRedirection(segment);
    if (!pipedToNext && !hasRedirection) {
      if (cmd === 'git' && (sub === 'commit' || sub === 'log' || sub === 'tag')) {
        continue;
      }
      if (cmd === 'grep' || cmd === 'egrep' || cmd === 'fgrep' || cmd === 'rg' || cmd === 'ag') {
        continue;
      }
      if (cmd === 'echo' || cmd === 'printf') {
        continue;
      }
    }

    return true;
  }

  return false;
}

function isSafeEnvBasename(lowerBase: string): boolean {
  return lowerBase.startsWith('.env.') && SAFE_ENV_SUFFIXES.some((s) => lowerBase.endsWith(s));
}

function detectCommandSensitiveAccess(
  commandLine: string,
  customProtectedPaths: string[],
): { ruleId: string; category: 'sensitive-file' | 'custom'; label: string } | null {
  const rawTokens = commandLine.split(/[\s"'`()\[\]{}<>|&;,=@:]+/).filter(Boolean);

  for (const rawTok of rawTokens) {
    const norm = rawTok.replace(/\\/g, '/').replace(/\/+$/, '');
    if (!norm || norm === '-' || norm === '--') continue;
    const base = path.posix.basename(norm);
    const lowerBase = base.toLowerCase();

    if (
      lowerBase === '.env' ||
      lowerBase === '.envrc' ||
      lowerBase.startsWith('.env.') ||
      /^\.env[*?[]/.test(lowerBase)
    ) {
      if (!isSafeEnvBasename(lowerBase)) {
        return {
          ruleId: 'cmd.read-env-secret',
          category: 'sensitive-file',
          label: `Shell access/exfiltration of .env file (${base})`,
        };
      }
      continue;
    }

    if (/(?:^|\/)\.ssh(?:\/|$)/i.test(norm)) {
      return {
        ruleId: 'cmd.read-ssh-aws',
        category: 'sensitive-file',
        label: 'Shell access/exfiltration of SSH directory',
      };
    }

    if (/(?:^|\/)\.aws\/(?:credentials|config)(?:\/|$)/i.test(norm)) {
      return {
        ruleId: 'cmd.read-ssh-aws',
        category: 'sensitive-file',
        label: 'Shell access/exfiltration of AWS credentials',
      };
    }

    if (/(?:^|\/)\.gnupg(?:\/|$)/i.test(norm)) {
      return {
        ruleId: 'cmd.read-ssh-aws',
        category: 'sensitive-file',
        label: 'Shell access/exfiltration of GPG private keyring',
      };
    }

    if (/(?:^|\/)\.kube\/config$/i.test(norm)) {
      return {
        ruleId: 'cmd.read-ssh-aws',
        category: 'sensitive-file',
        label: 'Shell access/exfiltration of Kubernetes config',
      };
    }

    if (SHELL_SENSITIVE_BASENAMES.has(lowerBase)) {
      return {
        ruleId: 'cmd.read-ssh-aws',
        category: 'sensitive-file',
        label: `Shell access/exfiltration of credential file (${base})`,
      };
    }

    for (const rawPat of customProtectedPaths) {
      const pat = rawPat.trim();
      if (!pat) continue;
      if (norm.toLowerCase().includes(pat.toLowerCase())) {
        return {
          ruleId: 'custom.path',
          category: 'custom',
          label: `Custom protected path rule (${pat})`,
        };
      }
    }
  }

  return null;
}

export function maskSecret(raw: string): string {
  const clean = raw.trim();
  if (clean.length <= 10) return `${clean.slice(0, 2)}****`;
  return `${clean.slice(0, 5)}****${clean.slice(-3)}`;
}

export function redactCommand(cmd: string): string {
  if (!cmd) return '';
  let out = cmd;

  out = out.replace(
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----|$)/g,
    (match) => (match.includes('****') ? match : maskSecret(match)),
  );

  out = out.replace(
    /\b((?:Bearer|Basic|Token)\s+)([A-Za-z0-9._~+/=-]{6,})/gi,
    (full, prefix: string, token: string) => (token.includes('****') ? full : `${prefix}${maskSecret(token)}`),
  );

  out = out.replace(
    /([a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:)([^@\s]+)@/gi,
    (full, prefix: string, secret: string) => (secret.includes('****') ? full : `${prefix}${maskSecret(secret)}@`),
  );

  out = out.replace(
    /((?:^|\s)(?:-u|--user)(?:\s+|=))([^:\s'"]+):([^\s'"]+)/g,
    (full, flag: string, user: string, pass: string) => (pass.includes('****') ? full : `${flag}${user}:${maskSecret(pass)}`),
  );

  for (const pat of SECRET_PATTERNS) {
    pat.regex.lastIndex = 0;
    out = out.replace(pat.regex, (match) => (match.includes('****') ? match : maskSecret(match)));
  }

  out = out.replace(
    /(^|[\s"'`({;,])((?:--)?[A-Za-z0-9_.-]*(?:key|secret|token|password|passwd|pwd|credential|auth|cookie)[A-Za-z0-9_.-]*['"`]?\s*[:=]\s*)(['"`]?)([^\s'"`;|&(){}]{4,})(\3)/gi,
    (full, lead: string, prefix: string, quote: string, val: string, endQuote: string) => {
      if (val.includes('****')) return full;
      if (/^\$(?:\{[A-Za-z0-9_]+\}|[A-Za-z0-9_]+)$/.test(val)) return full;
      if (/^(?:true|false|null|none|undefined|bearer|basic|token|digest|oauth)$/i.test(val)) return full;
      return `${lead}${prefix}${quote}${maskSecret(val)}${endQuote}`;
    },
  );

  return out;
}

export function scanTextForSecrets(text: string): SecretFinding[] {
  if (!text) return [];
  const findings: SecretFinding[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    if (!lineText || lineText.length > 20_000) continue;
    for (const pat of SECRET_PATTERNS) {
      pat.regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pat.regex.exec(lineText)) !== null) {
        const masked = maskSecret(match[0]);
        const key = `${pat.ruleId}:${i + 1}:${masked}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({
          ruleId: pat.ruleId,
          label: pat.label,
          severity: pat.severity,
          line: i + 1,
          preview: masked,
        });
        if (findings.length >= 25) return findings;
      }
    }
  }
  return findings;
}

export function isSensitivePath(filePath: string, customPatterns: string[] = []): { sensitive: boolean; ruleId?: string; label?: string } {
  if (!filePath) return { sensitive: false };
  const normalized = filePath.replace(/\\/g, '/').trim().replace(/\/+$/, '');
  if (!normalized) return { sensitive: false };
  const base = path.posix.basename(normalized);
  const lowerBase = base.toLowerCase();

  for (const rule of SENSITIVE_PATH_REGEXES) {
    if (rule.regex.test(normalized)) {
      return { sensitive: true, ruleId: rule.ruleId, label: rule.label };
    }
  }

  for (const rawPat of customPatterns) {
    const pat = rawPat.trim();
    if (!pat) continue;
    if (normalized.toLowerCase().includes(pat.toLowerCase())) {
      return { sensitive: true, ruleId: 'custom.path', label: `Custom protected path rule (${pat})` };
    }
  }

  if (isSafeEnvBasename(lowerBase)) {
    return { sensitive: false };
  }

  if (lowerBase === '.env' || lowerBase === '.envrc' || lowerBase.startsWith('.env.')) {
    return { sensitive: true, ruleId: 'path.dotenv', label: `Environment secrets file (${base})` };
  }
  if (SENSITIVE_BASENAMES.has(lowerBase)) {
    return { sensitive: true, ruleId: 'path.sensitive-file', label: `Protected credential file (${base})` };
  }

  const ext = path.posix.extname(lowerBase);
  if (SENSITIVE_EXTENSIONS.has(ext)) {
    return { sensitive: true, ruleId: 'path.private-key-ext', label: `Private key / certificate file (${base})` };
  }

  return { sensitive: false };
}

export function extractTargetPath(args: Record<string, unknown>): string | null {
  const candidates = [
    args.Path,
    args.path,
    args.TargetFile,
    args.targetFile,
    args.target_file,
    args.TargetPath,
    args.targetPath,
    args.target_path,
    args.AbsolutePath,
    args.absolutePath,
    args.absolute_path,
    args.filePath,
    args.file_path,
    args.FilePath,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c.trim();
  }
  return null;
}

export function extractCommandLine(args: Record<string, unknown>): string | null {
  const candidates = [args.CommandLine, args.commandLine, args.command, args.cmd];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c.trim();
  }
  return null;
}

export function extractWritePayload(args: Record<string, unknown>): string {
  const parts: string[] = [];
  const directKeys = [
    'Content',
    'content',
    'CodeContent',
    'Replacement',
    'replacement',
    'ReplacementContent',
    'new_str',
    'newString',
    'patch',
    'Patch',
    'diff',
    'Diff',
    'input',
    'Input',
    'text',
    'Text',
    'body',
    'Body',
    'file_text',
  ];
  for (const key of directKeys) {
    if (typeof args[key] === 'string') parts.push(args[key] as string);
  }
  if (Array.isArray(args.ReplacementChunks)) {
    for (const chunk of args.ReplacementChunks) {
      if (chunk && typeof chunk === 'object' && typeof (chunk as Record<string, unknown>).ReplacementContent === 'string') {
        parts.push((chunk as Record<string, unknown>).ReplacementContent as string);
      }
    }
  }
  return parts.join('\n');
}

function evaluatePermissionModeGate(
  toolName: string,
  policy: GuardPolicy,
  args?: Record<string, unknown>,
): PolicyEvaluation | null {
  const mode = normalizePermissionMode(policy.permissionMode);
  if (mode === 'balanced-dev') return null;

  const hasCmd = Boolean(args && extractCommandLine(args));
  const restricted = isMutatingFileToolName(toolName) || isCommandExecToolName(toolName) || hasCmd;
  if (!restricted) return null;

  if (mode === 'readonly-audit') {
    return {
      decision: 'deny',
      category: 'permission-mode',
      ruleId: 'mode.readonly-audit',
      reason: `Blocked ${toolName}: Guard permission mode is readonly-audit (read-only)`,
      findings: [],
    };
  }

  if (mode === 'strict-gate') {
    return {
      decision: 'force_ask',
      category: 'permission-mode',
      ruleId: 'mode.strict-gate',
      reason: `Confirmation required for ${toolName}: Guard permission mode is strict-gate`,
      findings: [],
    };
  }

  return null;
}

function finalizeEvaluation(
  highRiskEval: PolicyEvaluation | null,
  toolName: string,
  policy: GuardPolicy,
  args?: Record<string, unknown>,
): PolicyEvaluation {
  // High-risk deny can never be downgraded by permission mode.
  if (highRiskEval && highRiskEval.decision === 'deny') {
    return highRiskEval;
  }

  const modeEval = evaluatePermissionModeGate(toolName, policy, args);
  if (highRiskEval && modeEval) {
    // Keep stricter decision when both match (e.g. curl|sh ask under readonly-audit -> deny).
    if (DECISION_SEVERITY[modeEval.decision] > DECISION_SEVERITY[highRiskEval.decision]) {
      return {
        ...highRiskEval,
        decision: modeEval.decision,
        reason: `${highRiskEval.reason} (${modeEval.ruleId})`,
      };
    }
    return highRiskEval;
  }

  if (highRiskEval) return highRiskEval;
  if (modeEval) return modeEval;
  return { decision: 'allow', category: 'safe', reason: 'Passed all guardrails', findings: [] };
}

export function evaluateToolCall(
  toolName: string,
  args: Record<string, unknown>,
  policy: GuardPolicy,
  options?: { resolvedTargetPath?: string },
): PolicyEvaluation {
  if (!policy.enabled) {
    return { decision: 'allow', category: 'safe', reason: 'Guard policy disabled', findings: [] };
  }

  const lowerTool = toolName.trim().toLowerCase();
  const targetPath = extractTargetPath(args);
  const commandLine = extractCommandLine(args);

  let highRiskEval: PolicyEvaluation | null = null;

  // 1. Check sensitive file reads/writes/deletes (both literal path and resolved symlink target)
  if (targetPath && policy.protectEnvAndKeys !== 'allow') {
    const check = isSensitivePath(targetPath, policy.customProtectedPaths);
    if (check.sensitive) {
      highRiskEval = {
        decision: policy.protectEnvAndKeys,
        category: check.ruleId?.startsWith('custom.') ? 'custom' : 'sensitive-file',
        ruleId: check.ruleId,
        reason: `Blocked ${toolName} on protected path: ${check.label} (${path.basename(targetPath)})`,
        findings: [],
      };
    } else if (options?.resolvedTargetPath && options.resolvedTargetPath !== targetPath) {
      const realCheck = isSensitivePath(options.resolvedTargetPath, policy.customProtectedPaths);
      if (realCheck.sensitive) {
        highRiskEval = {
          decision: policy.protectEnvAndKeys,
          category: realCheck.ruleId?.startsWith('custom.') ? 'custom' : 'sensitive-file',
          ruleId: realCheck.ruleId,
          reason: `Blocked ${toolName} via symlink resolving to protected path: ${realCheck.label} (${path.basename(options.resolvedTargetPath)})`,
          findings: [],
        };
      }
    }
  }

  if (highRiskEval) {
    return finalizeEvaluation(highRiskEval, toolName, policy, args);
  }

  // 2. Check outgoing write/edit/patch/create payloads for accidentally hardcoded secrets
  const isMutatingFileTool =
    MUTATING_FILE_TOOL_NAMES.has(lowerTool) ||
    /write|edit|replace|patch_file|apply_patch|create_file|patch/.test(lowerTool);
  if (isMutatingFileTool && policy.blockSecretWrites !== 'allow') {
    const payload = extractWritePayload(args);
    if (payload) {
      const findings = scanTextForSecrets(payload);
      if (findings.length > 0) {
        const summary = findings
          .slice(0, 3)
          .map((f) => `${f.label} (${f.preview})`)
          .join(', ');
        return finalizeEvaluation(
          {
            decision: policy.blockSecretWrites,
            category: 'secret-leak',
            ruleId: findings[0].ruleId,
            reason: `Detected ${findings.length} potential secret(s) in ${toolName} payload: ${summary}`,
            findings,
          },
          toolName,
          policy,
          args,
        );
      }
    }
  }

  // 3. Check shell command execution
  if (commandLine) {
    // 3a. Destructive commands
    if (policy.blockDestructiveCommands !== 'allow') {
      if (isCatastrophicRmCommand(commandLine)) {
        return finalizeEvaluation(
          {
            decision: policy.blockDestructiveCommands,
            category: 'destructive-command',
            ruleId: 'cmd.rm-rf-root',
            reason: 'Blocked dangerous command: Catastrophic recursive delete (rm -r/-rf targeting /, ~, $HOME, or system root)',
            findings: [],
          },
          toolName,
          policy,
          args,
        );
      }
      if (hasDangerousSqlCommand(commandLine)) {
        return finalizeEvaluation(
          {
            decision: policy.blockDestructiveCommands,
            category: 'destructive-command',
            ruleId: 'cmd.sql-drop',
            reason: 'Blocked dangerous command: Destructive SQL DROP/TRUNCATE statement',
            findings: [],
          },
          toolName,
          policy,
          args,
        );
      }
      for (const rule of DESTRUCTIVE_COMMAND_RULES) {
        if (rule.regex.test(commandLine)) {
          return finalizeEvaluation(
            {
              decision: policy.blockDestructiveCommands,
              category: 'destructive-command',
              ruleId: rule.ruleId,
              reason: `Blocked dangerous command: ${rule.label}`,
              findings: [],
            },
            toolName,
            policy,
            args,
          );
        }
      }
    }

    // 3b. Custom blocked commands
    for (const custom of policy.customBlockedCommands) {
      const trimmed = custom.trim();
      if (trimmed && commandLine.toLowerCase().includes(trimmed.toLowerCase())) {
        return finalizeEvaluation(
          {
            decision: 'deny',
            category: 'custom',
            ruleId: 'custom.command',
            reason: `Matched custom blocked command pattern: "${trimmed}"`,
            findings: [],
          },
          toolName,
          policy,
          args,
        );
      }
    }

    // 3c. Shell .env / SSH / AWS / GPG / credential access
    if (policy.protectEnvAndKeys !== 'allow') {
      const hit = detectCommandSensitiveAccess(commandLine, policy.customProtectedPaths);
      if (hit) {
        return finalizeEvaluation(
          {
            decision: policy.protectEnvAndKeys,
            category: hit.category,
            ruleId: hit.ruleId,
            reason: `Blocked credential access in shell: ${hit.label}`,
            findings: [],
          },
          toolName,
          policy,
          args,
        );
      }
    }

    // 3d. Remote curl/wget | sh pipe
    if (policy.askOnNetworkPipes !== 'allow') {
      for (const rule of NETWORK_PIPE_RULES) {
        if (rule.regex.test(commandLine)) {
          return finalizeEvaluation(
            {
              decision: policy.askOnNetworkPipes,
              category: 'network-pipe',
              ruleId: rule.ruleId,
              reason: `Requires confirmation: ${rule.label}`,
              findings: [],
            },
            toolName,
            policy,
            args,
          );
        }
      }
    }

    // 3e. Secrets directly echoed/embedded in shell commands
    if (policy.blockSecretWrites !== 'allow') {
      const cmdSecrets = scanTextForSecrets(commandLine);
      if (cmdSecrets.length > 0) {
        return finalizeEvaluation(
          {
            decision: policy.blockSecretWrites,
            category: 'secret-leak',
            ruleId: cmdSecrets[0].ruleId,
            reason: `Command contains inline secret (${cmdSecrets[0].label}: ${cmdSecrets[0].preview})`,
            findings: cmdSecrets,
          },
          toolName,
          policy,
          args,
        );
      }
    }
  }

  return finalizeEvaluation(null, toolName, policy, args);
}
