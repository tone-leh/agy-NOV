import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ResolvedUiLocale } from '../../../../src/core/catalog.js';
import type { NovBridge } from '../../bridge.js';
import { formatMessage, useNovI18n } from '../../i18n/index.js';
import type {
  GuardDashboardState,
  GuardDecision,
  GuardPermissionMode,
  GuardSnapshotsViewMode,
  GuardTabKey,
  SnapshotDiff,
  ThreatScenario,
  TurnCheckpointDiff,
  TurnCheckpointSummary,
  TurnRestoreResult,
} from './types';
import './styles.css';

export interface NovModulePanelProps {
  bridge: NovBridge;
  active: boolean;
  onNotify?: (message: string) => void;
  incomingEvent?: { toolName?: string; structuredContent: Record<string, unknown> } | null;
  onOpenSettings?: (moduleId: 'guard') => void;
}

interface GuardLocalCopy {
  viewByTurn: string;
  viewByFile: string;
  turnTimelineHeader: string;
  turnFilesCount: string;
  noTurns: string;
  previewTurnDiff: string;
  refreshTurnDiff: string;
  rewindTurn: string;
  rewindTurnConfirmTitle: string;
  rewindTurnConfirmDetail: string;
  confirmRewindTurn: string;
  cancel: string;
  turnIdentical: string;
  turnChangedSummary: string;
  newFileBadge: string;
  deletedFileBadge: string;
  linesBytesMeta: string;
  expandFile: string;
  collapseFile: string;
  loadingDiff: string;
  modeSectionTitle: string;
  modeSectionSubtitle: string;
  modeActiveBadge: string;
  modeReadOnlyTitle: string;
  modeReadOnlyBadge: string;
  modeReadOnlyDesc: string;
  modeBalancedTitle: string;
  modeBalancedBadge: string;
  modeBalancedDesc: string;
  modeStrictTitle: string;
  modeStrictBadge: string;
  modeStrictDesc: string;
  forceAskLabel: string;
  decisionDenyOpt: string;
  decisionForceAskOpt: string;
  decisionAskOpt: string;
  decisionAllowOpt: string;
  ruleEnvTitle: string;
  ruleEnvDesc: string;
  ruleSecretTitle: string;
  ruleSecretDesc: string;
  ruleDestructiveTitle: string;
  ruleDestructiveDesc: string;
  rulePipeTitle: string;
  rulePipeDesc: string;
  autoSnapshotDesc: string;
  customPathsTitle: string;
  customCmdsTitle: string;
  simDotenv: string;
  simSecretWrite: string;
  simForcePush: string;
  simRmRf: string;
  simCurlPipe: string;
  scanSummary: string;
  maskedLabel: string;
  toastLoadFailed: string;
  toastRestored: string;
  toastTurnRewound: string;
  toastRestoreFailed: string;
  toastTurnDiffFailed: string;
  toastOpenedFile: string;
  toastOpenFileHint: string;
  toastPolicySaved: string;
  toastPolicyFailed: string;
  toastSimDone: string;
  toastSimFailed: string;
  toastScanClean: string;
  toastScanFound: string;
  toastScanDone: string;
  toastScanFailed: string;
}

const GUARD_LOCAL_I18N: Record<ResolvedUiLocale, GuardLocalCopy> = {
  en: {
    viewByTurn: 'By Turn Timeline',
    viewByFile: 'By File List',
    turnTimelineHeader: 'Turn Checkpoints',
    turnFilesCount: '{count} file(s)',
    noTurns: 'No turn checkpoints captured yet. Edits within a conversation turn group here automatically.',
    previewTurnDiff: 'Preview Turn Diff',
    refreshTurnDiff: 'Refresh Turn Diff',
    rewindTurn: 'Rewind Entire Turn',
    rewindTurnConfirmTitle: 'Confirm full-turn rewind?',
    rewindTurnConfirmDetail:
      'Restores {count} file(s) back to their pre-turn state and removes newly created files after saving pre-rewind backups.',
    confirmRewindTurn: 'Confirm Rewind',
    cancel: 'Cancel',
    turnIdentical: 'Matches pre-turn state',
    turnChangedSummary: '{changed}/{total} changed',
    newFileBadge: 'New file',
    deletedFileBadge: 'Removed',
    linesBytesMeta: '{lines} lines · {bytes} B',
    expandFile: 'Expand',
    collapseFile: 'Collapse',
    loadingDiff: 'Computing diff...',
    modeSectionTitle: 'Protocol Permission Mode',
    modeSectionSubtitle:
      'Controls PreToolUse gating across file edits and shell commands. High-risk deny rules can never be downgraded.',
    modeActiveBadge: 'Active',
    modeReadOnlyTitle: 'Read-Only Audit',
    modeReadOnlyBadge: 'DENY WRITES & SHELL',
    modeReadOnlyDesc:
      'Blocks all file writes, edits, deletes, and shell commands. Allows safe read-only inspection tools.',
    modeBalancedTitle: 'Balanced Dev',
    modeBalancedBadge: 'DEFAULT',
    modeBalancedDesc:
      'Blocks high-risk commands, sensitive paths, and secret leaks while auto-snapshotting normal workspace edits.',
    modeStrictTitle: 'Strict Gate',
    modeStrictBadge: 'FORCE_ASK',
    modeStrictDesc:
      'Forces interactive human confirmation (force_ask, bypassing caches) on every file mutation and shell command.',
    forceAskLabel: 'FORCE ASK',
    decisionDenyOpt: 'DENY — {label}',
    decisionForceAskOpt: 'FORCE_ASK — {label}',
    decisionAskOpt: 'ASK — {label}',
    decisionAllowOpt: 'ALLOW — {label}',
    ruleEnvTitle: '.env, SSH & Cloud Credential Shield',
    ruleEnvDesc: 'Blocks reads and exfiltration of .env, *.pem, ~/.ssh, and ~/.aws/credentials.',
    ruleSecretTitle: 'Outgoing Secret-Leak Shield',
    ruleSecretDesc: 'Scans write/edit payloads for API keys, JWTs, and private key blocks.',
    ruleDestructiveTitle: 'Destructive Shell Command Shield',
    ruleDestructiveDesc: 'Blocks rm -rf /, git push --force, git reset --hard, and DROP TABLE.',
    rulePipeTitle: 'Remote Pipe Execution Gate',
    rulePipeDesc: 'Prompts or blocks curl/wget piped directly into sh/bash.',
    autoSnapshotDesc:
      'SHA-256 deduplicated pre-edit backup before every mutating edit with zero Git history pollution.',
    customPathsTitle: 'Custom Protected Paths (one per line)',
    customCmdsTitle: 'Custom Blocked Commands (one per line)',
    simDotenv: 'Simulate .env Read',
    simSecretWrite: 'Simulate API Key Write',
    simForcePush: 'Simulate git push --force',
    simRmRf: 'Simulate rm -rf /',
    simCurlPipe: 'Simulate curl | sh',
    scanSummary: 'Scanned {scanned} files (skipped {skipped}) at {time} — findings:',
    maskedLabel: 'masked',
    toastLoadFailed: 'Failed to load guard state: {error}',
    toastRestored: 'Snapshot restored',
    toastTurnRewound: 'Rewound turn: restored {restored} file(s), removed {deleted} new file(s)',
    toastRestoreFailed: 'Restore failed: {error}',
    toastTurnDiffFailed: 'Failed to load turn diff: {error}',
    toastOpenedFile: 'Opened {file}',
    toastOpenFileHint: 'File path: {file}',
    toastPolicySaved: 'Guard policy saved',
    toastPolicyFailed: 'Policy update failed: {error}',
    toastSimDone: 'Simulated threat evaluated',
    toastSimFailed: 'Simulation failed: {error}',
    toastScanClean: 'Workspace clean: 0 hardcoded secrets found',
    toastScanFound: 'Found {count} potential secret(s)',
    toastScanDone: 'Workspace secret scan completed',
    toastScanFailed: 'Workspace scan failed: {error}',
  },
  'zh-CN': {
    viewByTurn: '轮次时间线',
    viewByFile: '单文件列表',
    turnTimelineHeader: '轮次检查点',
    turnFilesCount: '{count} 个文件',
    noTurns: '暂无轮次检查点。同一对话回合内连续修改多个文件会自动归组到此。',
    previewTurnDiff: '预览整轮 Diff',
    refreshTurnDiff: '刷新整轮 Diff',
    rewindTurn: '整组回滚此轮',
    rewindTurnConfirmTitle: '确认整组回滚此轮？',
    rewindTurnConfirmDetail:
      '将先创建 pre-rewind 备份快照，随后把 {count} 个文件恢复至本轮首次修改前状态，并安全移除本轮新建文件。',
    confirmRewindTurn: '确认整组回滚',
    cancel: '取消',
    turnIdentical: '已与本轮修改前一致',
    turnChangedSummary: '{changed}/{total} 个文件有差异',
    newFileBadge: '新建文件',
    deletedFileBadge: '已移除',
    linesBytesMeta: '{lines} 行 · {bytes} B',
    expandFile: '展开',
    collapseFile: '折叠',
    loadingDiff: '正在计算差异...',
    modeSectionTitle: '3 档协议级权限模式',
    modeSectionSubtitle:
      '统一控制 PreToolUse 对文件修改与命令执行的拦截档位。高危硬拦截（deny）在任何模式下均不可降级。',
    modeActiveBadge: '当前生效',
    modeReadOnlyTitle: '只读审计',
    modeReadOnlyBadge: '禁止写改与命令',
    modeReadOnlyDesc: '拦截所有写/改/删文件与命令执行工具，仅放行安全的只读检索与查看工具。',
    modeBalancedTitle: '均衡开发',
    modeBalancedBadge: '默认模式',
    modeBalancedDesc: '拦截高危命令、敏感路径与密钥泄漏，正常开发编辑自动拍快照后放行。',
    modeStrictTitle: '严格受控',
    modeStrictBadge: 'FORCE_ASK 强确认',
    modeStrictDesc: '对所有非高危文件修改与命令执行返回 force_ask，无视缓存强制人工确认。',
    forceAskLabel: '强制确认',
    decisionDenyOpt: '拦截 (DENY) — {label}',
    decisionForceAskOpt: '强制确认 (FORCE_ASK) — {label}',
    decisionAskOpt: '询问 (ASK) — {label}',
    decisionAllowOpt: '放行 (ALLOW) — {label}',
    ruleEnvTitle: '.env、SSH 与云凭证护盾',
    ruleEnvDesc: '拦截读取或外泄 .env、*.pem、~/.ssh 与 ~/.aws/credentials。',
    ruleSecretTitle: '写入密钥防泄漏护盾',
    ruleSecretDesc: '扫描写/改文件载荷中的 API 密钥、JWT 与私钥块。',
    ruleDestructiveTitle: '高危破坏性命令护盾',
    ruleDestructiveDesc: '拦截 rm -rf /、git push --force、git reset --hard 与 DROP TABLE。',
    rulePipeTitle: '远程脚本管道闸门',
    rulePipeDesc: '对 curl/wget 直接管道执行 sh/bash 触发确认或拦截。',
    autoSnapshotDesc: '每次修改文件前自动按 SHA-256 去重备份，零污染 Git 提交历史。',
    customPathsTitle: '自定义受保护路径（每行一条）',
    customCmdsTitle: '自定义拦截命令片段（每行一条）',
    simDotenv: '模拟读取 .env',
    simSecretWrite: '模拟写入 API Key',
    simForcePush: '模拟 git push --force',
    simRmRf: '模拟 rm -rf /',
    simCurlPipe: '模拟 curl | sh',
    scanSummary: '已扫描 {scanned} 个文件（跳过 {skipped} 个），时间 {time} — 发现项：',
    maskedLabel: '已脱敏',
    toastLoadFailed: '加载守卫状态失败：{error}',
    toastRestored: '快照已恢复',
    toastTurnRewound: '整轮已回滚：恢复 {restored} 个文件，移除 {deleted} 个新建文件',
    toastRestoreFailed: '回滚失败：{error}',
    toastTurnDiffFailed: '加载整轮 Diff 失败：{error}',
    toastOpenedFile: '已打开 {file}',
    toastOpenFileHint: '文件路径：{file}',
    toastPolicySaved: '守卫策略已保存',
    toastPolicyFailed: '保存策略失败：{error}',
    toastSimDone: '威胁模拟评估完成',
    toastSimFailed: '模拟评估失败：{error}',
    toastScanClean: '工作区安全：未发现硬编码密钥',
    toastScanFound: '发现 {count} 处疑似硬编码密钥',
    toastScanDone: '工作区密钥扫描完成',
    toastScanFailed: '工作区扫描失败：{error}',
  },
  'zh-TW': {
    viewByTurn: '輪次時間線',
    viewByFile: '單檔列表',
    turnTimelineHeader: '輪次檢查點',
    turnFilesCount: '{count} 個檔案',
    noTurns: '尚無輪次檢查點。同一對話回合內連續修改多個檔案會自動歸組於此。',
    previewTurnDiff: '預覽整輪 Diff',
    refreshTurnDiff: '重新整理整輪 Diff',
    rewindTurn: '整組回滾此輪',
    rewindTurnConfirmTitle: '確認整組回滾此輪？',
    rewindTurnConfirmDetail:
      '將先建立 pre-rewind 備份快照，再把 {count} 個檔案還原至本輪首次修改前狀態，並安全移除本輪新建檔案。',
    confirmRewindTurn: '確認整組回滾',
    cancel: '取消',
    turnIdentical: '已與本輪修改前一致',
    turnChangedSummary: '{changed}/{total} 個檔案有差異',
    newFileBadge: '新建檔案',
    deletedFileBadge: '已移除',
    linesBytesMeta: '{lines} 行 · {bytes} B',
    expandFile: '展開',
    collapseFile: '摺疊',
    loadingDiff: '正在計算差異...',
    modeSectionTitle: '3 檔協議級權限模式',
    modeSectionSubtitle:
      '統一控制 PreToolUse 對檔案修改與指令執行的攔截檔位。高危硬攔截（deny）在任何模式下皆不可降級。',
    modeActiveBadge: '目前生效',
    modeReadOnlyTitle: '唯讀稽核',
    modeReadOnlyBadge: '禁止寫改與指令',
    modeReadOnlyDesc: '攔截所有寫/改/刪檔案與指令執行工具，僅放行安全的唯讀檢視工具。',
    modeBalancedTitle: '均衡開發',
    modeBalancedBadge: '預設模式',
    modeBalancedDesc: '攔截高危指令、敏感路徑與金鑰外洩，正常開發編輯自動建立快照後放行。',
    modeStrictTitle: '嚴格受控',
    modeStrictBadge: 'FORCE_ASK 強確認',
    modeStrictDesc: '對所有非高危檔案修改與指令執行回傳 force_ask，無視快取強制人工確認。',
    forceAskLabel: '強制確認',
    decisionDenyOpt: '攔截 (DENY) — {label}',
    decisionForceAskOpt: '強制確認 (FORCE_ASK) — {label}',
    decisionAskOpt: '詢問 (ASK) — {label}',
    decisionAllowOpt: '放行 (ALLOW) — {label}',
    ruleEnvTitle: '.env、SSH 與雲端憑證護盾',
    ruleEnvDesc: '攔截讀取或外洩 .env、*.pem、~/.ssh 與 ~/.aws/credentials。',
    ruleSecretTitle: '寫入金鑰防外洩護盾',
    ruleSecretDesc: '掃描寫/改檔案內容中的 API 金鑰、JWT 與私鑰區塊。',
    ruleDestructiveTitle: '高危破壞性指令護盾',
    ruleDestructiveDesc: '攔截 rm -rf /、git push --force、git reset --hard 與 DROP TABLE。',
    rulePipeTitle: '遠端腳本管線閘門',
    rulePipeDesc: '對 curl/wget 直接管線執行 sh/bash 觸發確認或攔截。',
    autoSnapshotDesc: '每次修改檔案前自動以 SHA-256 去重備份，零污染 Git 紀錄。',
    customPathsTitle: '自訂受保護路徑（每行一條）',
    customCmdsTitle: '自訂攔截指令片段（每行一條）',
    simDotenv: '模擬讀取 .env',
    simSecretWrite: '模擬寫入 API Key',
    simForcePush: '模擬 git push --force',
    simRmRf: '模擬 rm -rf /',
    simCurlPipe: '模擬 curl | sh',
    scanSummary: '已掃描 {scanned} 個檔案（略過 {skipped} 個），時間 {time} — 發現項：',
    maskedLabel: '已遮罩',
    toastLoadFailed: '載入守衛狀態失敗：{error}',
    toastRestored: '快照已還原',
    toastTurnRewound: '整輪已回滾：還原 {restored} 個檔案，移除 {deleted} 個新建檔案',
    toastRestoreFailed: '回滾失敗：{error}',
    toastTurnDiffFailed: '載入整輪 Diff 失敗：{error}',
    toastOpenedFile: '已開啟 {file}',
    toastOpenFileHint: '檔案路徑：{file}',
    toastPolicySaved: '守衛策略已儲存',
    toastPolicyFailed: '儲存策略失敗：{error}',
    toastSimDone: '威脅模擬評估完成',
    toastSimFailed: '模擬評估失敗：{error}',
    toastScanClean: '工作區安全：未發現硬編碼金鑰',
    toastScanFound: '發現 {count} 處疑似硬編碼金鑰',
    toastScanDone: '工作區金鑰掃描完成',
    toastScanFailed: '工作區掃描失敗：{error}',
  },
  ja: {
    viewByTurn: 'ターン別タイムライン',
    viewByFile: 'ファイル一覧',
    turnTimelineHeader: 'ターンチェックポイント',
    turnFilesCount: '{count} 件のファイル',
    noTurns: 'ターンチェックポイントはまだありません。同一ターン内の複数ファイル編集が自動でまとまります。',
    previewTurnDiff: 'ターン全体の差分を表示',
    refreshTurnDiff: 'ターン差分を更新',
    rewindTurn: 'このターンを一括ロールバック',
    rewindTurnConfirmTitle: 'このターン全体を一括ロールバックしますか？',
    rewindTurnConfirmDetail:
      'pre-rewind バックアップ作成後、{count} 件のファイルをターン開始前の状態に戻し、新規作成ファイルを安全に削除します。',
    confirmRewindTurn: '一括ロールバックを実行',
    cancel: 'キャンセル',
    turnIdentical: 'ターン前と一致しています',
    turnChangedSummary: '{changed}/{total} 件に差分あり',
    newFileBadge: '新規',
    deletedFileBadge: '削除済み',
    linesBytesMeta: '{lines} 行 · {bytes} B',
    expandFile: '展開',
    collapseFile: '折りたたむ',
    loadingDiff: '差分を計算中...',
    modeSectionTitle: 'プロトコル権限モード（3 段階）',
    modeSectionSubtitle:
      'PreToolUse におけるファイル編集・コマンド実行の制御レベルを切り替えます。高リスクの deny は常に維持されます。',
    modeActiveBadge: '有効',
    modeReadOnlyTitle: '読み取り専用監査',
    modeReadOnlyBadge: '書込・実行を拒否',
    modeReadOnlyDesc: 'すべてのファイル変更・削除・シェル実行を拒否し、安全な読み取り操作のみ許可します。',
    modeBalancedTitle: 'バランス開発',
    modeBalancedBadge: 'デフォルト',
    modeBalancedDesc: '危険コマンド・機密ファイル・秘密漏洩を遮断しつつ、通常編集は自動スナップショットで保護します。',
    modeStrictTitle: '厳格ゲート',
    modeStrictBadge: 'FORCE_ASK',
    modeStrictDesc: 'すべてのファイル変更・コマンド実行でキャッシュを無視して force_ask による手動確認を要求します。',
    forceAskLabel: '強制確認',
    decisionDenyOpt: '拒否 (DENY) — {label}',
    decisionForceAskOpt: '強制確認 (FORCE_ASK) — {label}',
    decisionAskOpt: '確認 (ASK) — {label}',
    decisionAllowOpt: '許可 (ALLOW) — {label}',
    ruleEnvTitle: '.env・SSH・クラウド認証シールド',
    ruleEnvDesc: '.env、*.pem、~/.ssh、~/.aws/credentials の読み取りや流出を遮断します。',
    ruleSecretTitle: '機密書き込み検知シールド',
    ruleSecretDesc: '編集ペイロード内の API キー・JWT・秘密鍵ブロックを検知します。',
    ruleDestructiveTitle: '破壊的シェルコマンド遮断',
    ruleDestructiveDesc: 'rm -rf /、git push --force、git reset --hard、DROP TABLE を遮断します。',
    rulePipeTitle: 'リモートパイプ実行ゲート',
    rulePipeDesc: 'curl/wget を直接 sh/bash にパイプする実行を確認または遮断します。',
    autoSnapshotDesc: 'Git 履歴を汚さずに編集前ファイルを SHA-256 重複排除で自動バックアップします。',
    customPathsTitle: 'カスタム保護パス（1 行に 1 件）',
    customCmdsTitle: 'カスタム拒否コマンド（1 行に 1 件）',
    simDotenv: '.env 読取をテスト',
    simSecretWrite: 'API キー書込をテスト',
    simForcePush: 'git push --force をテスト',
    simRmRf: 'rm -rf / をテスト',
    simCurlPipe: 'curl | sh をテスト',
    scanSummary: '{scanned} 件スキャン（スキップ {skipped} 件）· {time} — 検出件数：',
    maskedLabel: 'マスク済み',
    toastLoadFailed: 'ガード状態の読み込みに失敗しました: {error}',
    toastRestored: 'スナップショットを復元しました',
    toastTurnRewound: 'ターンを復元: {restored} 件を元に戻し、新規 {deleted} 件を削除しました',
    toastRestoreFailed: '復元に失敗しました: {error}',
    toastTurnDiffFailed: 'ターン差分の取得に失敗しました: {error}',
    toastOpenedFile: '{file} を開きました',
    toastOpenFileHint: 'ファイルパス: {file}',
    toastPolicySaved: 'ガードポリシーを保存しました',
    toastPolicyFailed: 'ポリシー更新に失敗しました: {error}',
    toastSimDone: '脅威シミュレーションを評価しました',
    toastSimFailed: 'シミュレーションに失敗しました: {error}',
    toastScanClean: '異常なし: ハードコードされた機密情報は 0 件です',
    toastScanFound: '機密情報の候補を {count} 件検出しました',
    toastScanDone: 'ワークスペースのスキャンが完了しました',
    toastScanFailed: 'スキャンに失敗しました: {error}',
  },
  ko: {
    viewByTurn: '턴별 타임라인',
    viewByFile: '파일 목록',
    turnTimelineHeader: '턴 체크포인트',
    turnFilesCount: '파일 {count}개',
    noTurns: '저장된 턴 체크포인트가 없습니다. 같은 대화 턴의 연속 파일 수정이 자동으로 묶입니다.',
    previewTurnDiff: '턴 전체 Diff 미리보기',
    refreshTurnDiff: '턴 Diff 새로고침',
    rewindTurn: '이 턴 전체 롤백',
    rewindTurnConfirmTitle: '이 턴 전체를 롤백할까요?',
    rewindTurnConfirmDetail:
      'pre-rewind 백업을 먼저 저장한 뒤 파일 {count}개를 턴 이전 상태로 복원하고 새로 생성된 파일을 안전하게 삭제합니다.',
    confirmRewindTurn: '전체 롤백 확인',
    cancel: '취소',
    turnIdentical: '턴 이전 상태와 동일함',
    turnChangedSummary: '{changed}/{total}개 변경됨',
    newFileBadge: '새 파일',
    deletedFileBadge: '삭제됨',
    linesBytesMeta: '{lines}줄 · {bytes} B',
    expandFile: '펼치기',
    collapseFile: '접기',
    loadingDiff: 'Diff 계산 중...',
    modeSectionTitle: '3단계 프로토콜 권한 모드',
    modeSectionSubtitle:
      '파일 수정 및 셸 명령에 대한 PreToolUse 제어 수준을 설정합니다. 고위험 deny 규칙은 절대 완화되지 않습니다.',
    modeActiveBadge: '활성',
    modeReadOnlyTitle: '읽기 전용 감사',
    modeReadOnlyBadge: '쓰기·명령 차단',
    modeReadOnlyDesc: '모든 파일 쓰기/수정/삭제 및 셸 명령을 차단하고 안전한 읽기 전용 도구만 허용합니다.',
    modeBalancedTitle: '균형 개발',
    modeBalancedBadge: '기본값',
    modeBalancedDesc: '고위험 명령, 민감 파일, 시크릿 유출을 차단하며 일반 편집 전 자동 스냅샷을 저장합니다.',
    modeStrictTitle: '엄격 게이트',
    modeStrictBadge: 'FORCE_ASK',
    modeStrictDesc: '모든 파일 수정과 셸 명령에 대해 캐시를 무시하고 force_ask로 수동 승인을 요구합니다.',
    forceAskLabel: '강제 확인',
    decisionDenyOpt: '차단 (DENY) — {label}',
    decisionForceAskOpt: '강제 확인 (FORCE_ASK) — {label}',
    decisionAskOpt: '확인 (ASK) — {label}',
    decisionAllowOpt: '허용 (ALLOW) — {label}',
    ruleEnvTitle: '.env, SSH 및 클라우드 자격 증명 보호',
    ruleEnvDesc: '.env, *.pem, ~/.ssh, ~/.aws/credentials 읽기 및 유출을 차단합니다.',
    ruleSecretTitle: '시크릿 코드 작성 차단',
    ruleSecretDesc: '파일 쓰기/편집 페이로드에서 API 키, JWT, 개인 키를 탐지합니다.',
    ruleDestructiveTitle: '파괴적 셸 명령 차단',
    ruleDestructiveDesc: 'rm -rf /, git push --force, git reset --hard, DROP TABLE을 차단합니다.',
    rulePipeTitle: '원격 파이프 실행 게이트',
    rulePipeDesc: 'curl/wget 출력을 sh/bash로 직접 파이프 실행 시 확인 또는 차단합니다.',
    autoSnapshotDesc: 'Git 이력을 오염시키지 않고 모든 편집 전 SHA-256 중복 제거 백업을 자동 생성합니다.',
    customPathsTitle: '사용자 지정 보호 경로 (한 줄에 하나)',
    customCmdsTitle: '사용자 지정 차단 명령 (한 줄에 하나)',
    simDotenv: '.env 읽기 테스트',
    simSecretWrite: 'API 키 쓰기 테스트',
    simForcePush: 'git push --force 테스트',
    simRmRf: 'rm -rf / 테스트',
    simCurlPipe: 'curl | sh 테스트',
    scanSummary: '{scanned}개 파일 검사 완료 (건너뜀 {skipped}개) · {time} — 탐지:',
    maskedLabel: '마스킹됨',
    toastLoadFailed: '가드 상태를 불러오지 못했습니다: {error}',
    toastRestored: '스냅샷을 복원했습니다',
    toastTurnRewound: '턴 롤백 완료: 파일 {restored}개 복원, 새 파일 {deleted}개 삭제',
    toastRestoreFailed: '복원 실패: {error}',
    toastTurnDiffFailed: '턴 Diff를 불러오지 못했습니다: {error}',
    toastOpenedFile: '{file} 열림',
    toastOpenFileHint: '파일 경로: {file}',
    toastPolicySaved: '가드 정책이 저장되었습니다',
    toastPolicyFailed: '정책 업데이트 실패: {error}',
    toastSimDone: '위협 시뮬레이션 평가 완료',
    toastSimFailed: '시뮬레이션 실패: {error}',
    toastScanClean: '워크스페이스 안전: 하드코딩된 시크릿 0건',
    toastScanFound: '잠재적 시크릿 {count}건 발견',
    toastScanDone: '워크스페이스 시크릿 검사 완료',
    toastScanFailed: '워크스페이스 검사 실패: {error}',
  },
  es: {
    viewByTurn: 'Línea por turno',
    viewByFile: 'Lista por archivo',
    turnTimelineHeader: 'Puntos por turno',
    turnFilesCount: '{count} archivo(s)',
    noTurns: 'Aún no hay turnos capturados. Las ediciones consecutivas de un turno se agrupan aquí.',
    previewTurnDiff: 'Ver Diff del turno',
    refreshTurnDiff: 'Actualizar Diff',
    rewindTurn: 'Revertir todo el turno',
    rewindTurnConfirmTitle: '¿Confirmar reversión completa del turno?',
    rewindTurnConfirmDetail:
      'Creará copias pre-rewind y restaurará {count} archivo(s) a su estado previo, eliminando los archivos nuevos.',
    confirmRewindTurn: 'Confirmar reversión',
    cancel: 'Cancelar',
    turnIdentical: 'Coincide con el estado previo',
    turnChangedSummary: '{changed}/{total} modificados',
    newFileBadge: 'Nuevo',
    deletedFileBadge: 'Eliminado',
    linesBytesMeta: '{lines} líneas · {bytes} B',
    expandFile: 'Expandir',
    collapseFile: 'Contraer',
    loadingDiff: 'Calculando diferencias...',
    modeSectionTitle: 'Modo de permisos de protocolo',
    modeSectionSubtitle:
      'Controla PreToolUse en ediciones y comandos shell. Los bloqueos críticos (deny) nunca se degradan.',
    modeActiveBadge: 'Activo',
    modeReadOnlyTitle: 'Auditoría solo lectura',
    modeReadOnlyBadge: 'BLOQUEA ESCRITURA Y SHELL',
    modeReadOnlyDesc: 'Bloquea escrituras, ediciones, borrados y comandos shell; permite herramientas solo lectura.',
    modeBalancedTitle: 'Desarrollo equilibrado',
    modeBalancedBadge: 'PREDETERMINADO',
    modeBalancedDesc: 'Bloquea comandos peligrosos, rutas sensibles y secretos con instantáneas automáticas.',
    modeStrictTitle: 'Control estricto',
    modeStrictBadge: 'FORCE_ASK',
    modeStrictDesc: 'Exige confirmación manual (force_ask, sin caché) en cada escritura y comando shell.',
    forceAskLabel: 'CONFIRMAR',
    decisionDenyOpt: 'DENEGAR (DENY) — {label}',
    decisionForceAskOpt: 'FORZAR CONFIRMACIÓN (FORCE_ASK) — {label}',
    decisionAskOpt: 'PREGUNTAR (ASK) — {label}',
    decisionAllowOpt: 'PERMITIR (ALLOW) — {label}',
    ruleEnvTitle: 'Escudo de .env, SSH y credenciales cloud',
    ruleEnvDesc: 'Bloquea lectura o fuga de .env, *.pem, ~/.ssh y ~/.aws/credentials.',
    ruleSecretTitle: 'Escudo contra fuga de secretos',
    ruleSecretDesc: 'Analiza escrituras en busca de claves API, JWT y claves privadas.',
    ruleDestructiveTitle: 'Escudo de comandos destructivos',
    ruleDestructiveDesc: 'Bloquea rm -rf /, git push --force, git reset --hard y DROP TABLE.',
    rulePipeTitle: 'Compuerta de tuberías remotas',
    rulePipeDesc: 'Solicita confirmación o bloquea curl/wget encadenado a sh/bash.',
    autoSnapshotDesc: 'Respaldo automático deduplicado por SHA-256 antes de cada edición sin ensuciar Git.',
    customPathsTitle: 'Rutas protegidas personalizadas (una por línea)',
    customCmdsTitle: 'Comandos bloqueados personalizados (uno por línea)',
    simDotenv: 'Simular lectura .env',
    simSecretWrite: 'Simular clave API',
    simForcePush: 'Simular git push --force',
    simRmRf: 'Simular rm -rf /',
    simCurlPipe: 'Simular curl | sh',
    scanSummary: 'Escaneados {scanned} archivos (omitidos {skipped}) a las {time} — hallazgos:',
    maskedLabel: 'enmascarado',
    toastLoadFailed: 'Error al cargar estado de Guard: {error}',
    toastRestored: 'Instantánea restaurada',
    toastTurnRewound: 'Turno revertido: {restored} restaurado(s), {deleted} nuevo(s) eliminado(s)',
    toastRestoreFailed: 'Error al restaurar: {error}',
    toastTurnDiffFailed: 'Error al cargar diff del turno: {error}',
    toastOpenedFile: 'Abierto {file}',
    toastOpenFileHint: 'Ruta: {file}',
    toastPolicySaved: 'Política de Guard guardada',
    toastPolicyFailed: 'Error al guardar política: {error}',
    toastSimDone: 'Simulación evaluada',
    toastSimFailed: 'Error de simulación: {error}',
    toastScanClean: 'Espacio limpio: 0 secretos expuestos',
    toastScanFound: 'Se encontraron {count} posible(s) secreto(s)',
    toastScanDone: 'Escaneo de secretos completado',
    toastScanFailed: 'Error al escanear: {error}',
  },
  fr: {
    viewByTurn: 'Chronologie par tour',
    viewByFile: 'Liste par fichier',
    turnTimelineHeader: 'Points de contrôle par tour',
    turnFilesCount: '{count} fichier(s)',
    noTurns: 'Aucun tour capturé. Les modifications consécutives d’un tour se regroupent automatiquement ici.',
    previewTurnDiff: 'Aperçu du Diff du tour',
    refreshTurnDiff: 'Actualiser le Diff',
    rewindTurn: 'Annuler tout le tour',
    rewindTurnConfirmTitle: 'Confirmer le retour arrière du tour ?',
    rewindTurnConfirmDetail:
      'Crée des sauvegardes pre-rewind puis restaure {count} fichier(s) et supprime les nouveaux fichiers créés.',
    confirmRewindTurn: 'Confirmer le retour arrière',
    cancel: 'Annuler',
    turnIdentical: 'Identique à l’état initial',
    turnChangedSummary: '{changed}/{total} modifié(s)',
    newFileBadge: 'Nouveau',
    deletedFileBadge: 'Supprimé',
    linesBytesMeta: '{lines} lignes · {bytes} o',
    expandFile: 'Déplier',
    collapseFile: 'Replier',
    loadingDiff: 'Calcul du diff...',
    modeSectionTitle: 'Mode de permission protocole',
    modeSectionSubtitle:
      'Contrôle PreToolUse sur les écritures et commandes shell. Les blocages critiques (deny) restent inviolables.',
    modeActiveBadge: 'Actif',
    modeReadOnlyTitle: 'Audit lecture seule',
    modeReadOnlyBadge: 'BLOQUE ÉCRITURE & SHELL',
    modeReadOnlyDesc: 'Bloque toutes les écritures, modifications, suppressions et commandes shell ; autorise la lecture seule.',
    modeBalancedTitle: 'Développement équilibré',
    modeBalancedBadge: 'PAR DÉFAUT',
    modeBalancedDesc: 'Bloque commandes destructrices, chemins sensibles et secrets avec sauvegardes automatiques.',
    modeStrictTitle: 'Contrôle strict',
    modeStrictBadge: 'FORCE_ASK',
    modeStrictDesc: 'Impose une confirmation manuelle (force_ask, sans cache) sur chaque écriture et commande shell.',
    forceAskLabel: 'CONFIRMER',
    decisionDenyOpt: 'BLOQUER (DENY) — {label}',
    decisionForceAskOpt: 'CONFIRMATION FORCÉE (FORCE_ASK) — {label}',
    decisionAskOpt: 'DEMANDER (ASK) — {label}',
    decisionAllowOpt: 'AUTORISER (ALLOW) — {label}',
    ruleEnvTitle: 'Bouclier .env, SSH et identifiants cloud',
    ruleEnvDesc: 'Bloque la lecture ou fuite de .env, *.pem, ~/.ssh et ~/.aws/credentials.',
    ruleSecretTitle: 'Bouclier anti-fuite de secrets',
    ruleSecretDesc: 'Analyse les écritures pour détecter clés API, JWT et clés privées.',
    ruleDestructiveTitle: 'Bouclier commandes destructrices',
    ruleDestructiveDesc: 'Bloque rm -rf /, git push --force, git reset --hard et DROP TABLE.',
    rulePipeTitle: 'Contrôle des scripts distants pipés',
    rulePipeDesc: 'Demande confirmation ou bloque curl/wget envoyé vers sh/bash.',
    autoSnapshotDesc: 'Sauvegarde automatique dédupliquée SHA-256 avant chaque édition sans polluer Git.',
    customPathsTitle: 'Chemins protégés personnalisés (un par ligne)',
    customCmdsTitle: 'Commandes bloquées personnalisées (une par ligne)',
    simDotenv: 'Simuler lecture .env',
    simSecretWrite: 'Simuler écriture clé API',
    simForcePush: 'Simuler git push --force',
    simRmRf: 'Simuler rm -rf /',
    simCurlPipe: 'Simuler curl | sh',
    scanSummary: '{scanned} fichiers analysés ({skipped} ignorés) à {time} — alertes :',
    maskedLabel: 'masqué',
    toastLoadFailed: 'Échec du chargement de Guard : {error}',
    toastRestored: 'Instantané restauré',
    toastTurnRewound: 'Tour annulé : {restored} restauré(s), {deleted} nouveau(x) supprimé(s)',
    toastRestoreFailed: 'Échec de la restauration : {error}',
    toastTurnDiffFailed: 'Échec du diff du tour : {error}',
    toastOpenedFile: 'Ouvert : {file}',
    toastOpenFileHint: 'Chemin : {file}',
    toastPolicySaved: 'Politique Guard enregistrée',
    toastPolicyFailed: 'Échec de la mise à jour : {error}',
    toastSimDone: 'Simulation évaluée',
    toastSimFailed: 'Échec de la simulation : {error}',
    toastScanClean: 'Espace sain : 0 secret détecté',
    toastScanFound: '{count} secret(s) potentiel(s) détecté(s)',
    toastScanDone: 'Analyse des secrets terminée',
    toastScanFailed: 'Échec de l’analyse : {error}',
  },
  de: {
    viewByTurn: 'Nach Turn-Zeitachse',
    viewByFile: 'Nach Dateiliste',
    turnTimelineHeader: 'Turn-Checkpoints',
    turnFilesCount: '{count} Datei(en)',
    noTurns: 'Noch keine Turn-Checkpoints. Mehrere Dateiänderungen in einem Turn werden hier automatisch gruppiert.',
    previewTurnDiff: 'Turn-Diff anzeigen',
    refreshTurnDiff: 'Turn-Diff aktualisieren',
    rewindTurn: 'Gesamten Turn zurücksetzen',
    rewindTurnConfirmTitle: 'Gesamten Turn wirklich zurücksetzen?',
    rewindTurnConfirmDetail:
      'Erstellt zuerst Pre-Rewind-Backups, stellt {count} Datei(en) wieder her und entfernt neu angelegte Dateien.',
    confirmRewindTurn: 'Zurücksetzen bestätigen',
    cancel: 'Abbrechen',
    turnIdentical: 'Entspricht dem Zustand vor dem Turn',
    turnChangedSummary: '{changed}/{total} geändert',
    newFileBadge: 'Neue Datei',
    deletedFileBadge: 'Entfernt',
    linesBytesMeta: '{lines} Zeilen · {bytes} B',
    expandFile: 'Aufklappen',
    collapseFile: 'Einklappen',
    loadingDiff: 'Diff wird berechnet...',
    modeSectionTitle: 'Protokoll-Berechtigungsmodus (3 Stufen)',
    modeSectionSubtitle:
      'Steuert PreToolUse für Dateiänderungen und Shell-Befehle. Kritische Deny-Regeln werden niemals abgeschwächt.',
    modeActiveBadge: 'Aktiv',
    modeReadOnlyTitle: 'Nur-Lese-Audit',
    modeReadOnlyBadge: 'SCHREIBEN & SHELL GESPERRT',
    modeReadOnlyDesc: 'Blockiert alle Dateischreib-, Bearbeitungs-, Lösch- und Shell-Tools; erlaubt nur Lesezugriffe.',
    modeBalancedTitle: 'Ausgewogene Entwicklung',
    modeBalancedBadge: 'STANDARD',
    modeBalancedDesc: 'Blockiert gefährliche Befehle, sensible Pfade und Secrets bei automatischen Snapshots.',
    modeStrictTitle: 'Strikte Kontrolle',
    modeStrictBadge: 'FORCE_ASK',
    modeStrictDesc: 'Erzwingt manuelle Bestätigung (force_ask, ohne Cache) bei jeder Änderung und jedem Shell-Befehl.',
    forceAskLabel: 'ZWINGEND FRAGEN',
    decisionDenyOpt: 'BLOCKIEREN (DENY) — {label}',
    decisionForceAskOpt: 'ZWINGEND FRAGEN (FORCE_ASK) — {label}',
    decisionAskOpt: 'FRAGEN (ASK) — {label}',
    decisionAllowOpt: 'ERLAUBEN (ALLOW) — {label}',
    ruleEnvTitle: '.env-, SSH- & Cloud-Zugangsdatenschutz',
    ruleEnvDesc: 'Blockiert Zugriff oder Abfluss von .env, *.pem, ~/.ssh und ~/.aws/credentials.',
    ruleSecretTitle: 'Schutz gegen Secret-Leaks',
    ruleSecretDesc: 'Prüft Dateiänderungen auf API-Schlüssel, JWTs und private Schlüssel.',
    ruleDestructiveTitle: 'Schutz vor destruktiven Befehlen',
    ruleDestructiveDesc: 'Blockiert rm -rf /, git push --force, git reset --hard und DROP TABLE.',
    rulePipeTitle: 'Gate für Remote-Pipe-Skripte',
    rulePipeDesc: 'Fragt nach oder blockiert curl/wget direkt an sh/bash.',
    autoSnapshotDesc: 'Automatische SHA-256-deduplizierte Sicherung vor jeder Änderung ohne Git-Verlauf zu belasten.',
    customPathsTitle: 'Eigene geschützte Pfade (einer pro Zeile)',
    customCmdsTitle: 'Eigene blockierte Befehle (einer pro Zeile)',
    simDotenv: '.env-Zugriff testen',
    simSecretWrite: 'API-Key-Schreiben testen',
    simForcePush: 'git push --force testen',
    simRmRf: 'rm -rf / testen',
    simCurlPipe: 'curl | sh testen',
    scanSummary: '{scanned} Dateien geprüft ({skipped} übersprungen) um {time} — Treffer:',
    maskedLabel: 'maskiert',
    toastLoadFailed: 'Guard-Status konnte nicht geladen werden: {error}',
    toastRestored: 'Snapshot wiederhergestellt',
    toastTurnRewound: 'Turn zurückgesetzt: {restored} wiederhergestellt, {deleted} neue Datei(en) entfernt',
    toastRestoreFailed: 'Wiederherstellung fehlgeschlagen: {error}',
    toastTurnDiffFailed: 'Turn-Diff konnte nicht geladen werden: {error}',
    toastOpenedFile: '{file} geöffnet',
    toastOpenFileHint: 'Dateipfad: {file}',
    toastPolicySaved: 'Guard-Richtlinie gespeichert',
    toastPolicyFailed: 'Richtlinie konnte nicht gespeichert werden: {error}',
    toastSimDone: 'Simulation ausgewertet',
    toastSimFailed: 'Simulation fehlgeschlagen: {error}',
    toastScanClean: 'Workspace sauber: 0 hartcodierte Secrets',
    toastScanFound: '{count} potenzielle(s) Secret(s) gefunden',
    toastScanDone: 'Workspace-Secret-Scan abgeschlossen',
    toastScanFailed: 'Workspace-Scan fehlgeschlagen: {error}',
  },
};

const VALID_TABS = new Set<GuardTabKey>(['snapshots', 'audit', 'policy', 'scanner']);

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatTurnLabel(turn: TurnCheckpointSummary): string {
  if (turn.conversationId) return turn.conversationId;
  return turn.turnKey.replace(/^(turn:|legacy:|checkpoint:)/, '');
}

function isGuardStateLike(val: unknown): val is GuardDashboardState {
  return Boolean(
    val &&
      typeof val === 'object' &&
      'policy' in val &&
      'stats' in val &&
      Array.isArray((val as GuardDashboardState).snapshots) &&
      Array.isArray((val as GuardDashboardState).auditLog),
  );
}

function unwrapGuardState(raw: unknown): GuardDashboardState | null {
  if (isGuardStateLike(raw)) return raw;
  if (raw && typeof raw === 'object' && 'state' in raw) {
    const inner = (raw as { state?: unknown }).state;
    if (isGuardStateLike(inner)) return inner;
  }
  return null;
}

function unwrapSnapshotDiff(raw: unknown): SnapshotDiff | null {
  if (raw && typeof raw === 'object') {
    if ('hunks' in raw && Array.isArray((raw as SnapshotDiff).hunks)) {
      return raw as SnapshotDiff;
    }
    if ('diff' in raw) {
      const inner = (raw as { diff?: unknown }).diff;
      if (inner && typeof inner === 'object' && 'hunks' in inner && Array.isArray((inner as SnapshotDiff).hunks)) {
        return inner as SnapshotDiff;
      }
    }
  }
  return null;
}

function unwrapTurnDiff(raw: unknown): TurnCheckpointDiff | null {
  if (raw && typeof raw === 'object') {
    if ('turnKey' in raw && 'files' in raw && Array.isArray((raw as TurnCheckpointDiff).files)) {
      return raw as TurnCheckpointDiff;
    }
    if ('diff' in raw) {
      const inner = (raw as { diff?: unknown }).diff;
      if (inner && typeof inner === 'object' && 'turnKey' in inner && Array.isArray((inner as TurnCheckpointDiff).files)) {
        return inner as TurnCheckpointDiff;
      }
    }
  }
  return null;
}

export const GuardPanel: React.FC<NovModulePanelProps> = ({
  bridge,
  active,
  onNotify,
  incomingEvent,
  onOpenSettings,
}) => {
  const { locale, dict } = useNovI18n();
  const g = dict.panels.guard;
  const copy = GUARD_LOCAL_I18N[locale] ?? GUARD_LOCAL_I18N.en;

  const loadedOnceRef = useRef(false);
  const lastEventRef = useRef<typeof incomingEvent>(null);
  const toastTimerRef = useRef<number | null>(null);

  const [theme, setTheme] = useState<'dark' | 'light'>(() => bridge.getTheme());
  const [state, setState] = useState<GuardDashboardState | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<GuardTabKey>('snapshots');
  const [snapshotsView, setSnapshotsView] = useState<GuardSnapshotsViewMode>('turn');

  // By-file view state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [diff, setDiff] = useState<SnapshotDiff | null>(null);
  const [diffNonce, setDiffNonce] = useState(0);

  // By-turn timeline state
  const [selectedTurnKey, setSelectedTurnKey] = useState<string | null>(null);
  const [turnDiff, setTurnDiff] = useState<TurnCheckpointDiff | null>(null);
  const [turnDiffLoading, setTurnDiffLoading] = useState(false);
  const [collapsedFiles, setCollapsedFiles] = useState<Record<string, boolean>>({});
  const [confirmRewindTurnKey, setConfirmRewindTurnKey] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [localToast, setLocalToast] = useState<string | null>(null);
  const [customPathsText, setCustomPathsText] = useState('');
  const [customCmdsText, setCustomCmdsText] = useState('');

  const notify = useCallback(
    (msg: string) => {
      if (onNotify) {
        onNotify(msg);
        return;
      }
      setLocalToast(msg);
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
      toastTimerRef.current = window.setTimeout(() => {
        setLocalToast((cur) => (cur === msg ? null : cur));
      }, 3200);
    },
    [onNotify],
  );

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  // Follow NovBridge dark/light theme changes
  useEffect(() => {
    let mounted = true;
    const unsub = bridge.onThemeChange((nextTheme) => {
      if (mounted) setTheme(nextTheme);
    });
    void bridge.ready().then(() => {
      if (mounted) setTheme(bridge.getTheme());
    });
    return () => {
      mounted = false;
      unsub();
    };
  }, [bridge]);

  const applyDashboardState = useCallback((next: GuardDashboardState) => {
    setState(next);
    setCustomPathsText((next.policy.customProtectedPaths ?? []).join('\n'));
    setCustomCmdsText((next.policy.customBlockedCommands ?? []).join('\n'));
    setSelectedId((cur) => {
      if (cur && next.snapshots.some((s) => s.id === cur)) return cur;
      return next.snapshots[0]?.id ?? null;
    });
    const nextTurns = next.turns ?? [];
    setSelectedTurnKey((cur) => {
      if (cur && nextTurns.some((t) => t.turnKey === cur)) return cur;
      return nextTurns[0]?.turnKey ?? null;
    });
  }, []);

  const loadState = useCallback(
    async (alsoRefreshDiff = false) => {
      loadedOnceRef.current = true;
      setLoading(true);
      setLoadError(null);
      try {
        const raw = await bridge.callTool<Record<string, unknown>>('app_guard_get_state', {});
        const next = unwrapGuardState(raw);
        if (!next) {
          throw new Error('Unexpected response format from app_guard_get_state');
        }
        applyDashboardState(next);
        if (alsoRefreshDiff) {
          setDiffNonce((n) => n + 1);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setLoadError(msg);
        notify(formatMessage(copy.toastLoadFailed, { error: msg }));
      } finally {
        setLoading(false);
      }
    },
    [bridge, applyDashboardState, notify, copy.toastLoadFailed],
  );

  // Fetch initial state once on first activation (no reconnect loop)
  useEffect(() => {
    if (active && !loadedOnceRef.current) {
      void loadState(false);
    }
  }, [active, loadState]);

  // React to incoming tool results targeting Guard
  useEffect(() => {
    if (!incomingEvent || incomingEvent === lastEventRef.current) return;
    const sc = incomingEvent.structuredContent;
    if (!sc || typeof sc !== 'object') return;

    const toolName = incomingEvent.toolName ?? '';
    const isGuardEvent =
      toolName.includes('guard') ||
      'policy' in sc ||
      (typeof sc.tab === 'string' && VALID_TABS.has(sc.tab as GuardTabKey));

    if (!isGuardEvent) return;
    lastEventRef.current = incomingEvent;

    if (typeof sc.tab === 'string' && VALID_TABS.has(sc.tab as GuardTabKey)) {
      setTab(sc.tab as GuardTabKey);
    }

    const hydrated = unwrapGuardState(sc);
    if (hydrated) {
      loadedOnceRef.current = true;
      applyDashboardState(hydrated);
      setDiffNonce((n) => n + 1);
    } else if (active) {
      void loadState(true);
    }
  }, [incomingEvent, active, applyDashboardState, loadState]);

  const turns = useMemo<TurnCheckpointSummary[]>(() => state?.turns ?? [], [state?.turns]);
  const hasSnapshots = (state?.snapshots.length ?? 0) > 0;
  const hasTurns = turns.length > 0;

  // Fetch single-file diff when selected snapshot changes
  useEffect(() => {
    if (!selectedId || !hasSnapshots || snapshotsView !== 'file') {
      if (!hasSnapshots) setDiff(null);
      return;
    }
    let cancelled = false;
    bridge
      .callTool<Record<string, unknown>>('app_guard_diff_snapshot', { snapshotId: selectedId })
      .then((raw) => {
        if (!cancelled) {
          setDiff(unwrapSnapshotDiff(raw));
        }
      })
      .catch(() => {
        if (!cancelled) setDiff(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, hasSnapshots, snapshotsView, diffNonce, bridge]);

  const fetchTurnDiff = useCallback(
    async (turnKey: string) => {
      setTurnDiffLoading(true);
      try {
        const raw = await bridge.callTool<Record<string, unknown>>('app_guard_get_turn_diff', {
          turnKey,
        });
        const parsed = unwrapTurnDiff(raw);
        setTurnDiff(parsed);
        setCollapsedFiles({});
      } catch (err) {
        setTurnDiff(null);
        notify(
          formatMessage(copy.toastTurnDiffFailed, {
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      } finally {
        setTurnDiffLoading(false);
      }
    },
    [bridge, notify, copy.toastTurnDiffFailed],
  );

  // Fetch turn diff when selected turn changes in turn view
  useEffect(() => {
    if (!selectedTurnKey || !hasTurns || snapshotsView !== 'turn') {
      if (!hasTurns) setTurnDiff(null);
      return;
    }
    let cancelled = false;
    setTurnDiffLoading(true);
    bridge
      .callTool<Record<string, unknown>>('app_guard_get_turn_diff', { turnKey: selectedTurnKey })
      .then((raw) => {
        if (!cancelled) {
          setTurnDiff(unwrapTurnDiff(raw));
          setCollapsedFiles({});
        }
      })
      .catch(() => {
        if (!cancelled) setTurnDiff(null);
      })
      .finally(() => {
        if (!cancelled) setTurnDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTurnKey, hasTurns, snapshotsView, diffNonce, bridge]);

  // Reset inline confirm whenever switching turn or tab
  useEffect(() => {
    setConfirmRewindTurnKey(null);
  }, [selectedTurnKey, tab, snapshotsView]);

  const handleRestore = async (snapshotId: string) => {
    setBusy(true);
    try {
      const res = await bridge.callTool<{
        result?: { message?: string };
        state?: GuardDashboardState;
      }>('app_guard_restore_snapshot', { snapshotId });

      const nextState = unwrapGuardState(res);
      if (nextState) {
        applyDashboardState(nextState);
      } else {
        await loadState(false);
      }
      notify(res.result?.message ?? copy.toastRestored);
      setDiffNonce((n) => n + 1);
    } catch (err) {
      notify(
        formatMessage(copy.toastRestoreFailed, {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreTurn = async (turnKey: string) => {
    setBusy(true);
    setConfirmRewindTurnKey(null);
    try {
      const res = await bridge.callTool<{
        result?: TurnRestoreResult;
        state?: GuardDashboardState;
      }>('app_guard_restore_turn', { turnKey });

      const nextState = unwrapGuardState(res);
      if (nextState) {
        applyDashboardState(nextState);
      } else {
        await loadState(false);
      }
      if (res.result) {
        notify(
          formatMessage(copy.toastTurnRewound, {
            restored: res.result.restoredFiles.length,
            deleted: res.result.deletedNewFiles.length,
          }),
        );
      } else {
        notify(copy.toastRestored);
      }
      setDiffNonce((n) => n + 1);
    } catch (err) {
      notify(
        formatMessage(copy.toastRestoreFailed, {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleOpenFile = async (filePath: string) => {
    const ok = await bridge.openFile(filePath);
    if (ok) {
      notify(formatMessage(copy.toastOpenedFile, { file: filePath.split('/').pop() || filePath }));
    } else {
      notify(formatMessage(copy.toastOpenFileHint, { file: filePath }));
    }
  };

  const handleUpdatePolicy = async (patch: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await bridge.callTool<{ state?: GuardDashboardState }>(
        'app_guard_update_policy',
        patch,
      );
      const nextState = unwrapGuardState(res);
      if (nextState) {
        applyDashboardState(nextState);
      } else {
        await loadState(false);
      }
      notify(copy.toastPolicySaved);
    } catch (err) {
      notify(
        formatMessage(copy.toastPolicyFailed, {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSimulate = async (scenario: ThreatScenario) => {
    setBusy(true);
    try {
      const res = await bridge.callTool<{
        evaluation?: { decision: string; reason: string };
        state?: GuardDashboardState;
      }>('app_guard_simulate_threat', { scenario });

      const nextState = unwrapGuardState(res);
      if (nextState) {
        applyDashboardState(nextState);
      } else {
        await loadState(false);
      }
      if (res.evaluation) {
        notify(`[${res.evaluation.decision.toUpperCase()}] ${res.evaluation.reason}`);
      } else {
        notify(copy.toastSimDone);
      }
    } catch (err) {
      notify(
        formatMessage(copy.toastSimFailed, {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleScanWorkspace = async () => {
    setBusy(true);
    try {
      const res = await bridge.callTool<{ state?: GuardDashboardState }>(
        'app_guard_scan_workspace',
        {},
      );
      const nextState = unwrapGuardState(res);
      if (nextState) {
        applyDashboardState(nextState);
        const count = nextState.lastScan?.findings.length ?? 0;
        notify(count === 0 ? copy.toastScanClean : formatMessage(copy.toastScanFound, { count }));
      } else {
        await loadState(false);
        notify(copy.toastScanDone);
      }
    } catch (err) {
      notify(
        formatMessage(copy.toastScanFailed, {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  if (!state) {
    return (
      <div className="mod-guard" data-theme={theme}>
        <div className="gd-loading-shell">
          {loadError ? (
            <div className="gd-error-box">
              <div className="gd-error-title">{g.title}</div>
              <div className="gd-muted">{loadError}</div>
              <button type="button" className="gd-btn gd-btn-primary" onClick={() => void loadState(true)}>
                {dict.retry}
              </button>
            </div>
          ) : (
            <div className="gd-muted">{dict.common.loading}</div>
          )}
        </div>
      </div>
    );
  }

  const activePermissionMode: GuardPermissionMode = state.policy.permissionMode ?? 'balanced-dev';
  const modePillClass =
    activePermissionMode === 'readonly-audit'
      ? 'gd-pill-danger'
      : activePermissionMode === 'strict-gate'
        ? 'gd-pill-warn'
        : 'gd-pill-success';
  const modePillLabel =
    activePermissionMode === 'readonly-audit'
      ? copy.modeReadOnlyTitle
      : activePermissionMode === 'strict-gate'
        ? copy.modeStrictTitle
        : copy.modeBalancedTitle;

  const selectedSnap = state.snapshots.find((s) => s.id === selectedId) ?? state.snapshots[0] ?? null;
  const selectedTurn = turns.find((t) => t.turnKey === selectedTurnKey) ?? turns[0] ?? null;

  const permissionModes: Array<{
    id: GuardPermissionMode;
    title: string;
    badge: string;
    desc: string;
    toneVar: string;
    softVar: string;
  }> = [
    {
      id: 'readonly-audit',
      title: copy.modeReadOnlyTitle,
      badge: copy.modeReadOnlyBadge,
      desc: copy.modeReadOnlyDesc,
      toneVar: 'var(--nov-danger)',
      softVar: 'var(--nov-danger-soft)',
    },
    {
      id: 'balanced-dev',
      title: copy.modeBalancedTitle,
      badge: copy.modeBalancedBadge,
      desc: copy.modeBalancedDesc,
      toneVar: 'var(--nov-success)',
      softVar: 'var(--nov-success-soft)',
    },
    {
      id: 'strict-gate',
      title: copy.modeStrictTitle,
      badge: copy.modeStrictBadge,
      desc: copy.modeStrictDesc,
      toneVar: 'var(--nov-warn)',
      softVar: 'var(--nov-warn-soft)',
    },
  ];

  return (
    <div className="mod-guard" data-theme={theme}>
      <header className="gd-topbar">
        <div className="gd-brand">
          <div className="gd-shield-badge">G</div>
          <div className="gd-brand-text">
            <div className="gd-brand-title">{g.title}</div>
            <div className="gd-brand-sub">{dict.modules.guard.tagline}</div>
          </div>
        </div>
        <div className="gd-topbar-right">
          <span className={`gd-pill ${state.policy.enabled ? 'gd-pill-success' : 'gd-pill-danger'}`}>
            {state.policy.enabled ? `● ${dict.statusActive}` : `○ ${dict.common.disabled}`}
          </span>
          <button
            type="button"
            className={`gd-pill ${modePillClass}`}
            style={{ cursor: 'pointer' }}
            onClick={() => setTab('policy')}
          >
            {modePillLabel}
          </button>
          <span className="gd-pill gd-pill-accent">
            {state.mode === 'demo' ? dict.demoFixture : dict.badgeOffline}
          </span>
          {onOpenSettings && (
            <button
              type="button"
              className="gd-btn"
              onClick={() => onOpenSettings('guard')}
              title={dict.nav.openSettingsTip}
            >
              ⚙ {dict.nav.settingsLabel}
            </button>
          )}
          <button
            type="button"
            className="gd-btn"
            disabled={loading || busy}
            onClick={() => void loadState(true)}
          >
            {loading ? dict.common.loading : dict.common.refresh}
          </button>
        </div>
      </header>

      <section className="gd-stats-strip">
        <div className="gd-stat-card">
          <div className="gd-stat-label">{g.tabSnapshots}</div>
          <div className="gd-stat-val gd-val-success">{state.stats.totalSnapshots}</div>
        </div>
        <div className="gd-stat-card">
          <div className="gd-stat-label">{g.blocked}</div>
          <div className="gd-stat-val gd-val-danger">{state.stats.blockedCount}</div>
        </div>
        <div className="gd-stat-card">
          <div className="gd-stat-label">{g.tabScanner}</div>
          <div className="gd-stat-val gd-val-warn">{state.stats.secretCatches}</div>
        </div>
        <div className="gd-stat-card">
          <div className="gd-stat-label">{g.restore}</div>
          <div className="gd-stat-val gd-val-accent">{state.stats.restoredCount}</div>
        </div>
      </section>

      <nav className="gd-tabs" role="tablist" aria-label={g.title}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'snapshots'}
          className={`gd-tab-btn ${tab === 'snapshots' ? 'is-active' : ''}`}
          onClick={() => setTab('snapshots')}
        >
          {g.tabSnapshots} ({state.snapshots.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'audit'}
          className={`gd-tab-btn ${tab === 'audit' ? 'is-active' : ''}`}
          onClick={() => setTab('audit')}
        >
          {g.tabAudit} ({state.auditLog.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'policy'}
          className={`gd-tab-btn ${tab === 'policy' ? 'is-active' : ''}`}
          onClick={() => setTab('policy')}
        >
          {g.tabPolicy}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'scanner'}
          className={`gd-tab-btn ${tab === 'scanner' ? 'is-active' : ''}`}
          onClick={() => setTab('scanner')}
        >
          {g.tabScanner}
        </button>
      </nav>

      <main className="gd-main-area">
        {tab === 'snapshots' && (
          <div className="gd-stack">
            {/* View toggle pill bar: By Turn Timeline / By File List */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              <div
                role="tablist"
                aria-label={g.tabSnapshots}
                style={{
                  display: 'inline-flex',
                  padding: 3,
                  borderRadius: 999,
                  background: 'var(--nov-bg-1)',
                  border: '1px solid var(--nov-border)',
                  gap: 3,
                }}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={snapshotsView === 'turn'}
                  onClick={() => setSnapshotsView('turn')}
                  style={{
                    border: 0,
                    borderRadius: 999,
                    padding: '4px 12px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: snapshotsView === 'turn' ? 'var(--nov-success-soft)' : 'transparent',
                    color: snapshotsView === 'turn' ? 'var(--nov-success)' : 'var(--nov-text-1)',
                  }}
                >
                  {copy.viewByTurn} ({turns.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={snapshotsView === 'file'}
                  onClick={() => setSnapshotsView('file')}
                  style={{
                    border: 0,
                    borderRadius: 999,
                    padding: '4px 12px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: snapshotsView === 'file' ? 'var(--nov-success-soft)' : 'transparent',
                    color: snapshotsView === 'file' ? 'var(--nov-success)' : 'var(--nov-text-1)',
                  }}
                >
                  {copy.viewByFile} ({state.snapshots.length})
                </button>
              </div>
              <span className="gd-header-meta">
                {formatMessage(copy.turnFilesCount, { count: state.stats.trackedFiles })}
              </span>
            </div>

            {snapshotsView === 'turn' ? (
              <div className="gd-split-grid">
                <div className="gd-card gd-snap-list-card">
                  <div className="gd-card-header">
                    <span>{copy.turnTimelineHeader}</span>
                    <span className="gd-header-meta">{turns.length}</span>
                  </div>
                  <div className="gd-list-scroll">
                    {turns.length === 0 ? (
                      <div className="gd-empty-box">{copy.noTurns}</div>
                    ) : (
                      turns.map((turn) => {
                        const isSelected = selectedTurn?.turnKey === turn.turnKey;
                        return (
                          <button
                            type="button"
                            key={turn.turnKey}
                            className={`gd-snap-item ${isSelected ? 'is-selected' : ''}`}
                            onClick={() => setSelectedTurnKey(turn.turnKey)}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 6,
                              }}
                            >
                              <span className="gd-mono gd-snap-path">{formatTurnLabel(turn)}</span>
                              <span className="gd-pill gd-pill-accent">
                                {formatMessage(copy.turnFilesCount, { count: turn.fileCount })}
                              </span>
                            </div>
                            <div className="gd-snap-row-meta">
                              <span
                                style={{
                                  display: 'inline-flex',
                                  flexWrap: 'wrap',
                                  gap: 4,
                                }}
                              >
                                {turn.toolNames.map((tn) => (
                                  <span
                                    key={tn}
                                    className="gd-mono"
                                    style={{
                                      padding: '1px 6px',
                                      borderRadius: 5,
                                      background: 'var(--nov-bg-2)',
                                      border: '1px solid var(--nov-border)',
                                      fontSize: 10.5,
                                    }}
                                  >
                                    {tn}
                                  </span>
                                ))}
                              </span>
                              <span>{formatTime(turn.latestAt)}</span>
                            </div>
                            <div
                              style={{
                                marginTop: 6,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 2,
                              }}
                            >
                              {turn.files.slice(0, 4).map((f) => (
                                <div
                                  key={f.snapshotId}
                                  className="gd-mono gd-snap-sub"
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 6,
                                  }}
                                >
                                  <span
                                    style={{
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {f.relPath}
                                  </span>
                                  {!f.existed && (
                                    <span
                                      style={{
                                        fontSize: 10,
                                        color: 'var(--nov-warn)',
                                        flexShrink: 0,
                                      }}
                                    >
                                      {copy.newFileBadge}
                                    </span>
                                  )}
                                </div>
                              ))}
                              {turn.files.length > 4 && (
                                <div className="gd-snap-sub">+{turn.files.length - 4}</div>
                              )}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="gd-card gd-diff-card">
                  <div className="gd-card-header gd-diff-header">
                    <div className="gd-diff-title-group">
                      <span className="gd-mono gd-diff-file">
                        {selectedTurn ? formatTurnLabel(selectedTurn) : copy.turnTimelineHeader}
                      </span>
                      {turnDiff && (
                        <span className="gd-header-meta">
                          {turnDiff.identical
                            ? copy.turnIdentical
                            : `${formatMessage(copy.turnChangedSummary, {
                                changed: turnDiff.changedFiles,
                                total: turnDiff.fileCount,
                              })} · +${turnDiff.totalAdded} / -${turnDiff.totalRemoved}`}
                        </span>
                      )}
                    </div>
                    {selectedTurn && (
                      <div className="gd-diff-actions">
                        <button
                          type="button"
                          className="gd-btn"
                          disabled={busy || turnDiffLoading}
                          onClick={() => void fetchTurnDiff(selectedTurn.turnKey)}
                        >
                          {turnDiff ? copy.refreshTurnDiff : copy.previewTurnDiff}
                        </button>
                        <button
                          type="button"
                          className="gd-btn gd-btn-danger"
                          disabled={busy || turnDiff?.identical}
                          onClick={() => setConfirmRewindTurnKey(selectedTurn.turnKey)}
                        >
                          {turnDiff?.identical ? g.safe : copy.rewindTurn}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Inline two-step confirmation bar (never uses window.confirm) */}
                  {selectedTurn && confirmRewindTurnKey === selectedTurn.turnKey && (
                    <div
                      role="alert"
                      style={{
                        padding: '10px 12px',
                        background: 'var(--nov-danger-soft)',
                        borderBottom: '1px solid var(--nov-danger)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      <div style={{ fontWeight: 700, color: 'var(--nov-danger)', fontSize: 12 }}>
                        {copy.rewindTurnConfirmTitle}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--nov-text-0)' }}>
                        {formatMessage(copy.rewindTurnConfirmDetail, {
                          count: selectedTurn.fileCount,
                        })}
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="gd-btn gd-btn-danger"
                          disabled={busy}
                          onClick={() => void handleRestoreTurn(selectedTurn.turnKey)}
                        >
                          {copy.confirmRewindTurn}
                        </button>
                        <button
                          type="button"
                          className="gd-btn"
                          disabled={busy}
                          onClick={() => setConfirmRewindTurnKey(null)}
                        >
                          {copy.cancel}
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="gd-list-scroll" style={{ background: 'var(--nov-bg-0)' }}>
                    {turnDiffLoading ? (
                      <div className="gd-empty-box">{copy.loadingDiff}</div>
                    ) : !turnDiff ? (
                      <div className="gd-empty-box">{dict.common.empty}</div>
                    ) : (
                      turnDiff.files.map((fileDiff) => {
                        const isCollapsed = Boolean(collapsedFiles[fileDiff.snapshotId]);
                        const entry = selectedTurn?.files.find(
                          (f) => f.snapshotId === fileDiff.snapshotId,
                        );
                        return (
                          <div
                            key={fileDiff.snapshotId}
                            style={{
                              borderBottom: '1px solid var(--nov-border)',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 8,
                                padding: '7px 10px',
                                background: 'var(--nov-bg-1)',
                                borderBottom: isCollapsed ? 0 : '1px solid var(--nov-border)',
                                flexWrap: 'wrap',
                              }}
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  setCollapsedFiles((prev) => ({
                                    ...prev,
                                    [fileDiff.snapshotId]: !prev[fileDiff.snapshotId],
                                  }))
                                }
                                style={{
                                  background: 'transparent',
                                  border: 0,
                                  color: 'var(--nov-text-0)',
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  font: 'inherit',
                                  fontWeight: 600,
                                  padding: 0,
                                  minWidth: 0,
                                }}
                                aria-expanded={!isCollapsed}
                              >
                                <span style={{ color: 'var(--nov-text-2)', width: 12 }}>
                                  {isCollapsed ? '▸' : '▾'}
                                </span>
                                <span className="gd-mono" style={{ wordBreak: 'break-all' }}>
                                  {fileDiff.relPath}
                                </span>
                              </button>
                              <div
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  flexWrap: 'wrap',
                                }}
                              >
                                {entry && !entry.existed && (
                                  <span
                                    className={`gd-pill ${
                                      fileDiff.currentExists ? 'gd-pill-warn' : 'gd-pill-success'
                                    }`}
                                  >
                                    {fileDiff.currentExists
                                      ? copy.newFileBadge
                                      : copy.deletedFileBadge}
                                  </span>
                                )}
                                <span className="gd-header-meta gd-mono">
                                  {fileDiff.identical
                                    ? g.safe
                                    : `+${fileDiff.added} / -${fileDiff.removed}`}
                                </span>
                                <button
                                  type="button"
                                  className="gd-btn"
                                  style={{ padding: '2px 7px', fontSize: 11 }}
                                  onClick={() => void handleOpenFile(fileDiff.filePath)}
                                >
                                  {dict.panels.canvas.openFile}
                                </button>
                                <button
                                  type="button"
                                  className="gd-btn"
                                  style={{ padding: '2px 7px', fontSize: 11 }}
                                  onClick={() =>
                                    setCollapsedFiles((prev) => ({
                                      ...prev,
                                      [fileDiff.snapshotId]: !prev[fileDiff.snapshotId],
                                    }))
                                  }
                                >
                                  {isCollapsed ? copy.expandFile : copy.collapseFile}
                                </button>
                              </div>
                            </div>

                            {!isCollapsed && (
                              <div className="gd-diff-box" style={{ minHeight: 'auto' }}>
                                {fileDiff.hunks.length === 0 ? (
                                  <div className="gd-empty-box">{copy.turnIdentical}</div>
                                ) : (
                                  fileDiff.hunks.map((line, idx) => (
                                    <div key={idx} className={`gd-diff-line gd-diff-${line.type}`}>
                                      <span className="gd-diff-ln">{line.oldLine ?? ''}</span>
                                      <span className="gd-diff-ln">{line.newLine ?? ''}</span>
                                      <span className="gd-diff-sign">
                                        {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                                      </span>
                                      <span className="gd-diff-text">{line.text}</span>
                                    </div>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="gd-split-grid">
                <div className="gd-card gd-snap-list-card">
                  <div className="gd-card-header">
                    <span>{g.createCheckpoint}</span>
                    <span className="gd-header-meta">{state.stats.trackedFiles}</span>
                  </div>
                  <div className="gd-list-scroll">
                    {state.snapshots.length === 0 ? (
                      <div className="gd-empty-box">{g.noSnapshots}</div>
                    ) : (
                      state.snapshots.map((snap) => (
                        <button
                          type="button"
                          key={snap.id}
                          className={`gd-snap-item ${selectedSnap?.id === snap.id ? 'is-selected' : ''}`}
                          onClick={() => setSelectedId(snap.id)}
                        >
                          <div className="gd-mono gd-snap-path">{snap.relPath}</div>
                          <div className="gd-snap-row-meta">
                            <span>{snap.toolName}</span>
                            <span>{formatTime(snap.createdAt)}</span>
                          </div>
                          <div className="gd-snap-sub">
                            {snap.existed
                              ? formatMessage(copy.linesBytesMeta, {
                                  lines: snap.lineCount,
                                  bytes: snap.sizeBytes,
                                })
                              : copy.newFileBadge}
                            {snap.turnKey ? ` · ${snap.turnKey}` : ''}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>

                <div className="gd-card gd-diff-card">
                  <div className="gd-card-header gd-diff-header">
                    <div className="gd-diff-title-group">
                      <span className="gd-mono gd-diff-file">
                        {selectedSnap ? selectedSnap.relPath : g.tabSnapshots}
                      </span>
                      {diff && (
                        <span className="gd-header-meta">
                          {diff.identical ? g.safe : `+${diff.added} / -${diff.removed}`}
                        </span>
                      )}
                    </div>
                    {selectedSnap && (
                      <div className="gd-diff-actions">
                        <button
                          type="button"
                          className="gd-btn"
                          onClick={() => void handleOpenFile(selectedSnap.filePath)}
                        >
                          {dict.panels.canvas.openFile}
                        </button>
                        <button
                          type="button"
                          className="gd-btn gd-btn-primary"
                          disabled={busy || diff?.identical}
                          onClick={() => void handleRestore(selectedSnap.id)}
                        >
                          {diff?.identical ? g.safe : g.restore}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="gd-diff-box">
                    {!diff ? (
                      <div className="gd-empty-box">{dict.common.empty}</div>
                    ) : (
                      diff.hunks.map((line, idx) => (
                        <div key={idx} className={`gd-diff-line gd-diff-${line.type}`}>
                          <span className="gd-diff-ln">{line.oldLine ?? ''}</span>
                          <span className="gd-diff-ln">{line.newLine ?? ''}</span>
                          <span className="gd-diff-sign">
                            {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                          </span>
                          <span className="gd-diff-text">{line.text}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'audit' && (
          <div className="gd-stack">
            <div className="gd-sim-bar">
              <strong className="gd-sim-title">{g.tabAudit}:</strong>
              <button
                type="button"
                className="gd-btn gd-btn-danger"
                disabled={busy}
                onClick={() => void handleSimulate('dotenv_read')}
              >
                {copy.simDotenv}
              </button>
              <button
                type="button"
                className="gd-btn gd-btn-danger"
                disabled={busy}
                onClick={() => void handleSimulate('secret_write')}
              >
                {copy.simSecretWrite}
              </button>
              <button
                type="button"
                className="gd-btn gd-btn-danger"
                disabled={busy}
                onClick={() => void handleSimulate('force_push')}
              >
                {copy.simForcePush}
              </button>
              <button
                type="button"
                className="gd-btn gd-btn-danger"
                disabled={busy}
                onClick={() => void handleSimulate('rm_rf')}
              >
                {copy.simRmRf}
              </button>
              <button
                type="button"
                className="gd-btn"
                disabled={busy}
                onClick={() => void handleSimulate('curl_pipe')}
              >
                {copy.simCurlPipe}
              </button>
            </div>

            <div className="gd-card">
              <div className="gd-card-header">
                <span>{g.tabAudit}</span>
                <span className="gd-header-meta">{state.auditLog.length}</span>
              </div>
              <div className="gd-audit-list">
                {state.auditLog.length === 0 ? (
                  <div className="gd-empty-box">{dict.common.empty}</div>
                ) : (
                  state.auditLog.map((evt) => {
                    const pillClass =
                      evt.decision === 'deny'
                        ? 'gd-pill-danger'
                        : evt.decision === 'ask' || evt.decision === 'force_ask'
                          ? 'gd-pill-warn'
                          : evt.decision === 'restored'
                            ? 'gd-pill-accent'
                            : 'gd-pill-success';
                    const decisionLabel =
                      evt.decision === 'deny'
                        ? g.blocked
                        : evt.decision === 'force_ask'
                          ? copy.forceAskLabel
                          : evt.decision === 'ask'
                            ? g.ask
                            : evt.decision === 'restored'
                              ? g.restore
                              : evt.decision === 'allow'
                                ? g.safe
                                : evt.decision.toUpperCase();
                    return (
                      <div key={evt.id} className="gd-audit-row">
                        <span className={`gd-pill gd-pill-center ${pillClass}`}>
                          {decisionLabel}
                        </span>
                        <span className="gd-mono gd-audit-tool">{evt.toolName}</span>
                        <div className="gd-audit-body">
                          <div className="gd-audit-summary">{evt.summary}</div>
                          <div className="gd-mono gd-audit-target">
                            {evt.target} {evt.ruleId ? `· ${evt.ruleId}` : ''}
                          </div>
                        </div>
                        <span className="gd-audit-time">{formatTime(evt.timestamp)}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {tab === 'policy' && (
          <div className="gd-policy-grid">
            {/* 3-Tier Protocol Permission Mode Selector */}
            <div
              className="gd-policy-card"
              style={{
                gridColumn: '1 / -1',
                gap: 10,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 6,
                }}
              >
                <div className="gd-policy-title">{copy.modeSectionTitle}</div>
                <span className={`gd-pill ${modePillClass}`}>{modePillLabel}</span>
              </div>
              <div className="gd-policy-desc">{copy.modeSectionSubtitle}</div>
              <div
                role="radiogroup"
                aria-label={copy.modeSectionTitle}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: 8,
                }}
              >
                {permissionModes.map((mode) => {
                  const selected = activePermissionMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={busy}
                      onClick={() => void handleUpdatePolicy({ permissionMode: mode.id })}
                      style={{
                        textAlign: 'left',
                        cursor: busy ? 'not-allowed' : 'pointer',
                        padding: '10px 11px',
                        borderRadius: 'var(--nov-radius)',
                        border: selected
                          ? `1.5px solid ${mode.toneVar}`
                          : '1px solid var(--nov-border)',
                        background: selected ? mode.softVar : 'var(--nov-bg-0)',
                        color: 'var(--nov-text-0)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        font: 'inherit',
                        opacity: busy ? 0.65 : 1,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 6,
                        }}
                      >
                        <strong style={{ fontSize: 12.5 }}>{mode.title}</strong>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '2px 7px',
                            borderRadius: 999,
                            color: selected ? mode.toneVar : 'var(--nov-text-1)',
                            background: selected ? 'var(--nov-bg-1)' : 'var(--nov-bg-2)',
                            border: `1px solid ${selected ? mode.toneVar : 'var(--nov-border)'}`,
                          }}
                        >
                          {selected ? `● ${copy.modeActiveBadge}` : mode.badge}
                        </span>
                      </div>
                      <div className="gd-policy-desc" style={{ lineHeight: 1.4 }}>
                        {mode.desc}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="gd-policy-card">
              <div className="gd-policy-title">{g.rules}</div>
              <div className="gd-policy-desc">{dict.modules.guard.description}</div>
              <button
                type="button"
                className={`gd-btn ${state.policy.enabled ? 'gd-btn-primary' : ''}`}
                disabled={busy}
                onClick={() => void handleUpdatePolicy({ enabled: !state.policy.enabled })}
              >
                {state.policy.enabled ? `● ${dict.common.enabled}` : `○ ${dict.common.disabled}`}
              </button>
            </div>

            {(
              [
                ['protectEnvAndKeys', copy.ruleEnvTitle, copy.ruleEnvDesc],
                ['blockSecretWrites', copy.ruleSecretTitle, copy.ruleSecretDesc],
                ['blockDestructiveCommands', copy.ruleDestructiveTitle, copy.ruleDestructiveDesc],
                ['askOnNetworkPipes', copy.rulePipeTitle, copy.rulePipeDesc],
              ] as const
            ).map(([field, title, desc]) => (
              <div className="gd-policy-card" key={field}>
                <div className="gd-policy-title">{title}</div>
                <div className="gd-policy-desc">{desc}</div>
                <select
                  className="gd-select-input"
                  value={state.policy[field]}
                  disabled={busy}
                  aria-label={title}
                  onChange={(e) =>
                    void handleUpdatePolicy({ [field]: e.target.value as GuardDecision })
                  }
                >
                  <option value="deny">
                    {formatMessage(copy.decisionDenyOpt, { label: g.blocked })}
                  </option>
                  <option value="force_ask">
                    {formatMessage(copy.decisionForceAskOpt, { label: copy.forceAskLabel })}
                  </option>
                  <option value="ask">
                    {formatMessage(copy.decisionAskOpt, { label: g.ask })}
                  </option>
                  <option value="allow">
                    {formatMessage(copy.decisionAllowOpt, { label: g.safe })}
                  </option>
                </select>
              </div>
            ))}

            <div className="gd-policy-card">
              <div className="gd-policy-title">{g.createCheckpoint}</div>
              <div className="gd-policy-desc">{copy.autoSnapshotDesc}</div>
              <button
                type="button"
                className={`gd-btn ${state.policy.autoSnapshotBeforeEdit ? 'gd-btn-primary' : ''}`}
                disabled={busy}
                onClick={() =>
                  void handleUpdatePolicy({
                    autoSnapshotBeforeEdit: !state.policy.autoSnapshotBeforeEdit,
                  })
                }
              >
                {state.policy.autoSnapshotBeforeEdit
                  ? `${g.tabSnapshots}: ${dict.common.enabled}`
                  : `${g.tabSnapshots}: ${dict.common.disabled}`}
              </button>
            </div>

            <div className="gd-policy-card">
              <div className="gd-policy-title">{copy.customPathsTitle}</div>
              <textarea
                className="gd-text-input gd-mono"
                rows={3}
                value={customPathsText}
                placeholder={'prod-config/\nbilling-keys.json'}
                onChange={(e) => setCustomPathsText(e.target.value)}
              />
              <button
                type="button"
                className="gd-btn"
                disabled={busy}
                onClick={() =>
                  void handleUpdatePolicy({
                    customProtectedPaths: customPathsText
                      .split('\n')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              >
                {dict.common.save} ({g.rules})
              </button>
            </div>

            <div className="gd-policy-card">
              <div className="gd-policy-title">{copy.customCmdsTitle}</div>
              <textarea
                className="gd-text-input gd-mono"
                rows={3}
                value={customCmdsText}
                placeholder={'terraform destroy\nkubectl delete namespace'}
                onChange={(e) => setCustomCmdsText(e.target.value)}
              />
              <button
                type="button"
                className="gd-btn"
                disabled={busy}
                onClick={() =>
                  void handleUpdatePolicy({
                    customBlockedCommands: customCmdsText
                      .split('\n')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              >
                {dict.common.save} ({g.rules})
              </button>
            </div>
          </div>
        )}

        {tab === 'scanner' && (
          <div className="gd-card">
            <div className="gd-card-header">
              <span>{g.tabScanner}</span>
              <button
                type="button"
                className="gd-btn gd-btn-primary"
                disabled={busy}
                onClick={() => void handleScanWorkspace()}
              >
                {busy ? dict.common.loading : g.scanWorkspace}
              </button>
            </div>
            <div className="gd-scanner-body">
              {!state.lastScan ? (
                <div className="gd-muted">
                  <strong>{g.scanWorkspace}</strong> — {dict.modules.guard.tagline}
                </div>
              ) : (
                <div>
                  <div className="gd-scan-summary">
                    {formatMessage(copy.scanSummary, {
                      scanned: state.lastScan.scannedFiles,
                      skipped: state.lastScan.skippedFiles,
                      time: formatTime(state.lastScan.scannedAt),
                    })}{' '}
                    <strong
                      className={
                        state.lastScan.findings.length === 0 ? 'gd-val-success' : 'gd-val-danger'
                      }
                    >
                      {state.lastScan.findings.length}
                    </strong>
                  </div>
                  {state.lastScan.findings.length === 0 ? (
                    <div className="gd-pill gd-pill-success">{g.safe}</div>
                  ) : (
                    state.lastScan.findings.map((item, i) => (
                      <div key={`${item.relPath}-${item.finding.line}-${i}`} className="gd-audit-row">
                        <span
                          className={`gd-pill gd-pill-center ${
                            item.finding.severity === 'critical' ? 'gd-pill-danger' : 'gd-pill-warn'
                          }`}
                        >
                          {item.finding.severity.toUpperCase()}
                        </span>
                        <span className="gd-mono gd-audit-tool">
                          {item.relPath}:{item.finding.line}
                        </span>
                        <div className="gd-audit-body">
                          <strong>{item.finding.label}</strong> · {copy.maskedLabel}:{' '}
                          <code className="gd-mono">{item.finding.preview}</code>
                        </div>
                        <button
                          type="button"
                          className="gd-btn"
                          onClick={() => void handleOpenFile(item.filePath)}
                        >
                          {dict.panels.canvas.openFile}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {localToast && <div className="gd-toast">{localToast}</div>}
    </div>
  );
};
