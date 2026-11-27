import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LOCALE_NATIVE_LABELS,
  MAX_MCP_TOOL_BUDGET,
  MODULE_CATALOG,
  MODULE_DOMAIN_IDS,
  MODULE_IDS,
  PRESET_IDS,
  UI_LOCALE_IDS,
  type ModuleDomainId,
  type ModuleId,
  type NovLocale,
  type NovStartupView,
  type PresetId,
  type ResolvedUiLocale,
} from '../../../src/core/catalog.js';
import type {
  NovBridge,
  NovConfigSnapshot,
  NovFeedSummary,
  NovHubStatePayload,
  SanitizedConfigExportPayload,
} from '../bridge.js';
import { useNovI18n } from '../i18n/index.js';

export interface SettingsHubProps {
  bridge: NovBridge;
  snapshot: NovConfigSnapshot;
  busyKey: string | null;
  initialExpandedModule?: ModuleId | null;
  onToggleModule: (moduleId: ModuleId, enabled: boolean) => Promise<void> | void;
  onApplyPreset: (preset: PresetId) => Promise<void> | void;
  onChangeLocale: (locale: NovLocale) => Promise<void> | void;
  onChangeStartupView: (startupView: NovStartupView) => Promise<void> | void;
  onOpenModule: (moduleId: ModuleId) => void;
  onSnapshotReplaced?: (snapshot: NovConfigSnapshot) => void;
  onNotify?: (message: string) => void;
}

type GuardDecision = 'allow' | 'ask' | 'force_ask' | 'deny';
type GuardPermissionMode = 'readonly-audit' | 'balanced-dev' | 'strict-gate';

interface GuardDrawerData {
  policy: {
    enabled: boolean;
    permissionMode?: GuardPermissionMode;
    protectEnvAndKeys: GuardDecision;
    blockSecretWrites: GuardDecision;
    blockDestructiveCommands: GuardDecision;
    askOnNetworkPipes?: GuardDecision;
    autoSnapshotBeforeEdit: boolean;
  };
  stats?: {
    totalSnapshots?: number;
    blockedCount?: number;
    secretCatches?: number;
  };
}

interface TurboHotspotSummaryItem {
  commandPrefix: string;
  count: number;
  estimatedWasteTokens?: number;
}

interface TurboDrawerData {
  autoRtk: boolean;
  updatedAt?: string;
  hotspotsCount: number;
  hotspots: TurboHotspotSummaryItem[];
}

interface VerifyDrawerData {
  policy: {
    enforceOnStop: boolean;
    autoRunOnStop: boolean;
    blockEmptyWrites: boolean;
    maxConsecutiveBlocks: number;
  };
  stats?: {
    totalRuns?: number;
    passedRuns?: number;
    failedRuns?: number;
    blockedStops?: number;
  };
}

interface SpecDrawerData {
  activeSpecId: string | null;
  activeSpec: {
    id: string;
    title: string;
    status: 'draft' | 'approved' | 'completed' | 'archived';
    enforcePlanBeforeWrite: boolean;
    requireUiApproval: boolean;
    tasks?: Array<{ status?: string }>;
  } | null;
  writeLockActive: boolean;
  specs?: Array<{ id: string }>;
}

interface RadarDrawerData {
  prefs: {
    desktopNotify: boolean;
    soundChime: boolean;
    stallMinutes: number;
  };
  counts?: {
    total?: number;
    running?: number;
    awaiting_approval?: number;
    stalled?: number;
  };
}

interface RemoteDrawerData {
  moduleEnabled?: boolean;
  running?: boolean;
  host?: string;
  port?: number;
  channels?: Array<{ id: string; enabled: boolean; configured: boolean }>;
  status?: {
    running?: boolean;
    connectedClients?: number;
    pendingApprovals?: number;
    remoteApprovalEnabled?: boolean;
    notifyOnStop?: boolean;
  };
}

const CONFIGURABLE_STRATEGY_MODULES = new Set<ModuleId>([
  'guard',
  'turbo',
  'verify',
  'spec',
  'radar',
  'remote',
]);

const STRATEGY_SEARCH_HINTS: Partial<Record<ModuleId, string>> = {
  guard: 'secret key env command snapshot firewall policy permissionMode readonly-audit balanced-dev strict-gate',
  turbo: 'autoRtk rtk compact-run overwrite hotspot compression token',
  verify: 'stop hook enforceOnStop autoRunOnStop blockEmptyWrites maxConsecutiveBlocks gate',
  spec: 'write lock enforcePlanBeforeWrite requireUiApproval approval draft dag',
  radar: 'chime sound notify desktopNotify stallMinutes threshold alert',
  remote: 'gateway port pwa approval notifyOnStop isolation network',
};

interface SettingsV08LocaleLabels {
  guardPermissionModeLabel: string;
  guardModes: Record<GuardPermissionMode, string>;
  turboAutoRtkLabel: string;
  turboAutoRtkOnBadge: string;
  turboAutoRtkOffBadge: string;
  turboHotspotsBadge: string;
  turboHotspotsEmpty: string;
  turboSafetyHint: string;
}

const SETTINGS_V08_LABELS: Record<ResolvedUiLocale, SettingsV08LocaleLabels> = {
  en: {
    guardPermissionModeLabel: 'Permission Mode',
    guardModes: {
      'readonly-audit': 'Read-Only Audit (block writes)',
      'balanced-dev': 'Balanced Dev (default)',
      'strict-gate': 'Strict Gate (force_ask writes & shell)',
    },
    turboAutoRtkLabel: 'Auto-RTK Compression Proxy',
    turboAutoRtkOnBadge: 'Auto-RTK: ON',
    turboAutoRtkOffBadge: 'Auto-RTK: OFF (default)',
    turboHotspotsBadge: 'Noisy command hotspots: {n}',
    turboHotspotsEmpty: 'No noisy test/build/git command hotspots observed yet.',
    turboSafetyHint:
      'OFF by default. When enabled, only strictly whitelisted single read-only/test/build commands are rewritten via PreToolUse.overwrite (shell metacharacters rejected; non-zero exit codes preserve the error tail).',
  },
  'zh-CN': {
    guardPermissionModeLabel: '权限模式',
    guardModes: {
      'readonly-audit': '只读审计（拦截写入与危险命令）',
      'balanced-dev': '均衡开发（默认）',
      'strict-gate': '严格门禁（写文件与命令强制确认）',
    },
    turboAutoRtkLabel: 'Auto-RTK 透明压缩代理',
    turboAutoRtkOnBadge: 'Auto-RTK：已开启',
    turboAutoRtkOffBadge: 'Auto-RTK：默认关闭',
    turboHotspotsBadge: '高噪声命令热点：{n}',
    turboHotspotsEmpty: '暂未观测到高噪声测试/构建/Git 命令热点。',
    turboSafetyHint:
      '默认关闭。开启后仅对通过严格白名单校验的单条只读 Git/测试/构建命令执行 PreToolUse.overwrite 压缩（拒绝所有 Shell 注入字符，非 0 退出码完整保留末尾报错堆栈）。',
  },
  'zh-TW': {
    guardPermissionModeLabel: '權限模式',
    guardModes: {
      'readonly-audit': '唯讀稽核（攔截寫入與高風險指令）',
      'balanced-dev': '均衡開發（預設）',
      'strict-gate': '嚴格門禁（寫入與指令強制確認）',
    },
    turboAutoRtkLabel: 'Auto-RTK 透明壓縮代理',
    turboAutoRtkOnBadge: 'Auto-RTK：已開啟',
    turboAutoRtkOffBadge: 'Auto-RTK：預設關閉',
    turboHotspotsBadge: '高雜訊指令熱點：{n}',
    turboHotspotsEmpty: '尚未觀測到高雜訊測試／建置／Git 指令熱點。',
    turboSafetyHint:
      '預設關閉。開啟後僅對通過嚴格白名單校驗的單條唯讀 Git／測試／建置指令進行 PreToolUse.overwrite 壓縮（拒絕 Shell 注入字元，非 0 結束碼保留完整錯誤尾段）。',
  },
  ja: {
    guardPermissionModeLabel: '権限モード',
    guardModes: {
      'readonly-audit': '読み取り専用監査（書込み拒否）',
      'balanced-dev': 'バランス開発（既定）',
      'strict-gate': '厳格ゲート（書込み・シェル強制確認）',
    },
    turboAutoRtkLabel: 'Auto-RTK 透過圧縮プロキシ',
    turboAutoRtkOnBadge: 'Auto-RTK：有効',
    turboAutoRtkOffBadge: 'Auto-RTK：無効（既定）',
    turboHotspotsBadge: '高ノイズコマンド傾向：{n}',
    turboHotspotsEmpty: '高ノイズなテスト／ビルド／Git コマンドはまだ観測されていません。',
    turboSafetyHint:
      '既定では無効です。有効化すると厳格なホワイトリストに一致する単一の読み取り専用・テスト・ビルドコマンドのみを PreToolUse.overwrite で圧縮します（シェルメタ文字は拒否、非 0 終了時はエラー末尾を保持）。',
  },
  ko: {
    guardPermissionModeLabel: '권한 모드',
    guardModes: {
      'readonly-audit': '읽기 전용 감사(쓰기 차단)',
      'balanced-dev': '균형 개발(기본값)',
      'strict-gate': '엄격 게이트(쓰기·명령 강제 확인)',
    },
    turboAutoRtkLabel: 'Auto-RTK 투명 압축 프록시',
    turboAutoRtkOnBadge: 'Auto-RTK: 켜짐',
    turboAutoRtkOffBadge: 'Auto-RTK: 꺼짐(기본값)',
    turboHotspotsBadge: '고잡음 명령 핫스팟: {n}',
    turboHotspotsEmpty: '아직 감지된 고잡음 테스트/빌드/Git 명령 핫스팟이 없습니다.',
    turboSafetyHint:
      '기본값은 꺼짐입니다. 켜면 엄격한 화이트리스트를 통과한 단일 읽기/테스트/빌드 명령만 PreToolUse.overwrite로 압축합니다(셸 메타문자 차단, 비정상 종료 시 오류 꼬리 로그 보존).',
  },
  es: {
    guardPermissionModeLabel: 'Modo de permisos',
    guardModes: {
      'readonly-audit': 'Auditoría solo lectura (bloquea escrituras)',
      'balanced-dev': 'Desarrollo equilibrado (predeterminado)',
      'strict-gate': 'Control estricto (confirmación forzada)',
    },
    turboAutoRtkLabel: 'Proxy transparente Auto-RTK',
    turboAutoRtkOnBadge: 'Auto-RTK: ACTIVO',
    turboAutoRtkOffBadge: 'Auto-RTK: INACTIVO (predet.)',
    turboHotspotsBadge: 'Puntos críticos ruidosos: {n}',
    turboHotspotsEmpty: 'Aún no se han observado comandos ruidosos de pruebas/compilación/Git.',
    turboSafetyHint:
      'Desactivado por defecto. Al activarlo, solo reescribe comandos únicos en lista blanca estricta (Git solo lectura/pruebas/compilación) vía PreToolUse.overwrite; rechaza metacaracteres de shell y conserva el final de errores si falla.',
  },
  fr: {
    guardPermissionModeLabel: 'Mode de permissions',
    guardModes: {
      'readonly-audit': 'Audit lecture seule (bloque les écritures)',
      'balanced-dev': 'Développement équilibré (par défaut)',
      'strict-gate': 'Contrôle strict (confirmation forcée)',
    },
    turboAutoRtkLabel: 'Proxy de compression Auto-RTK',
    turboAutoRtkOnBadge: 'Auto-RTK : ACTIF',
    turboAutoRtkOffBadge: 'Auto-RTK : INACTIF (défaut)',
    turboHotspotsBadge: 'Points chauds verbeux : {n}',
    turboHotspotsEmpty: 'Aucune commande verbeuse de test/build/Git observée pour le moment.',
    turboSafetyHint:
      'Désactivé par défaut. Une fois activé, seules les commandes simples strictement autorisées (Git lecture seule/tests/build) sont réécrites via PreToolUse.overwrite ; les métacaractères shell sont rejetés et la fin des erreurs est conservée en cas d’échec.',
  },
  de: {
    guardPermissionModeLabel: 'Berechtigungsmodus',
    guardModes: {
      'readonly-audit': 'Nur-Lese-Audit (blockiert Schreibzugriffe)',
      'balanced-dev': 'Ausgewogene Entwicklung (Standard)',
      'strict-gate': 'Strenges Gate (Pflichtbestätigung)',
    },
    turboAutoRtkLabel: 'Auto-RTK-Kompressionsproxy',
    turboAutoRtkOnBadge: 'Auto-RTK: EIN',
    turboAutoRtkOffBadge: 'Auto-RTK: AUS (Standard)',
    turboHotspotsBadge: 'Rauschintensive Befehle: {n}',
    turboHotspotsEmpty: 'Noch keine rauschintensiven Test-/Build-/Git-Befehle beobachtet.',
    turboSafetyHint:
      'Standardmäßig AUS. Bei Aktivierung werden ausschließlich streng freigegebene Einzelbefehle (Nur-Lese-Git/Tests/Build) über PreToolUse.overwrite komprimiert; Shell-Metazeichen werden blockiert und Fehler-Stacks bei Abbruch erhalten.',
  },
};

export type IdleSlotReasonKey =
  | 'remoteNotRunning'
  | 'toolboxOnDemand'
  | 'specIdle'
  | 'verifyIdle'
  | 'worktreeOnDemand'
  | 'memEmpty'
  | 'turboIdle'
  | 'radarIdle';

export interface IdleSlotCandidate {
  moduleId: ModuleId;
  toolCount: number;
  reasonKey: IdleSlotReasonKey;
}

interface SettingsV10IdleLocaleLabels {
  title: string;
  subtitle: string;
  slotsUsageBadge: string;
  reclaimBadge: string;
  projectedBadge: string;
  allLean: string;
  disableBtn: string;
  reasons: Record<IdleSlotReasonKey, string>;
}

const SETTINGS_V10_IDLE_LABELS: Record<ResolvedUiLocale, SettingsV10IdleLocaleLabels> = {
  en: {
    title: 'Tool-Slot Idle Advisor',
    subtitle:
      'Read-only audit of enabled optional modules against the 100-tool MCP slot budget. Disable idle modules to reclaim context slots immediately.',
    slotsUsageBadge: 'Used: {used} / {limit}',
    reclaimBadge: 'Reclaimable: -{n}t',
    projectedBadge: 'After reclaim: {next} / {limit}',
    allLean: 'Budget is lean — no idle optional modules detected.',
    disableBtn: 'Disable',
    reasons: {
      remoteNotRunning: 'Enabled while local Remote gateway is stopped',
      toolboxOnDemand: 'On-demand toolbox module enabled',
      specIdle: 'No active Spec or tasks tracked',
      verifyIdle: 'No verification runs recorded yet',
      worktreeOnDemand: 'Parallel Git worktree tools enabled on standby',
      memEmpty: '0 memories recorded in Memory Graph',
      turboIdle: 'No output compression runs recorded yet',
      radarIdle: '0 active or unread sessions tracked',
    },
  },
  'zh-CN': {
    title: '工具槽位闲置与预算体检',
    subtitle:
      '基于当前开启模块与实时摘要的只读体检，对照 100 工具预算上限估算可回收槽位，可一键关闭闲置可选模块。',
    slotsUsageBadge: '已用槽位：{used} / {limit}',
    reclaimBadge: '可回收：-{n}t',
    projectedBadge: '回收后：{next} / {limit}',
    allLean: '当前工具预算精简，未检测到闲置可选模块。',
    disableBtn: '关闭',
    reasons: {
      remoteNotRunning: '已启用，本地 Remote 网关当前未运行',
      toolboxOnDemand: '按需工具箱模块已开启',
      specIdle: '当前无活跃 Spec 或任务',
      verifyIdle: '暂无验证门禁运行记录',
      worktreeOnDemand: '并行 Worktree 工具处于待命开启状态',
      memEmpty: '记忆图谱当前为 0 条记录',
      turboIdle: '尚未产生输出压缩记录',
      radarIdle: '当前 0 活跃或未读会话',
    },
  },
  'zh-TW': {
    title: '工具槽位閒置與預算體檢',
    subtitle:
      '依目前啟用模組與即時摘要進行唯讀體檢，對照 100 工具預算上限估算可回收槽位，可一鍵關閉閒置可選模組。',
    slotsUsageBadge: '已用槽位：{used} / {limit}',
    reclaimBadge: '可回收：-{n}t',
    projectedBadge: '回收後：{next} / {limit}',
    allLean: '目前工具預算精簡，未偵測到閒置可選模組。',
    disableBtn: '關閉',
    reasons: {
      remoteNotRunning: '已啟用，本機 Remote 閘道目前未執行',
      toolboxOnDemand: '隨需工具箱模組已開啟',
      specIdle: '目前無進行中 Spec 或任務',
      verifyIdle: '尚無驗證門禁執行紀錄',
      worktreeOnDemand: '平行 Worktree 工具處於待命開啟狀態',
      memEmpty: '記憶圖譜目前為 0 筆紀錄',
      turboIdle: '尚未產生輸出壓縮紀錄',
      radarIdle: '目前 0 個活躍或未讀工作階段',
    },
  },
  ja: {
    title: 'ツール枠アイドル診断',
    subtitle:
      '有効な任意モジュールと稼働サマリーを読み取り専用で分析し、100 ツール上限に対する回収可能枠を算出します。',
    slotsUsageBadge: '使用中：{used} / {limit}',
    reclaimBadge: '回収可能：-{n}t',
    projectedBadge: '回収後：{next} / {limit}',
    allLean: 'ツール予算は最適化済みです（アイドル状態の任意モジュールなし）。',
    disableBtn: '無効化',
    reasons: {
      remoteNotRunning: '有効ですがローカル Remote ゲートウェイは停止中です',
      toolboxOnDemand: 'オンデマンドツールボックスが有効です',
      specIdle: 'アクティブな Spec またはタスクがありません',
      verifyIdle: '検証ゲートの実行履歴がまだありません',
      worktreeOnDemand: '並列 Worktree ツールが待機状態で有効です',
      memEmpty: 'Memory Graph の記憶件数が 0 件です',
      turboIdle: '出力圧縮の実績がまだありません',
      radarIdle: 'アクティブ／未読セッションが 0 件です',
    },
  },
  ko: {
    title: '도구 슬롯 유휴 진단',
    subtitle:
      '활성화된 선택 모듈과 실시간 요약을 읽기 전용으로 점검해 100개 도구 예산 대비 회수 가능한 슬롯을 계산합니다.',
    slotsUsageBadge: '사용 중: {used} / {limit}',
    reclaimBadge: '회수 가능: -{n}t',
    projectedBadge: '회수 후: {next} / {limit}',
    allLean: '도구 예산이 간결합니다. 유휴 선택 모듈이 없습니다.',
    disableBtn: '끄기',
    reasons: {
      remoteNotRunning: '활성화되었으나 로컬 Remote 게이트웨이가 중지됨',
      toolboxOnDemand: '온디맨드 도구함 모듈이 켜져 있음',
      specIdle: '활성 Spec 또는 작업 없음',
      verifyIdle: '검증 게이트 실행 기록 없음',
      worktreeOnDemand: '병렬 Worktree 도구가 대기 상태로 켜져 있음',
      memEmpty: 'Memory Graph 저장 기억 0건',
      turboIdle: '출력 압축 기록 없음',
      radarIdle: '활성 또는 읽지 않은 세션 0건',
    },
  },
  es: {
    title: 'Asesor de ranuras inactivas',
    subtitle:
      'Auditoría de solo lectura de módulos opcionales activos frente al presupuesto de 100 herramientas MCP para recuperar ranuras al instante.',
    slotsUsageBadge: 'En uso: {used} / {limit}',
    reclaimBadge: 'Recuperable: -{n}t',
    projectedBadge: 'Tras recuperar: {next} / {limit}',
    allLean: 'Presupuesto optimizado: no se detectaron módulos opcionales inactivos.',
    disableBtn: 'Desactivar',
    reasons: {
      remoteNotRunning: 'Activado con la pasarela local Remote detenida',
      toolboxOnDemand: 'Módulo de caja de herramientas bajo demanda activo',
      specIdle: 'Sin Spec ni tareas activas registradas',
      verifyIdle: 'Aún sin ejecuciones de verificación registradas',
      worktreeOnDemand: 'Herramientas paralelas de Worktree en espera',
      memEmpty: '0 memorias registradas en Memory Graph',
      turboIdle: 'Aún sin compresiones de salida registradas',
      radarIdle: '0 sesiones activas o sin leer',
    },
  },
  fr: {
    title: 'Conseiller de créneaux inactifs',
    subtitle:
      'Audit en lecture seule des modules optionnels activés face au budget de 100 outils MCP pour libérer immédiatement des créneaux.',
    slotsUsageBadge: 'Utilisés : {used} / {limit}',
    reclaimBadge: 'Récupérable : -{n}t',
    projectedBadge: 'Après libération : {next} / {limit}',
    allLean: 'Budget sobre : aucun module optionnel inactif détecté.',
    disableBtn: 'Désactiver',
    reasons: {
      remoteNotRunning: 'Activé alors que la passerelle locale Remote est arrêtée',
      toolboxOnDemand: 'Module boîte à outils à la demande activé',
      specIdle: 'Aucun Spec ou tâche actif suivi',
      verifyIdle: 'Aucune exécution de vérification enregistrée',
      worktreeOnDemand: 'Outils Worktree parallèles activés en veille',
      memEmpty: '0 mémoire enregistrée dans Memory Graph',
      turboIdle: 'Aucune compression de sortie enregistrée',
      radarIdle: '0 session active ou non lue',
    },
  },
  de: {
    title: 'Werkzeug-Slot-Leerlaufberater',
    subtitle:
      'Nur-Lese-Prüfung aktivierter optionaler Module gegen das 100-Tool-MCP-Budget zur sofortigen Freigabe ungenutzter Slots.',
    slotsUsageBadge: 'Belegt: {used} / {limit}',
    reclaimBadge: 'Freigebbar: -{n}t',
    projectedBadge: 'Nach Freigabe: {next} / {limit}',
    allLean: 'Budget ist schlank – keine inaktiven optionalen Module erkannt.',
    disableBtn: 'Deaktivieren',
    reasons: {
      remoteNotRunning: 'Aktiviert, während das lokale Remote-Gateway gestoppt ist',
      toolboxOnDemand: 'Bedarfs-Toolbox-Modul ist aktiviert',
      specIdle: 'Kein aktiver Spec oder aktive Aufgaben erfasst',
      verifyIdle: 'Noch keine Verifikationsläufe aufgezeichnet',
      worktreeOnDemand: 'Parallele Worktree-Tools im Bereitschaftsmodus aktiv',
      memEmpty: '0 Einträge im Memory Graph gespeichert',
      turboIdle: 'Noch keine Ausgabekomprimierungen erfasst',
      radarIdle: '0 aktive oder ungelesene Sitzungen erfasst',
    },
  },
};

export function computeIdleSlotCandidates(
  modules: Record<ModuleId, boolean>,
  feedSummary: NovFeedSummary | undefined,
  remoteRunning: boolean,
): IdleSlotCandidate[] {
  const candidates: IdleSlotCandidate[] = [];
  const pushIfEnabled = (modId: ModuleId, reasonKey: IdleSlotReasonKey): void => {
    if (!modules[modId]) return;
    candidates.push({
      moduleId: modId,
      toolCount: MODULE_CATALOG[modId].modelToolNames.length,
      reasonKey,
    });
  };

  if (modules.remote && !remoteRunning && feedSummary?.remote?.running !== true) {
    pushIfEnabled('remote', 'remoteNotRunning');
  }
  if (modules.studio) {
    pushIfEnabled('studio', 'toolboxOnDemand');
  }
  if (modules.canvas) {
    pushIfEnabled('canvas', 'toolboxOnDemand');
  }
  if (modules.spec) {
    const spec = feedSummary?.spec;
    const hasActiveSpec = Boolean(
      spec?.activeSpecId || spec?.title || spec?.status || (spec?.totalTasks ?? 0) > 0,
    );
    if (!hasActiveSpec) {
      pushIfEnabled('spec', 'specIdle');
    }
  }
  if (modules.verify) {
    const verify = feedSummary?.verify;
    const hasVerifyHistory = Boolean(
      (verify?.lastStatus && verify.lastStatus !== 'idle') ||
        (verify?.totalRuns ?? 0) > 0 ||
        (verify?.passedRuns ?? 0) > 0 ||
        (verify?.failedRuns ?? 0) > 0 ||
        (verify?.blockedStops ?? 0) > 0 ||
        (verify?.dirtyFilesCount ?? 0) > 0,
    );
    if (!hasVerifyHistory) {
      pushIfEnabled('verify', 'verifyIdle');
    }
  }
  if (modules.worktree) {
    pushIfEnabled('worktree', 'worktreeOnDemand');
  }
  if (modules.mem) {
    const memCount = feedSummary?.mem?.totalMemories ?? feedSummary?.mem?.total ?? 0;
    if (memCount <= 0) {
      pushIfEnabled('mem', 'memEmpty');
    }
  }
  if (modules.ops) {
    pushIfEnabled('ops', 'toolboxOnDemand');
  }
  if (modules.turbo) {
    const saved = feedSummary?.turbo?.totalSavedTokens ?? feedSummary?.turbo?.savedTokens ?? 0;
    const compactions = feedSummary?.turbo?.compactionCount ?? 0;
    if (saved <= 0 && compactions <= 0) {
      pushIfEnabled('turbo', 'turboIdle');
    }
  }
  if (modules.radar) {
    const radar = feedSummary?.radar;
    const activeRadar =
      (radar?.runningCount ?? radar?.running ?? 0) +
      (radar?.awaitingCount ?? radar?.awaitingApproval ?? radar?.awaiting_approval ?? 0) +
      (radar?.stalledCount ?? radar?.stalled ?? 0) +
      (radar?.unreadCount ?? radar?.unread ?? 0) +
      (radar?.total ?? 0);
    if (activeRadar <= 0) {
      pushIfEnabled('radar', 'radarIdle');
    }
  }

  return candidates.sort((a, b) => b.toolCount - a.toolCount);
}

function getBudgetTone(exposed: number, limit: number): 'is-safe' | 'is-warn' | 'is-danger' {
  const ratio = limit > 0 ? (exposed / limit) * 100 : 0;
  if (ratio >= 85) return 'is-danger';
  if (ratio >= 60) return 'is-warn';
  return 'is-safe';
}

function unwrapGuardData(raw: unknown): GuardDrawerData | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const target =
    obj.state && typeof obj.state === 'object' ? (obj.state as Record<string, unknown>) : obj;
  if (target.policy && typeof target.policy === 'object') {
    return {
      policy: target.policy as GuardDrawerData['policy'],
      stats: target.stats as GuardDrawerData['stats'],
    };
  }
  return null;
}

function unwrapVerifyData(raw: unknown): VerifyDrawerData | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const target =
    obj.state && typeof obj.state === 'object' ? (obj.state as Record<string, unknown>) : obj;
  if (target.policy && typeof target.policy === 'object') {
    return {
      policy: target.policy as VerifyDrawerData['policy'],
      stats: target.stats as VerifyDrawerData['stats'],
    };
  }
  return null;
}

function unwrapSpecData(raw: unknown): SpecDrawerData | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const target =
    obj.state && typeof obj.state === 'object' ? (obj.state as Record<string, unknown>) : obj;
  if ('activeSpec' in target || 'writeLockActive' in target) {
    return {
      activeSpecId: typeof target.activeSpecId === 'string' ? target.activeSpecId : null,
      activeSpec: (target.activeSpec as SpecDrawerData['activeSpec']) ?? null,
      writeLockActive: Boolean(target.writeLockActive),
      specs: Array.isArray(target.specs) ? (target.specs as SpecDrawerData['specs']) : [],
    };
  }
  return null;
}

function unwrapRadarData(raw: unknown): RadarDrawerData | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const target =
    obj.board && typeof obj.board === 'object' ? (obj.board as Record<string, unknown>) : obj;
  if (target.prefs && typeof target.prefs === 'object') {
    return {
      prefs: target.prefs as RadarDrawerData['prefs'],
      counts: target.counts as RadarDrawerData['counts'],
    };
  }
  return null;
}

function unwrapTurboPrefsData(raw: unknown): TurboDrawerData {
  const fallback: TurboDrawerData = {
    autoRtk: false,
    hotspotsCount: 0,
    hotspots: [],
  };
  if (!raw || typeof raw !== 'object') return fallback;
  const obj = raw as Record<string, unknown>;
  const target =
    obj.state && typeof obj.state === 'object' ? (obj.state as Record<string, unknown>) : obj;
  const prefsObj =
    target.prefs && typeof target.prefs === 'object'
      ? (target.prefs as Record<string, unknown>)
      : target;
  const autoRtk = prefsObj.autoRtk === true;
  const updatedAt = typeof prefsObj.updatedAt === 'string' ? prefsObj.updatedAt : undefined;

  const rawHotspots = Array.isArray(target.hotspots)
    ? target.hotspots
    : Array.isArray(obj.hotspots)
      ? obj.hotspots
      : [];
  const hotspots: TurboHotspotSummaryItem[] = [];
  for (const item of rawHotspots) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.commandPrefix !== 'string' || !rec.commandPrefix.trim()) continue;
    const count = Number(rec.count);
    hotspots.push({
      commandPrefix: rec.commandPrefix.trim(),
      count: Number.isFinite(count) && count > 0 ? Math.floor(count) : 1,
      estimatedWasteTokens:
        typeof rec.estimatedWasteTokens === 'number' && Number.isFinite(rec.estimatedWasteTokens)
          ? Math.max(0, Math.floor(rec.estimatedWasteTokens))
          : undefined,
    });
  }

  const explicitCount = Number(target.hotspotsCount ?? obj.hotspotsCount);
  const hotspotsCount =
    Number.isFinite(explicitCount) && explicitCount >= 0
      ? Math.max(Math.floor(explicitCount), hotspots.length)
      : hotspots.length;

  return {
    autoRtk,
    updatedAt,
    hotspotsCount,
    hotspots,
  };
}

export const SettingsHub: React.FC<SettingsHubProps> = ({
  bridge,
  snapshot,
  busyKey,
  initialExpandedModule = null,
  onToggleModule,
  onApplyPreset,
  onChangeLocale,
  onChangeStartupView,
  onOpenModule,
  onSnapshotReplaced,
  onNotify,
}) => {
  const { locale, dict, prefLocale, t } = useNovI18n();
  const sh = dict.settingsHub;
  const v08 = SETTINGS_V08_LABELS[locale] ?? SETTINGS_V08_LABELS.en;
  const v10 = SETTINGS_V10_IDLE_LABELS[locale] ?? SETTINGS_V10_IDLE_LABELS.en;

  const [searchQuery, setSearchQuery] = useState('');
  const [hubState, setHubState] = useState<NovHubStatePayload | null>(null);

  // S3 Accordion state — at most one enabled module expanded at any time
  const [expandedModuleId, setExpandedModuleId] = useState<ModuleId | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerSaving, setDrawerSaving] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);

  const [guardData, setGuardData] = useState<GuardDrawerData | null>(null);
  const [turboData, setTurboData] = useState<TurboDrawerData | null>(null);
  const [verifyData, setVerifyData] = useState<VerifyDrawerData | null>(null);
  const [specData, setSpecData] = useState<SpecDrawerData | null>(null);
  const [radarData, setRadarData] = useState<RadarDrawerData | null>(null);
  const [remoteData, setRemoteData] = useState<RemoteDrawerData | null>(null);
  const [remotePortDraft, setRemotePortDraft] = useState<string>('');

  // S4 Governance state
  const [exportedPayload, setExportedPayload] = useState<SanitizedConfigExportPayload | null>(null);
  const [exportCopied, setExportCopied] = useState(false);
  const [importText, setImportText] = useState('');
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccessMsg, setImportSuccessMsg] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [govBusy, setGovBusy] = useState(false);

  const loadHubSnapshot = useCallback(async () => {
    try {
      const payload = await bridge.getHubState();
      setHubState(payload);
    } catch {
      setHubState(null);
    }
  }, [bridge]);

  useEffect(() => {
    void loadHubSnapshot();
  }, [loadHubSnapshot, snapshot.enabledCount, snapshot.config.updatedAt]);

  // Collapse drawer immediately if the expanded module is disabled
  useEffect(() => {
    if (expandedModuleId && !snapshot.config.modules[expandedModuleId]) {
      setExpandedModuleId(null);
      setDrawerError(null);
    }
  }, [expandedModuleId, snapshot.config.modules]);

  const loadDrawerForModule = useCallback(
    async (modId: ModuleId) => {
      if (!CONFIGURABLE_STRATEGY_MODULES.has(modId)) return;
      setDrawerLoading(true);
      setDrawerError(null);
      try {
        if (modId === 'guard') {
          const raw = await bridge.callTool('app_guard_get_state', {});
          setGuardData(unwrapGuardData(raw));
        } else if (modId === 'turbo') {
          const raw = await bridge.callTool('app_turbo_get_prefs', {});
          setTurboData(unwrapTurboPrefsData(raw));
        } else if (modId === 'verify') {
          const raw = await bridge.callTool('app_verify_get_state', {});
          setVerifyData(unwrapVerifyData(raw));
        } else if (modId === 'spec') {
          const raw = await bridge.callTool('app_spec_get_state', {});
          setSpecData(unwrapSpecData(raw));
        } else if (modId === 'radar') {
          const raw = await bridge.callTool('app_radar_get_board', {});
          setRadarData(unwrapRadarData(raw));
        } else if (modId === 'remote') {
          const raw = (await bridge.callTool('app_remote_get_hub_state', {})) as RemoteDrawerData;
          setRemoteData(raw);
          setRemotePortDraft(typeof raw?.port === 'number' ? String(raw.port) : '');
        }
      } catch (err) {
        setDrawerError(err instanceof Error ? err.message : String(err));
      } finally {
        setDrawerLoading(false);
      }
    },
    [bridge],
  );

  // Honor deep-link focus from business module panels (e.g. SpecPanel strategy button)
  useEffect(() => {
    if (initialExpandedModule && snapshot.config.modules[initialExpandedModule]) {
      setExpandedModuleId(initialExpandedModule);
      setDrawerError(null);
      void loadDrawerForModule(initialExpandedModule);
    }
  }, [initialExpandedModule, snapshot.config.modules, loadDrawerForModule]);

  const handleToggleDrawer = (modId: ModuleId) => {
    if (!snapshot.config.modules[modId]) return;
    if (expandedModuleId === modId) {
      setExpandedModuleId(null);
      setDrawerError(null);
      return;
    }
    setExpandedModuleId(modId);
    setDrawerError(null);
    void loadDrawerForModule(modId);
  };

  // S3 Strategy mutation handlers
  const updateGuardPolicy = async (patch: Record<string, unknown>) => {
    setDrawerSaving(true);
    setDrawerError(null);
    try {
      const raw = await bridge.callTool('app_guard_update_policy', patch);
      const next = unwrapGuardData(raw);
      if (next) setGuardData(next);
      onNotify?.(`${dict.modules.guard.shortLabel}: ${dict.common.save}`);
    } catch (err) {
      setDrawerError(err instanceof Error ? err.message : String(err));
    } finally {
      setDrawerSaving(false);
    }
  };

  const updateTurboPrefs = async (patch: { autoRtk: boolean }) => {
    setDrawerSaving(true);
    setDrawerError(null);
    try {
      const raw = await bridge.callTool('app_turbo_update_prefs', patch);
      const parsed = unwrapTurboPrefsData(raw);
      setTurboData((prev) => ({
        autoRtk: typeof parsed.autoRtk === 'boolean' ? parsed.autoRtk : patch.autoRtk,
        updatedAt: parsed.updatedAt ?? prev?.updatedAt,
        hotspots: parsed.hotspots.length > 0 ? parsed.hotspots : (prev?.hotspots ?? []),
        hotspotsCount:
          parsed.hotspotsCount > 0 ? parsed.hotspotsCount : (prev?.hotspotsCount ?? 0),
      }));
      onNotify?.(`${dict.modules.turbo.shortLabel}: ${dict.common.save}`);
    } catch (err) {
      setDrawerError(err instanceof Error ? err.message : String(err));
    } finally {
      setDrawerSaving(false);
    }
  };

  const updateVerifyPolicy = async (patch: Record<string, unknown>) => {
    setDrawerSaving(true);
    setDrawerError(null);
    try {
      const raw = await bridge.callTool('app_verify_save_policy', patch);
      const next = unwrapVerifyData(raw);
      if (next) setVerifyData(next);
      onNotify?.(`${dict.modules.verify.shortLabel}: ${dict.common.save}`);
    } catch (err) {
      setDrawerError(err instanceof Error ? err.message : String(err));
    } finally {
      setDrawerSaving(false);
    }
  };

  const updateSpecGuardrails = async (patch: {
    enforcePlanBeforeWrite?: boolean;
    requireUiApproval?: boolean;
  }) => {
    const activeSpec = specData?.activeSpec;
    if (!activeSpec) return;
    setDrawerSaving(true);
    setDrawerError(null);
    try {
      const raw = await bridge.callTool('app_spec_set_status', {
        specId: activeSpec.id,
        status: activeSpec.status,
        ...patch,
      });
      const next = unwrapSpecData(raw);
      if (next) setSpecData(next);
      onNotify?.(`${dict.modules.spec.shortLabel}: ${dict.common.save}`);
    } catch (err) {
      setDrawerError(err instanceof Error ? err.message : String(err));
    } finally {
      setDrawerSaving(false);
    }
  };

  const updateRadarPrefs = async (patch: {
    desktopNotify?: boolean;
    soundChime?: boolean;
    stallMinutes?: number;
  }) => {
    setDrawerSaving(true);
    setDrawerError(null);
    try {
      const raw = await bridge.callTool('app_radar_update_prefs', patch);
      const next = unwrapRadarData(raw);
      if (next) setRadarData(next);
      onNotify?.(`${dict.modules.radar.shortLabel}: ${dict.common.save}`);
    } catch (err) {
      setDrawerError(err instanceof Error ? err.message : String(err));
    } finally {
      setDrawerSaving(false);
    }
  };

  const updateRemoteSettings = async (patch: {
    remoteApprovalEnabled?: boolean;
    notifyOnStop?: boolean;
    port?: number;
  }) => {
    setDrawerSaving(true);
    setDrawerError(null);
    try {
      const raw = (await bridge.callTool(
        'app_remote_update_settings',
        patch,
      )) as RemoteDrawerData;
      setRemoteData(raw);
      if (typeof raw?.port === 'number') setRemotePortDraft(String(raw.port));
      onNotify?.(`${dict.modules.remote.shortLabel}: ${dict.common.save}`);
    } catch (err) {
      setDrawerError(err instanceof Error ? err.message : String(err));
    } finally {
      setDrawerSaving(false);
    }
  };

  // S4 Governance handlers
  const handleExportConfig = async () => {
    setGovBusy(true);
    setExportCopied(false);
    try {
      const exported = await bridge.exportConfig();
      setExportedPayload(exported);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setGovBusy(false);
    }
  };

  const handleCopyExport = async () => {
    if (!exportedPayload) return;
    try {
      await navigator.clipboard?.writeText(JSON.stringify(exportedPayload, null, 2));
      setExportCopied(true);
      onNotify?.(dict.common.copied);
    } catch {
      // clipboard unavailable
    }
  };

  const handleImportConfig = async () => {
    if (!importText.trim()) return;
    setGovBusy(true);
    setImportError(null);
    setImportSuccessMsg(null);
    setImportWarnings([]);
    try {
      const res = await bridge.importConfig(importText);
      setImportWarnings(Array.isArray(res.warnings) ? res.warnings : []);
      setImportSuccessMsg(sh.importSuccess);
      if (res.snapshot) {
        onSnapshotReplaced?.(res.snapshot);
      }
      onNotify?.(sh.importSuccess);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setGovBusy(false);
    }
  };

  const handleConfirmReset = async () => {
    setGovBusy(true);
    try {
      const next = await bridge.resetConfig();
      setConfirmingReset(false);
      setExpandedModuleId(null);
      onSnapshotReplaced?.(next);
      onNotify?.(sh.resetSuccess);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setGovBusy(false);
    }
  };

  // Live search filtering across S1-S4
  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filteredDomains = useMemo(() => {
    return MODULE_DOMAIN_IDS.map((domainId: ModuleDomainId) => {
      const domainMeta = dict.domains[domainId];
      const domainMatches =
        !normalizedQuery ||
        domainId.includes(normalizedQuery) ||
        domainMeta.label.toLowerCase().includes(normalizedQuery) ||
        domainMeta.description.toLowerCase().includes(normalizedQuery);

      const modules = MODULE_IDS.filter((modId) => {
        if (MODULE_CATALOG[modId].domain !== domainId) return false;
        if (!normalizedQuery || domainMatches) return true;
        const mText = dict.modules[modId];
        const mMeta = MODULE_CATALOG[modId];
        const hint = STRATEGY_SEARCH_HINTS[modId] ?? '';
        const haystack = [
          modId,
          mText.name,
          mText.shortLabel,
          mText.tagline,
          mText.description,
          ...mMeta.modelToolNames,
          hint,
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(normalizedQuery);
      });

      return { domainId, modules };
    }).filter((group) => group.modules.length > 0);
  }, [dict.domains, dict.modules, normalizedQuery]);

  const advancedMatchesQuery = useMemo(() => {
    if (!normalizedQuery) return true;
    const advHaystack = [
      sh.advancedTitle,
      sh.advancedSub,
      sh.teamPresetSection,
      sh.exportBtn,
      sh.importBtn,
      sh.resetBtn,
      sh.dualStarSection,
      v10.title,
      v10.subtitle,
      'json export import reset team feed-snapshot.json agy-nov.json backup restore idle slot budget reclaim',
    ]
      .join(' ')
      .toLowerCase();
    return advHaystack.includes(normalizedQuery);
  }, [normalizedQuery, sh, v10.subtitle, v10.title]);

  const totalVisibleModules = filteredDomains.reduce((sum, g) => sum + g.modules.length, 0);
  const noSearchHits = Boolean(normalizedQuery) && totalVisibleModules === 0 && !advancedMatchesQuery;

  const exposedTools = snapshot.exposedModelTools;
  const budgetLimit = hubState?.feed?.toolBudgetLimit ?? MAX_MCP_TOOL_BUDGET;
  const budgetPercent = Math.min(100, Math.round((exposedTools / Math.max(1, budgetLimit)) * 100));
  const budgetTone = getBudgetTone(exposedTools, budgetLimit);
  const currentStartupView: NovStartupView = snapshot.config.startupView ?? 'hub';

  const idleCandidates = useMemo(
    () =>
      computeIdleSlotCandidates(
        snapshot.config.modules,
        hubState?.feed?.summary,
        Boolean(snapshot.remoteRunning),
      ),
    [snapshot.config.modules, hubState?.feed?.summary, snapshot.remoteRunning],
  );
  const reclaimableTools = useMemo(
    () => idleCandidates.reduce((sum, item) => sum + item.toolCount, 0),
    [idleCandidates],
  );
  const projectedTools = Math.max(0, exposedTools - reclaimableTools);

  const feedSummary = hubState?.feed?.summary ?? {};
  const feedPath =
    hubState?.feed?.paths?.feedSnapshotPath ??
    hubState?.feed?.paths?.feedPath ??
    (hubState?.feed?.paths?.feedFile
      ? `<dataDir>/${hubState.feed.paths.feedFile}`
      : '<dataDir>/feed-snapshot.json');
  const feedSynced = Boolean(
    hubState?.feed &&
      (hubState.feed.feedExists ||
        hubState.feed.generatedAt ||
        hubState.feed.updatedAt ||
        hubState.feed.paths?.feedFile ||
        hubState.feed.paths?.feedSnapshotPath),
  );
  const teamPreset = hubState?.teamPreset ?? null;

  const renderStrategyDrawer = (modId: ModuleId): React.ReactNode => {
    const meta = MODULE_CATALOG[modId];
    const modText = dict.modules[modId];

    if (drawerLoading && CONFIGURABLE_STRATEGY_MODULES.has(modId)) {
      return (
        <div className="nov-drawer">
          <span className="nov-muted">{dict.common.loading}</span>
        </div>
      );
    }

    return (
      <div className="nov-drawer" aria-label={`${modText.name} ${sh.strategyTitle}`}>
        <div className="nov-drawer-head">
          <strong className="nov-drawer-title">
            {sh.strategyTitle} · {modText.shortLabel}
          </strong>
          <button
            type="button"
            className="nov-open-btn"
            onClick={() => onOpenModule(modId)}
          >
            {sh.openFullPanelBtn}
          </button>
        </div>

        {drawerError && <div className="nov-drawer-error">{drawerError}</div>}

        {modId === 'guard' && guardData && (
          <div className="nov-drawer-grid">
            <label className="nov-drawer-field">
              <span>{v08.guardPermissionModeLabel}</span>
              <select
                className="nov-p-select"
                aria-label={v08.guardPermissionModeLabel}
                value={guardData.policy.permissionMode ?? 'balanced-dev'}
                disabled={drawerSaving}
                onChange={(e) =>
                  void updateGuardPolicy({
                    permissionMode: e.target.value as GuardPermissionMode,
                  })
                }
              >
                <option value="readonly-audit">{v08.guardModes['readonly-audit']}</option>
                <option value="balanced-dev">{v08.guardModes['balanced-dev']}</option>
                <option value="strict-gate">{v08.guardModes['strict-gate']}</option>
              </select>
            </label>

            <label className="nov-drawer-field">
              <span>{sh.guardEnvKeysLabel}</span>
              <select
                className="nov-p-select"
                value={guardData.policy.protectEnvAndKeys}
                disabled={drawerSaving}
                onChange={(e) =>
                  void updateGuardPolicy({ protectEnvAndKeys: e.target.value as GuardDecision })
                }
              >
                <option value="deny">
                  {sh.guardDecisionDeny} — {dict.panels.guard.blocked}
                </option>
                <option value="ask">
                  {sh.guardDecisionAsk} — {dict.panels.guard.ask}
                </option>
                <option value="allow">
                  {sh.guardDecisionAllow} — {dict.panels.guard.safe}
                </option>
              </select>
            </label>

            <label className="nov-drawer-field">
              <span>{sh.guardSecretWriteLabel}</span>
              <select
                className="nov-p-select"
                value={guardData.policy.blockSecretWrites}
                disabled={drawerSaving}
                onChange={(e) =>
                  void updateGuardPolicy({ blockSecretWrites: e.target.value as GuardDecision })
                }
              >
                <option value="deny">
                  {sh.guardDecisionDeny} — {dict.panels.guard.blocked}
                </option>
                <option value="ask">
                  {sh.guardDecisionAsk} — {dict.panels.guard.ask}
                </option>
                <option value="allow">
                  {sh.guardDecisionAllow} — {dict.panels.guard.safe}
                </option>
              </select>
            </label>

            <label className="nov-drawer-field">
              <span>{sh.guardShellFirewallLabel}</span>
              <select
                className="nov-p-select"
                value={guardData.policy.blockDestructiveCommands}
                disabled={drawerSaving}
                onChange={(e) =>
                  void updateGuardPolicy({
                    blockDestructiveCommands: e.target.value as GuardDecision,
                  })
                }
              >
                <option value="deny">
                  {sh.guardDecisionDeny} — {dict.panels.guard.blocked}
                </option>
                <option value="ask">
                  {sh.guardDecisionAsk} — {dict.panels.guard.ask}
                </option>
                <option value="allow">
                  {sh.guardDecisionAllow} — {dict.panels.guard.safe}
                </option>
              </select>
            </label>

            <div className="nov-drawer-toggle-row">
              <span>{sh.guardAutoSnapshotLabel}</span>
              <button
                type="button"
                role="switch"
                aria-checked={guardData.policy.autoSnapshotBeforeEdit}
                className="nov-switch"
                disabled={drawerSaving}
                onClick={() =>
                  void updateGuardPolicy({
                    autoSnapshotBeforeEdit: !guardData.policy.autoSnapshotBeforeEdit,
                  })
                }
              >
                <span className="nov-switch-thumb" />
              </button>
            </div>
          </div>
        )}

        {modId === 'turbo' && turboData && (
          <div className="nov-drawer-stack">
            <div className="nov-card-tags">
              <span className={`nov-badge ${turboData.autoRtk ? 'is-accent' : 'is-offline'}`}>
                {turboData.autoRtk ? v08.turboAutoRtkOnBadge : v08.turboAutoRtkOffBadge}
              </span>
              <span className="nov-badge">
                {t(v08.turboHotspotsBadge, { n: turboData.hotspotsCount })}
              </span>
              {typeof (feedSummary.turbo?.totalSavedTokens ?? feedSummary.turbo?.savedTokens) ===
                'number' && (
                <span className="nov-badge is-accent">
                  ~{feedSummary.turbo?.totalSavedTokens ?? feedSummary.turbo?.savedTokens} tok
                </span>
              )}
            </div>

            <div className="nov-drawer-grid">
              <div className="nov-drawer-toggle-row">
                <span>{v08.turboAutoRtkLabel}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={turboData.autoRtk}
                  aria-label={v08.turboAutoRtkLabel}
                  className="nov-switch"
                  disabled={drawerSaving}
                  onClick={() =>
                    void updateTurboPrefs({ autoRtk: !turboData.autoRtk })
                  }
                >
                  <span className="nov-switch-thumb" />
                </button>
              </div>
            </div>

            {turboData.hotspots.length > 0 ? (
              <div className="nov-card-tags">
                {turboData.hotspots.slice(0, 3).map((item) => (
                  <span key={item.commandPrefix} className="nov-badge nov-mono">
                    {item.commandPrefix} ×{item.count}
                  </span>
                ))}
              </div>
            ) : (
              <div className="nov-muted">{v08.turboHotspotsEmpty}</div>
            )}

            <div className="nov-muted">{v08.turboSafetyHint}</div>
          </div>
        )}

        {modId === 'verify' && verifyData && (
          <div className="nov-drawer-grid">
            <div className="nov-drawer-toggle-row">
              <span>{dict.panels.verify.enforceOnStop}</span>
              <button
                type="button"
                role="switch"
                aria-checked={verifyData.policy.enforceOnStop}
                className="nov-switch"
                disabled={drawerSaving}
                onClick={() =>
                  void updateVerifyPolicy({ enforceOnStop: !verifyData.policy.enforceOnStop })
                }
              >
                <span className="nov-switch-thumb" />
              </button>
            </div>

            <div className="nov-drawer-toggle-row">
              <span>{dict.panels.verify.autoRunOnStop}</span>
              <button
                type="button"
                role="switch"
                aria-checked={verifyData.policy.autoRunOnStop}
                className="nov-switch"
                disabled={drawerSaving}
                onClick={() =>
                  void updateVerifyPolicy({ autoRunOnStop: !verifyData.policy.autoRunOnStop })
                }
              >
                <span className="nov-switch-thumb" />
              </button>
            </div>

            <div className="nov-drawer-toggle-row">
              <span>{dict.panels.verify.blockEmptyWrites}</span>
              <button
                type="button"
                role="switch"
                aria-checked={verifyData.policy.blockEmptyWrites}
                className="nov-switch"
                disabled={drawerSaving}
                onClick={() =>
                  void updateVerifyPolicy({
                    blockEmptyWrites: !verifyData.policy.blockEmptyWrites,
                  })
                }
              >
                <span className="nov-switch-thumb" />
              </button>
            </div>

            <label className="nov-drawer-field">
              <span>{dict.panels.verify.maxBlocks} (1–10)</span>
              <input
                type="number"
                className="nov-p-input"
                min={1}
                max={10}
                value={verifyData.policy.maxConsecutiveBlocks}
                disabled={drawerSaving}
                onChange={(e) => {
                  const val = Math.max(1, Math.min(10, Math.floor(Number(e.target.value) || 1)));
                  void updateVerifyPolicy({ maxConsecutiveBlocks: val });
                }}
              />
            </label>
          </div>
        )}

        {modId === 'spec' && specData && (
          <div className="nov-drawer-stack">
            {!specData.activeSpec ? (
              <div className="nov-muted">{dict.panels.spec.emptySpecs}</div>
            ) : (
              <>
                <div className="nov-p-row">
                  <span className="nov-mono">{specData.activeSpec.title}</span>
                  <span
                    className={`nov-badge ${specData.writeLockActive ? 'is-network' : 'is-offline'}`}
                  >
                    {specData.writeLockActive
                      ? dict.panels.spec.writeLockOn
                      : dict.panels.spec.writeLockOff}
                  </span>
                </div>
                <div className="nov-drawer-grid">
                  <div className="nov-drawer-toggle-row">
                    <span>{dict.panels.spec.enforceLockLabel}</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={specData.activeSpec.enforcePlanBeforeWrite}
                      className="nov-switch"
                      disabled={drawerSaving}
                      onClick={() =>
                        void updateSpecGuardrails({
                          enforcePlanBeforeWrite: !specData.activeSpec!.enforcePlanBeforeWrite,
                        })
                      }
                    >
                      <span className="nov-switch-thumb" />
                    </button>
                  </div>

                  <div className="nov-drawer-toggle-row">
                    <span>{dict.panels.spec.requireUiApprovalLabel}</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={specData.activeSpec.requireUiApproval}
                      className="nov-switch"
                      disabled={drawerSaving}
                      onClick={() =>
                        void updateSpecGuardrails({
                          requireUiApproval: !specData.activeSpec!.requireUiApproval,
                        })
                      }
                    >
                      <span className="nov-switch-thumb" />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {modId === 'radar' && radarData && (
          <div className="nov-drawer-grid">
            <div className="nov-drawer-toggle-row">
              <span>{dict.radar.soundChime}</span>
              <button
                type="button"
                role="switch"
                aria-checked={radarData.prefs.soundChime}
                className="nov-switch"
                disabled={drawerSaving}
                onClick={() =>
                  void updateRadarPrefs({ soundChime: !radarData.prefs.soundChime })
                }
              >
                <span className="nov-switch-thumb" />
              </button>
            </div>

            <div className="nov-drawer-toggle-row">
              <span>{dict.radar.desktopNotify}</span>
              <button
                type="button"
                role="switch"
                aria-checked={radarData.prefs.desktopNotify}
                className="nov-switch"
                disabled={drawerSaving}
                onClick={() =>
                  void updateRadarPrefs({ desktopNotify: !radarData.prefs.desktopNotify })
                }
              >
                <span className="nov-switch-thumb" />
              </button>
            </div>

            <label className="nov-drawer-field">
              <span>{dict.radar.stallThreshold} (1–120)</span>
              <input
                type="number"
                className="nov-p-input"
                min={1}
                max={120}
                value={radarData.prefs.stallMinutes}
                disabled={drawerSaving}
                onChange={(e) => {
                  const val = Math.max(1, Math.min(120, Math.floor(Number(e.target.value) || 5)));
                  void updateRadarPrefs({ stallMinutes: val });
                }}
              />
            </label>
          </div>
        )}

        {modId === 'remote' && remoteData && (
          <div className="nov-drawer-stack">
            <div className="nov-card-tags">
              <span className={`nov-badge ${remoteData.running ? 'is-network' : 'is-offline'}`}>
                {remoteData.running ? dict.statusGatewayRunning : dict.common.disabled}
              </span>
              <span className="nov-badge">
                {remoteData.host || '127.0.0.1'}:{remoteData.port ?? 0}
              </span>
              <span className="nov-badge">
                PWA: {remoteData.status?.connectedClients ?? 0}
              </span>
              <span className="nov-badge">
                IM: {(remoteData.channels ?? []).filter((c) => c.enabled).length}
              </span>
            </div>

            <div className="nov-drawer-grid">
              <div className="nov-drawer-toggle-row">
                <span>{sh.remoteApprovalGateLabel}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(remoteData.status?.remoteApprovalEnabled)}
                  className="nov-switch"
                  disabled={drawerSaving}
                  onClick={() =>
                    void updateRemoteSettings({
                      remoteApprovalEnabled: !remoteData.status?.remoteApprovalEnabled,
                    })
                  }
                >
                  <span className="nov-switch-thumb" />
                </button>
              </div>

              <div className="nov-drawer-toggle-row">
                <span>{sh.remoteStopAlertsLabel}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(remoteData.status?.notifyOnStop)}
                  className="nov-switch"
                  disabled={drawerSaving}
                  onClick={() =>
                    void updateRemoteSettings({
                      notifyOnStop: !remoteData.status?.notifyOnStop,
                    })
                  }
                >
                  <span className="nov-switch-thumb" />
                </button>
              </div>

              <div className="nov-drawer-field">
                <span>{sh.remoteGatewayPortLabel} (0–65535)</span>
                <div className="nov-inline-input-row">
                  <input
                    type="number"
                    className="nov-p-input"
                    min={0}
                    max={65535}
                    value={remotePortDraft}
                    disabled={drawerSaving}
                    onChange={(e) => setRemotePortDraft(e.target.value)}
                  />
                  <button
                    type="button"
                    className="nov-p-btn"
                    disabled={drawerSaving}
                    onClick={() => {
                      const parsed = Number(remotePortDraft);
                      if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535) {
                        void updateRemoteSettings({ port: parsed });
                      }
                    }}
                  >
                    {dict.common.save}
                  </button>
                </div>
              </div>
            </div>
            <div className="nov-muted">{dict.panels.remote.liveStreamHint}</div>
          </div>
        )}

        {!CONFIGURABLE_STRATEGY_MODULES.has(modId) && (
          <div className="nov-drawer-stack">
            <p className="nov-drawer-desc">{modText.description}</p>
            <div className="nov-card-tags">
              <span className="nov-badge is-offline">{dict.badgeOffline}</span>
              <span className="nov-badge">
                {t(dict.badgeToolsCount, { n: meta.modelToolNames.length })}
              </span>
              <span className="nov-badge">
                {meta.hooks.length > 0
                  ? t(dict.badgeHooks, { hooks: meta.hooks.join(', ') })
                  : dict.badgeNoHooks}
              </span>
              {modId === 'mem' &&
                typeof (feedSummary.mem?.totalMemories ?? feedSummary.mem?.total) === 'number' && (
                  <span className="nov-badge is-accent">
                    {feedSummary.mem?.totalMemories ?? feedSummary.mem?.total} ·{' '}
                    {dict.hub.staleMemBadge}:{' '}
                    {feedSummary.mem?.staleCount ??
                      feedSummary.mem?.stale ??
                      feedSummary.mem?.drifted ??
                      0}
                  </span>
                )}
              {modId === 'xray' &&
                typeof (feedSummary.xray?.peakContextTokens ?? feedSummary.xray?.totalTokens) ===
                  'number' && (
                  <span className="nov-badge is-accent">
                    {feedSummary.xray?.peakContextTokens ?? feedSummary.xray?.totalTokens} tok
                    {typeof feedSummary.xray?.estimatedCostUsd === 'number' &&
                    feedSummary.xray.estimatedCostUsd > 0
                      ? ` · $${feedSummary.xray.estimatedCostUsd.toFixed(2)}`
                      : ''}
                  </span>
                )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="nov-settings-page">
      {/* S1: Global Mode, Live Search, Presets & Tool Budget */}
      <section className="nov-p-card nov-settings-s1" aria-label={sh.title}>
        <div className="nov-p-row">
          <div>
            <h2 className="nov-hero-title">{sh.title}</h2>
            <p className="nov-hero-sub">{sh.subtitle}</p>
          </div>
          <span className="nov-metric-chip is-offline">
            <strong>{dict.badgeZeroCdp}</strong>
          </span>
        </div>

        {/* Live Search across S1-S4 */}
        <div className="nov-search-wrap">
          <input
            type="search"
            className="nov-p-input"
            aria-label={sh.searchPlaceholder}
            placeholder={sh.searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="nov-p-btn"
              onClick={() => setSearchQuery('')}
            >
              {sh.searchClear}
            </button>
          )}
        </div>

        {/* 5 Presets */}
        <div className="nov-presets-bar" aria-label={dict.presetsLabel}>
          <span className="nov-presets-label">{dict.presetsLabel}</span>
          {PRESET_IDS.map((pid) => {
            const def = dict.presets[pid];
            const active = snapshot.config.preset === pid;
            return (
              <button
                key={pid}
                type="button"
                className={`nov-preset-btn ${active ? 'is-active' : ''}`}
                title={def.description}
                disabled={busyKey !== null}
                onClick={() => void onApplyPreset(pid)}
              >
                {def.label}
              </button>
            );
          })}
          {snapshot.config.preset === 'custom' && (
            <span className="nov-badge">{dict.customSelection}</span>
          )}
        </div>

        {/* MCP Tool Slot Budget Progress Bar */}
        <div className="nov-budget-block">
          <div className="nov-p-row">
            <span className="nov-budget-label">
              {dict.nav.toolBudgetLabel}:{' '}
              <strong>
                {exposedTools} / {budgetLimit}
              </strong>{' '}
              ({snapshot.enabledCount}/{snapshot.totalModules || MODULE_IDS.length}{' '}
              {dict.metricModules})
            </span>
            <span className={`nov-badge ${budgetTone === 'is-safe' ? 'is-offline' : budgetTone === 'is-warn' ? 'is-network' : 'is-danger'}`}>
              {budgetPercent}%
            </span>
          </div>
          <div
            className="nov-budget-meter"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={budgetLimit}
            aria-valuenow={exposedTools}
            aria-label={dict.nav.toolBudgetLabel}
          >
            <div
              className={`nov-budget-fill ${budgetTone}`}
              style={{ width: `${budgetPercent}%` }}
            />
          </div>
        </div>

        {/* Language & Startup View Row */}
        <div className="nov-s1-controls">
          <label className="nov-s1-control-group">
            <span className="nov-s1-label">{dict.langToggleTitle}</span>
            <select
              className="nov-p-select"
              aria-label={dict.langToggleTitle}
              value={prefLocale}
              disabled={busyKey === 'locale'}
              onChange={(e) => void onChangeLocale(e.target.value as NovLocale)}
            >
              <option value="auto">{dict.langAutoOption}</option>
              {UI_LOCALE_IDS.map((loc) => (
                <option key={loc} value={loc}>
                  {LOCALE_NATIVE_LABELS[loc]}
                </option>
              ))}
            </select>
          </label>

          <div className="nov-s1-control-group">
            <span className="nov-s1-label">{sh.startupViewLabel}</span>
            <div className="nov-segmented" role="group" aria-label={sh.startupViewLabel}>
              <button
                type="button"
                className={`nov-seg-btn ${currentStartupView === 'hub' ? 'is-active' : ''}`}
                disabled={busyKey === 'startupView'}
                onClick={() => void onChangeStartupView('hub')}
              >
                {sh.startupHub}
              </button>
              <button
                type="button"
                className={`nov-seg-btn ${currentStartupView === 'last' ? 'is-active' : ''}`}
                disabled={busyKey === 'startupView'}
                onClick={() => void onChangeStartupView('last')}
              >
                {sh.startupLast}
              </button>
            </div>
          </div>
        </div>
      </section>

      {noSearchHits && (
        <div className="nov-p-card">
          <div className="nov-muted">{sh.searchNoHits}</div>
        </div>
      )}

      {/* S2 & S3: 4 Domain Groups — Sole Module Switch Source + On-Demand Strategy Drawer */}
      {filteredDomains.map(({ domainId, modules }) => {
        const domainText = dict.domains[domainId];
        const enabledInDomain = modules.filter((id) => snapshot.config.modules[id]).length;
        return (
          <section
            key={domainId}
            className="nov-domain-group"
            aria-label={domainText.label}
          >
            <div className="nov-category-heading">
              <div className="nov-domain-title-row">
                <h3>{domainText.label}</h3>
                <span className="nov-badge is-accent">{domainText.tierLabel}</span>
                <span className="nov-badge">
                  {enabledInDomain}/{modules.length}
                </span>
              </div>
              <span>{domainText.description}</span>
            </div>

            <div className="nov-module-rows">
              {modules.map((modId) => {
                const meta = MODULE_CATALOG[modId];
                const text = dict.modules[modId];
                const enabled = Boolean(snapshot.config.modules[modId]);
                const isBusy = busyKey === modId || busyKey === 'preset';
                const isExpanded = enabled && expandedModuleId === modId;
                const tierBadgeClass =
                  meta.isolationTier === 'offline' ? 'is-offline' : 'is-network';
                const tierBadgeText =
                  meta.isolationTier === 'offline' ? dict.badgeOffline : dict.badgeOptInNet;

                return (
                  <article
                    key={modId}
                    className={`nov-module-row-card ${enabled ? 'is-enabled' : 'is-disabled'}`}
                  >
                    <div className="nov-module-row-main">
                      <div className="nov-module-row-info">
                        <div className="nov-module-row-title-line">
                          <strong className="nov-module-row-name">{text.name}</strong>
                          <span className={`nov-badge ${tierBadgeClass}`}>{tierBadgeText}</span>
                          <span className="nov-badge">
                            {t(dict.badgeToolsCount, { n: meta.modelToolNames.length })}
                          </span>
                        </div>
                        <p className="nov-module-row-tagline">{text.tagline}</p>
                      </div>

                      <div className="nov-module-row-actions">
                        {/* Strictly on-demand: only show Configure trigger when module is ON */}
                        {enabled && (
                          <button
                            type="button"
                            className={`nov-open-btn ${isExpanded ? 'is-active' : ''}`}
                            aria-expanded={isExpanded}
                            onClick={() => handleToggleDrawer(modId)}
                          >
                            {isExpanded ? sh.collapseBtn : sh.configureBtn}
                          </button>
                        )}
                        <button
                          type="button"
                          role="switch"
                          aria-checked={enabled}
                          aria-label={t(sh.toggleModuleAria, { name: text.name })}
                          className="nov-switch"
                          disabled={isBusy}
                          onClick={() => void onToggleModule(modId, !enabled)}
                        >
                          <span className="nov-switch-thumb" />
                        </button>
                      </div>
                    </div>

                    {/* S3: Lazy-loaded strategy drawer rendered only for the active expanded ON module */}
                    {isExpanded && renderStrategyDrawer(modId)}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}

      {/* S4: Advanced & Team Governance (collapsed by default via <details>) */}
      {advancedMatchesQuery && (
        <details
          className="nov-advanced-details"
          open={Boolean(normalizedQuery) && advancedMatchesQuery}
        >
          <summary className="nov-advanced-summary">
            <div>
              <strong>{sh.advancedTitle}</strong>
              <div className="nov-muted">{sh.advancedSub}</div>
            </div>
          </summary>

          <div className="nov-advanced-body">
            {/* Export / Import Sanitized JSON */}
            <div className="nov-p-item">
              <div className="nov-p-row">
                <strong>
                  {sh.exportBtn} / {sh.importBtn}
                </strong>
                <div className="nov-inline-input-row">
                  <button
                    type="button"
                    className="nov-p-btn"
                    disabled={govBusy}
                    onClick={() => void handleExportConfig()}
                  >
                    {sh.exportBtn}
                  </button>
                  {exportedPayload && (
                    <button
                      type="button"
                      className="nov-p-btn"
                      onClick={() => void handleCopyExport()}
                    >
                      {exportCopied ? dict.common.copied : dict.common.copy}
                    </button>
                  )}
                </div>
              </div>
              <div className="nov-muted">{sh.safetyNotice}</div>

              {exportedPayload && (
                <pre className="nov-p-pre">
                  {JSON.stringify(exportedPayload, null, 2)}
                </pre>
              )}

              <textarea
                className="nov-p-textarea"
                rows={4}
                placeholder={sh.importPlaceholder}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
              />
              <div className="nov-p-row">
                <button
                  type="button"
                  className="nov-p-btn is-primary"
                  disabled={govBusy || !importText.trim()}
                  onClick={() => void handleImportConfig()}
                >
                  {sh.importApplyBtn}
                </button>
                {importSuccessMsg && (
                  <span className="nov-badge is-offline">{importSuccessMsg}</span>
                )}
                {importError && <span className="nov-badge is-danger">{importError}</span>}
              </div>

              {importWarnings.length > 0 && (
                <ul className="nov-warning-list">
                  {importWarnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </div>

            {/* Team Preset Status (.agy-nov.json) */}
            <div className="nov-p-item">
              <div className="nov-p-row">
                <strong>{sh.teamPresetSection}</strong>
                {teamPreset?.found ? (
                  <span className={`nov-badge ${teamPreset.valid ? 'is-offline' : 'is-danger'}`}>
                    {teamPreset.valid ? dict.ops.teamPresetValid : dict.common.invalid}
                    {teamPreset.preset ? ` · ${teamPreset.preset}` : ''}
                  </span>
                ) : (
                  <span className="nov-badge">{dict.ops.teamPresetMissing}</span>
                )}
              </div>
              {teamPreset?.warnings && teamPreset.warnings.length > 0 && (
                <ul className="nov-warning-list">
                  {teamPreset.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </div>

            {/* Tool-Slot Idle Advisor (Read-only budget & idle module audit) */}
            <div className="nov-p-item" aria-label={v10.title}>
              <div className="nov-p-row">
                <strong>{v10.title}</strong>
                <div className="nov-card-tags">
                  <span
                    className={`nov-badge ${budgetTone === 'is-safe' ? 'is-offline' : budgetTone === 'is-warn' ? 'is-network' : 'is-danger'}`}
                  >
                    {t(v10.slotsUsageBadge, { used: exposedTools, limit: budgetLimit })}
                  </span>
                  {reclaimableTools > 0 && (
                    <>
                      <span className="nov-badge is-accent">
                        {t(v10.reclaimBadge, { n: reclaimableTools })}
                      </span>
                      <span className="nov-badge">
                        {t(v10.projectedBadge, { next: projectedTools, limit: budgetLimit })}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="nov-muted">{v10.subtitle}</div>
              {idleCandidates.length === 0 ? (
                <div className="nov-card-tags">
                  <span className="nov-badge is-offline">{v10.allLean}</span>
                </div>
              ) : (
                <div className="nov-p-list">
                  {idleCandidates.map((item) => {
                    const modText = dict.modules[item.moduleId];
                    const isItemBusy = busyKey === item.moduleId || busyKey === 'preset';
                    return (
                      <div key={item.moduleId} className="nov-p-row">
                        <div>
                          <div className="nov-card-tags">
                            <strong>{modText.name}</strong>
                            <span className="nov-badge nov-mono">{item.toolCount}t</span>
                          </div>
                          <div className="nov-muted">{v10.reasons[item.reasonKey]}</div>
                        </div>
                        <button
                          type="button"
                          className="nov-p-btn"
                          aria-label={`${v10.disableBtn} ${modText.name}`}
                          disabled={isItemBusy || busyKey !== null}
                          onClick={() => void onToggleModule(item.moduleId, false)}
                        >
                          {v10.disableBtn}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Dual-Star Feed Snapshot Contract & Slot Hint */}
            <div className="nov-p-item">
              <div className="nov-p-row">
                <strong>{sh.dualStarSection}</strong>
                <span className={`nov-badge ${feedSynced ? 'is-offline' : ''}`}>
                  {feedSynced ? sh.feedReady : sh.feedMissing}
                </span>
              </div>
              <div className="nov-mono nov-path-line">{feedPath}</div>
              <div className="nov-muted">{sh.idleSlotHint}</div>
            </div>

            {/* Inline Two-Step Reset Confirmation (zero window.confirm / window.alert) */}
            <div className="nov-p-item">
              <div className="nov-p-row">
                <strong>{sh.resetBtn}</strong>
                {!confirmingReset ? (
                  <button
                    type="button"
                    className="nov-p-btn is-danger"
                    disabled={govBusy}
                    onClick={() => setConfirmingReset(true)}
                  >
                    {sh.resetBtn}
                  </button>
                ) : (
                  <div className="nov-confirm-inline">
                    <button
                      type="button"
                      className="nov-p-btn is-danger"
                      disabled={govBusy}
                      onClick={() => void handleConfirmReset()}
                    >
                      {sh.resetConfirmBtn}
                    </button>
                    <button
                      type="button"
                      className="nov-p-btn"
                      disabled={govBusy}
                      onClick={() => setConfirmingReset(false)}
                    >
                      {sh.resetCancelBtn}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </details>
      )}
    </div>
  );
};
