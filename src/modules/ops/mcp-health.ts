import fs from 'node:fs';
import path from 'node:path';
import { canonicalRealpathSync, isPathInsideDir } from '../../core/fs-safe.js';
import {
  containsSecretPattern,
  ENV_VAR_EMBED_RE,
  extractSafeEnvPlaceholderTokens,
  JWT_LIKE_RE,
  OAUTH_OR_EXPIRING_KEY_RE,
  PURE_ENV_REF_RE,
  redactSecretsInMessage,
  sanitizeCrossClientFinding,
  sanitizeDisplayPath,
  sanitizeMcpIdentifier,
  SENSITIVE_KEY_NAME_RE,
  UNRESOLVED_PLACEHOLDER_RE,
} from './paths.js';
import {
  DEFAULT_TOOLS_PER_EXTERNAL_MCP_SERVER,
  type CrossClientFinding,
  type McpHealthFinding,
} from './types.js';

const LOCAL_RUNTIME_COMMANDS = new Set([
  'node',
  'tsx',
  'ts-node',
  'python',
  'python3',
  'bash',
  'sh',
  'zsh',
  'bun',
  'deno',
  'ruby',
  'perl',
  'php',
]);

const KNOWN_PATH_CLI_COMMANDS = new Set([
  ...LOCAL_RUNTIME_COMMANDS,
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'uv',
  'uvx',
  'docker',
  'git',
  'cmd',
  'powershell',
  'pwsh',
]);

const SCRIPT_EXT_RE = /\.(?:[cm]?js|[cm]?ts|py|sh|bash|zsh|rb|pl|php|exe|bin|cmd|bat)$/i;
const WINDOWS_ABS_PATH_RE = /^[A-Za-z]:[\\/]/;

function normalizeRuntimeCommandBase(command: string): string {
  return path.posix
    .basename(command.replace(/\\/g, '/'))
    .toLowerCase()
    .replace(/\.(?:exe|cmd|bat)$/i, '');
}

function findDuplicateServerKeysInJson(rawText: string): string[] {
  const duplicates = new Set<string>();
  try {
    let i = 0;
    const len = rawText.length;
    const skipWs = () => {
      while (i < len && /\s/.test(rawText[i])) i += 1;
    };
    const readString = (): string | null => {
      if (rawText[i] !== '"') return null;
      i += 1;
      let out = '';
      while (i < len) {
        const ch = rawText[i];
        if (ch === '\\') {
          if (i + 1 < len) out += rawText[i + 1];
          i += 2;
          continue;
        }
        if (ch === '"') {
          i += 1;
          return out;
        }
        out += ch;
        i += 1;
      }
      return null;
    };
    const skipValue = (): void => {
      skipWs();
      if (i >= len) return;
      const ch = rawText[i];
      if (ch === '"') {
        readString();
        return;
      }
      if (ch === '{' || ch === '[') {
        const open = ch;
        const close = ch === '{' ? '}' : ']';
        let depth = 1;
        i += 1;
        while (i < len && depth > 0) {
          const c = rawText[i];
          if (c === '"') {
            readString();
            continue;
          }
          if (c === open) depth += 1;
          else if (c === close) depth -= 1;
          i += 1;
        }
        return;
      }
      while (i < len && !/[,}\]\s]/.test(rawText[i])) i += 1;
    };
    const scanServersObject = (): void => {
      skipWs();
      if (rawText[i] !== '{') {
        skipValue();
        return;
      }
      i += 1;
      const seen = new Set<string>();
      while (i < len) {
        skipWs();
        if (rawText[i] === '}') {
          i += 1;
          return;
        }
        const key = readString();
        if (key === null) return;
        if (seen.has(key)) duplicates.add(key);
        else seen.add(key);
        skipWs();
        if (rawText[i] !== ':') return;
        i += 1;
        skipValue();
        skipWs();
        if (rawText[i] === ',') i += 1;
      }
    };

    skipWs();
    if (rawText[i] !== '{') return [];
    i += 1;
    while (i < len) {
      skipWs();
      if (rawText[i] === '}') break;
      const topKey = readString();
      if (topKey === null) break;
      skipWs();
      if (rawText[i] !== ':') break;
      i += 1;
      if (topKey === 'mcpServers' || topKey === 'servers') {
        scanServersObject();
      } else {
        skipValue();
      }
      skipWs();
      if (rawText[i] === ',') i += 1;
    }
  } catch {
    // ignore scanner failures; JSON.parse handles syntax reporting
  }
  return Array.from(duplicates);
}

export interface McpConfigInspectionResult {
  serverCount: number;
  serverNames: string[];
  envKeyCount: number;
  activeExternalServers: number;
  estimatedExternalTools: number;
  findings: McpHealthFinding[];
  crossClientFindings: CrossClientFinding[];
}

export function inspectMcpConfigSafe(
  rawText: string,
  relPath: string,
  realFilePath: string,
  realRoot: string,
  seenServerFiles: Map<string, string>,
): McpConfigInspectionResult {
  const findings: McpHealthFinding[] = [];
  const crossClientFindings: CrossClientFinding[] = [];
  const pushFinding = (finding: McpHealthFinding): void => {
    findings.push({
      severity: finding.severity,
      ...(finding.serverName !== undefined
        ? { serverName: sanitizeMcpIdentifier(finding.serverName) }
        : {}),
      file: redactSecretsInMessage(finding.file),
      message: redactSecretsInMessage(finding.message),
    });
  };
  const pushCrossClientFinding = (finding: CrossClientFinding): void => {
    crossClientFindings.push(sanitizeCrossClientFinding(finding));
  };

  let parsed: Record<string, unknown>;
  try {
    const rawParsed = JSON.parse(rawText);
    if (!rawParsed || typeof rawParsed !== 'object' || Array.isArray(rawParsed)) {
      pushFinding({
        severity: 'error',
        file: relPath,
        message: 'MCP configuration root must be a JSON object.',
      });
      return {
        serverCount: 0,
        serverNames: [],
        envKeyCount: 0,
        activeExternalServers: 0,
        estimatedExternalTools: 0,
        findings,
        crossClientFindings,
      };
    }
    parsed = rawParsed as Record<string, unknown>;
  } catch {
    pushFinding({
      severity: 'error',
      file: relPath,
      message: 'Invalid JSON syntax in MCP configuration file.',
    });
    return {
      serverCount: 0,
      serverNames: [],
      envKeyCount: 0,
      activeExternalServers: 0,
      estimatedExternalTools: 0,
      findings,
      crossClientFindings,
    };
  }

  for (const dupName of findDuplicateServerKeysInJson(rawText)) {
    const safeDupName = sanitizeMcpIdentifier(dupName);
    pushFinding({
      severity: 'warn',
      serverName: safeDupName,
      file: relPath,
      message: `Duplicate MCP server key "${safeDupName}" within the same configuration file.`,
    });
    pushCrossClientFinding({
      severity: 'warn',
      code: 'duplicate-plugin-or-server',
      client: 'shared',
      file: relPath,
      message: `Duplicate MCP server key "${safeDupName}" declared multiple times inside "${relPath}" (#1937).`,
      suggestion: 'Remove duplicate server keys so the host does not shadow or double-register MCP tools.',
    });
  }

  const serversObj =
    parsed.mcpServers && typeof parsed.mcpServers === 'object' && !Array.isArray(parsed.mcpServers)
      ? (parsed.mcpServers as Record<string, unknown>)
      : parsed.servers && typeof parsed.servers === 'object' && !Array.isArray(parsed.servers)
        ? (parsed.servers as Record<string, unknown>)
        : null;

  if (!serversObj) {
    pushFinding({
      severity: 'warn',
      file: relPath,
      message: 'No "mcpServers" or "servers" object found in MCP configuration.',
    });
    return {
      serverCount: 0,
      serverNames: [],
      envKeyCount: 0,
      activeExternalServers: 0,
      estimatedExternalTools: 0,
      findings,
      crossClientFindings,
    };
  }

  const allKeys = Object.keys(serversObj);
  const serverNames = allKeys.slice(0, 30).map(sanitizeMcpIdentifier);
  const configDir = path.dirname(realFilePath);
  const isInsideWorkspace = (p: string): boolean => isPathInsideDir(realRoot, p);

  const checkLocalRelativeScript = (
    serverName: string,
    candidate: string,
    sourceLabel: 'command' | 'args',
  ): boolean => {
    const trimmed = candidate.trim();
    if (!trimmed || trimmed.startsWith('-') || trimmed.includes('://') || trimmed.includes('=')) return false;
    if (UNRESOLVED_PLACEHOLDER_RE.test(trimmed) || ENV_VAR_EMBED_RE.test(trimmed)) return false;
    if (path.isAbsolute(trimmed) || WINDOWS_ABS_PATH_RE.test(trimmed)) return false;

    const posixCandidate = trimmed.replace(/\\/g, '/');
    const fromConfigDir = path.resolve(configDir, posixCandidate);
    const fromWorkspaceRoot = path.resolve(realRoot, posixCandidate);
    const configInside = isInsideWorkspace(fromConfigDir);
    const rootInside = isInsideWorkspace(fromWorkspaceRoot);

    if (!configInside && !rootInside) {
      pushFinding({
        severity: 'error',
        serverName,
        file: relPath,
        message: `Relative script in ${sourceLabel} escapes workspace boundary (${sanitizeDisplayPath(trimmed)}).`,
      });
      return true;
    }

    const existsSafe = (absPath: string): boolean => {
      if (!isInsideWorkspace(absPath)) return false;
      try {
        if (!fs.existsSync(absPath)) return false;
        const real = canonicalRealpathSync(absPath);
        return isInsideWorkspace(real);
      } catch {
        return false;
      }
    };

    if (!existsSafe(fromConfigDir) && !existsSafe(fromWorkspaceRoot)) {
      pushFinding({
        severity: 'error',
        serverName,
        file: relPath,
        message: `Local script referenced in ${sourceLabel} does not exist: ${sanitizeDisplayPath(trimmed)}`,
      });
      return true;
    }
    return false;
  };

  let envKeyCount = 0;
  let activeExternalServers = 0;
  let estimatedExternalTools = 0;

  for (const serverName of allKeys) {
    const safeServerName = sanitizeMcpIdentifier(serverName);
    if (containsSecretPattern(serverName)) {
      pushFinding({
        severity: 'warn',
        serverName: safeServerName,
        file: relPath,
        message: `MCP server name contains a hardcoded secret-like token (<redacted-path>).`,
      });
    }
    const prevFile = seenServerFiles.get(serverName);
    const isDuplicateAcrossFiles = prevFile !== undefined && prevFile !== relPath;
    if (isDuplicateAcrossFiles) {
      pushFinding({
        severity: 'warn',
        serverName: safeServerName,
        file: relPath,
        message: `Duplicate MCP server "${safeServerName}" (already defined in ${prevFile}).`,
      });
      pushCrossClientFinding({
        severity: 'warn',
        code: 'duplicate-plugin-or-server',
        client: 'shared',
        file: relPath,
        message: `Duplicate MCP server "${safeServerName}" declared in both "${prevFile}" and "${relPath}" (#1937).`,
        suggestion: 'Consolidate shared MCP servers into a single workspace config or disable duplicates in secondary client configs.',
      });
    } else if (!prevFile) {
      seenServerFiles.set(serverName, relPath);
    }

    const rawDef = serversObj[serverName];
    if (!rawDef || typeof rawDef !== 'object' || Array.isArray(rawDef)) {
      pushFinding({
        severity: 'error',
        serverName: safeServerName,
        file: relPath,
        message: `Server "${safeServerName}" definition must be a JSON object.`,
      });
      continue;
    }

    const def = rawDef as Record<string, unknown>;
    const envPlaceholderRefs: string[] = [];
    const recordEnvPlaceholder = (fieldLabel: string, rawVal: string): void => {
      const tokens = extractSafeEnvPlaceholderTokens(rawVal);
      if (tokens.length > 0) {
        envPlaceholderRefs.push(`${fieldLabel} (${tokens.join(', ')})`);
      }
    };

    const disabled = def.disabled === true || def.enabled === false;
    if (!disabled && !isDuplicateAcrossFiles) {
      activeExternalServers += 1;
      if (Array.isArray(def.tools)) {
        estimatedExternalTools += def.tools.length;
      } else {
        estimatedExternalTools += DEFAULT_TOOLS_PER_EXTERNAL_MCP_SERVER;
      }
    }

    const command = typeof def.command === 'string' ? def.command.trim() : '';
    const urlCandidate =
      typeof def.url === 'string'
        ? def.url.trim()
        : typeof def.serverUrl === 'string'
          ? def.serverUrl.trim()
          : typeof def.httpUrl === 'string'
            ? def.httpUrl.trim()
            : '';

    if (!command && !urlCandidate) {
      pushFinding({
        severity: 'error',
        serverName: safeServerName,
        file: relPath,
        message: `Server "${safeServerName}" is missing required "command" or "url" transport field.`,
      });
    }

    const cmdBase = normalizeRuntimeCommandBase(command);
    const isLocalRuntime = LOCAL_RUNTIME_COMMANDS.has(cmdBase);

    if (command) {
      recordEnvPlaceholder('command', command);
      const isWinAbsCommand = WINDOWS_ABS_PATH_RE.test(command);
      const hasPathSep = command.includes('/') || command.includes('\\');
      const isBareKnownCli = !hasPathSep && KNOWN_PATH_CLI_COMMANDS.has(cmdBase);
      if (UNRESOLVED_PLACEHOLDER_RE.test(command) || ENV_VAR_EMBED_RE.test(command)) {
        pushFinding({
          severity: 'warn',
          serverName: safeServerName,
          file: relPath,
          message: `Server "${safeServerName}" contains an unresolved placeholder in "command" (value redacted).`,
        });
      } else if (
        command.startsWith('./') ||
        command.startsWith('../') ||
        command.startsWith('.\\') ||
        command.startsWith('..\\') ||
        (!path.isAbsolute(command) &&
          !isWinAbsCommand &&
          !command.startsWith('@') &&
          !isBareKnownCli &&
          (hasPathSep || SCRIPT_EXT_RE.test(command)))
      ) {
        const reported = checkLocalRelativeScript(safeServerName, command, 'command');
        if (!reported && containsSecretPattern(command)) {
          pushFinding({
            severity: 'warn',
            serverName: safeServerName,
            file: relPath,
            message: `Server "${safeServerName}" contains a hardcoded secret-like value in "command" (<redacted-path>).`,
          });
        }
      } else if (containsSecretPattern(command)) {
        pushFinding({
          severity: 'warn',
          serverName: safeServerName,
          file: relPath,
          message: `Server "${safeServerName}" contains a hardcoded secret-like value in "command" (<redacted-path>).`,
        });
      }
    }

    if (urlCandidate) {
      recordEnvPlaceholder('url', urlCandidate);
      if (UNRESOLVED_PLACEHOLDER_RE.test(urlCandidate) || ENV_VAR_EMBED_RE.test(urlCandidate)) {
        pushFinding({
          severity: 'warn',
          serverName: safeServerName,
          file: relPath,
          message: `Server "${safeServerName}" contains an unresolved placeholder in "url" (value redacted).`,
        });
      } else if (containsSecretPattern(urlCandidate)) {
        pushFinding({
          severity: 'warn',
          serverName: safeServerName,
          file: relPath,
          message: `Server "${safeServerName}" contains a hardcoded secret-like token in "url" (<redacted-path>).`,
        });
      }
    }

    if (Array.isArray(def.args)) {
      let warnedArgPlaceholder = false;
      for (let argIdx = 0; argIdx < def.args.length; argIdx += 1) {
        const rawArg = def.args[argIdx];
        if (typeof rawArg !== 'string') continue;
        const arg = rawArg.trim();
        if (!arg) continue;
        recordEnvPlaceholder(`args[${argIdx}]`, arg);
        if (UNRESOLVED_PLACEHOLDER_RE.test(arg)) {
          if (!warnedArgPlaceholder) {
            warnedArgPlaceholder = true;
            pushFinding({
              severity: 'warn',
              serverName: safeServerName,
              file: relPath,
              message: `Server "${safeServerName}" contains an unresolved placeholder in "args" (value redacted).`,
            });
          }
          continue;
        }
        const explicitRelative =
          arg.startsWith('./') ||
          arg.startsWith('../') ||
          arg.startsWith('.\\') ||
          arg.startsWith('..\\');
        const isWinAbsArg = WINDOWS_ABS_PATH_RE.test(arg);
        const runtimeScriptCandidate =
          isLocalRuntime &&
          !arg.startsWith('-') &&
          !arg.startsWith('@') &&
          !arg.includes('://') &&
          !arg.includes('=') &&
          !path.isAbsolute(arg) &&
          !isWinAbsArg &&
          (arg.includes('/') || arg.includes('\\') || SCRIPT_EXT_RE.test(arg));
        if (explicitRelative || runtimeScriptCandidate) {
          const reported = checkLocalRelativeScript(safeServerName, arg, 'args');
          if (!reported && containsSecretPattern(arg)) {
            pushFinding({
              severity: 'warn',
              serverName: safeServerName,
              file: relPath,
              message: `Server "${safeServerName}" contains a hardcoded secret-like argument in "args" (<redacted-path>).`,
            });
          }
        } else if (containsSecretPattern(arg)) {
          pushFinding({
            severity: 'warn',
            serverName: safeServerName,
            file: relPath,
            message: `Server "${safeServerName}" contains a hardcoded secret-like argument in "args" (<redacted-path>).`,
          });
        }
      }
    }

    const inspectKeyValueMap = (mapObj: unknown, containerName: 'env' | 'headers', countLiterals: boolean) => {
      if (!mapObj || typeof mapObj !== 'object' || Array.isArray(mapObj)) return;
      for (const [k, v] of Object.entries(mapObj as Record<string, unknown>)) {
        if (typeof v !== 'string') continue;
        const val = v.trim();
        if (!val) continue;
        const cleanedKey = k.replace(/[^\w.-]/g, '').slice(0, 64) || 'key';
        const safeKey = sanitizeMcpIdentifier(cleanedKey);

        recordEnvPlaceholder(`${containerName}.${safeKey}`, val);

        if (UNRESOLVED_PLACEHOLDER_RE.test(val)) {
          pushFinding({
            severity: 'warn',
            serverName: safeServerName,
            file: relPath,
            message: `Server "${safeServerName}" has an unresolved placeholder in ${containerName}.${safeKey} (value redacted).`,
          });
          continue;
        }

        const isEnvRef = PURE_ENV_REF_RE.test(val);
        if (!isEnvRef) {
          if (countLiterals) {
            envKeyCount += 1;
          }
          if (OAUTH_OR_EXPIRING_KEY_RE.test(k) || JWT_LIKE_RE.test(val)) {
            pushFinding({
              severity: 'warn',
              serverName: safeServerName,
              file: relPath,
              message: `Server "${safeServerName}" has a static OAuth/token value in ${containerName}.${safeKey} (value redacted) that may expire or leak.`,
            });
          } else if (SENSITIVE_KEY_NAME_RE.test(k) || containsSecretPattern(val)) {
            pushFinding({
              severity: 'warn',
              serverName: safeServerName,
              file: relPath,
              message: `Server "${safeServerName}" hardcodes a literal secret in ${containerName}.${safeKey} (value redacted); use an env var placeholder instead.`,
            });
          }
        }
      }
    };

    inspectKeyValueMap(def.env, 'env', true);
    inspectKeyValueMap(def.headers, 'headers', false);

    if (envPlaceholderRefs.length > 0) {
      const preview = envPlaceholderRefs.slice(0, 6).join(', ');
      const suffix = envPlaceholderRefs.length > 6 ? `, +${envPlaceholderRefs.length - 6} more` : '';
      pushCrossClientFinding({
        severity: 'warn',
        code: 'mcp-unexpanded-env',
        client: 'antigravity',
        file: relPath,
        message: `Server "${safeServerName}" references static env placeholder(s) (${preview}${suffix}). Antigravity 2.0 static MCP configs may not auto-expand \${ENV_VAR} across all transports (#233).`,
        suggestion:
          'Verify host-level environment injection or use OS keychain / a thin local wrapper script instead of relying on static ${ENV_VAR} expansion in MCP JSON.',
      });
    }

    // Check top-level OAuth / token expiry hints (strictly redacted)
    const expiryRaw = def.expiresAt ?? def.tokenExpiry ?? def.expires_at;
    if (typeof expiryRaw === 'string' || typeof expiryRaw === 'number') {
      const ts = typeof expiryRaw === 'number' ? expiryRaw : Date.parse(expiryRaw);
      const expired = Number.isFinite(ts) && ts < Date.now();
      pushFinding({
        severity: expired ? 'error' : 'warn',
        serverName: safeServerName,
        file: relPath,
        message: expired
          ? `Server "${safeServerName}" contains an expired static OAuth/token expiry field (value redacted).`
          : `Server "${safeServerName}" defines a static OAuth/token expiry field (value redacted); verify auto-refresh is enabled.`,
      });
    } else if (
      (typeof def.accessToken === 'string' && def.accessToken.trim() && !PURE_ENV_REF_RE.test(def.accessToken.trim())) ||
      (typeof def.refreshToken === 'string' && def.refreshToken.trim() && !PURE_ENV_REF_RE.test(def.refreshToken.trim())) ||
      (def.oauth && typeof def.oauth === 'object')
    ) {
      pushFinding({
        severity: 'warn',
        serverName: safeServerName,
        file: relPath,
        message: `Server "${safeServerName}" contains static OAuth/token configuration (values redacted); ensure credentials are not committed and refresh cleanly.`,
      });
    }
  }

  return {
    serverCount: allKeys.length,
    serverNames,
    envKeyCount,
    activeExternalServers,
    estimatedExternalTools,
    findings,
    crossClientFindings,
  };
}
