import React, { useCallback, useEffect, useState } from 'react';
import type { NovBridge } from '../../bridge.js';
import { useNovI18n, type ResolvedUiLocale } from '../../i18n/index.js';

export interface NovModulePanelProps {
  bridge: NovBridge;
  active: boolean;
  onNotify?: (message: string) => void;
  incomingEvent?: { toolName?: string; structuredContent: Record<string, unknown> } | null;
  onOpenSettings?: (moduleId: 'turbo') => void;
}

type CompactPresetOption = 'auto' | 'test' | 'build' | 'git' | 'generic';
type TurboTabId = 'search' | 'outline' | 'compact' | 'pack';
type SearchSubMode = 'text' | 'references';
type OutlineSubMode = 'outline' | 'dep';

interface TurboV08Labels {
  tabSearchRefs: string;
  tabOutlineDep: string;
  tabCompactAuto: string;
  tabContextPack: string;
  modeBatchSearch: string;
  modeSymbolRefs: string;
  modeFileOutline: string;
  modeDepContract: string;
  settingsBtn: string;
  symbolInputLabel: string;
  symbolInputPlaceholder: string;
  scopeOptionalLabel: string;
  scopeOptionalPlaceholder: string;
  findRefsBtn: string;
  refsSummary: string;
  refsDefinitions: string;
  refsImports: string;
  refsUsages: string;
  refsNone: string;
  depBanner: string;
  depPackageLabel: string;
  depPackagePlaceholder: string;
  depFilterLabel: string;
  depFilterPlaceholder: string;
  inspectDepBtn: string;
  depNotFound: string;
  depVersionLabel: string;
  depEntryLabel: string;
  depExportsLabel: string;
  depSignaturesTitle: string;
  depCopyBtn: string;
  depCopiedToast: string;
  depTruncatedBadge: string;
  autoRtkTitle: string;
  autoRtkDesc: string;
  autoRtkOn: string;
  autoRtkOff: string;
  autoRtkToggleOn: string;
  autoRtkToggleOff: string;
  autoRtkUpdatedToast: string;
  hotspotsTitle: string;
  hotspotsEmpty: string;
  hotspotsRunsUnit: string;
  hotspotsWasteLabel: string;
  packBanner: string;
  packScopeLabel: string;
  packScopePlaceholder: string;
  packGlobsLabel: string;
  packGlobsPlaceholder: string;
  packGitDiffLabel: string;
  packBudgetLabel: string;
  packBuildBtn: string;
  packCopyBtn: string;
  packAttachBtn: string;
  packCopiedToast: string;
  packAttachedToast: string;
  packFilesStat: string;
  packTokensStat: string;
  packRedactedStat: string;
  packSkippedStat: string;
  packTruncatedBadge: string;
  packTreeTitle: string;
  packFilesTitle: string;
  packPreviewTitle: string;
  presetAuto: string;
  presetTest: string;
  presetBuild: string;
  presetGit: string;
  presetGeneric: string;
}

const TURBO_V08_LABELS: Record<ResolvedUiLocale, TurboV08Labels> = {
  en: {
    tabSearchRefs: 'Search / Refs',
    tabOutlineDep: 'Outline / Dep',
    tabCompactAuto: 'Compact & Auto-RTK',
    tabContextPack: 'Context Pack',
    modeBatchSearch: 'Batch Search',
    modeSymbolRefs: 'Symbol References',
    modeFileOutline: 'File Outline & Slice',
    modeDepContract: 'Offline Dep Contract',
    settingsBtn: 'Settings',
    symbolInputLabel: 'Symbol identifier (exact lexical match, zero LSP)',
    symbolInputPlaceholder: 'registerTurboModule',
    scopeOptionalLabel: 'Scope directory (optional)',
    scopeOptionalPlaceholder: 'src',
    findRefsBtn: 'Find References',
    refsSummary: 'Scanned {files} files · {hits} hits in {ms}ms',
    refsDefinitions: 'Definitions',
    refsImports: 'Imports',
    refsUsages: 'Usages',
    refsNone: 'No hits in this category.',
    depBanner: '100% offline read-only contract lookup (node_modules .d.ts, Python .pyi, go.mod, Cargo.lock) with <=8.8 KB cap.',
    depPackageLabel: 'Locked package name',
    depPackagePlaceholder: 'zod, @modelcontextprotocol/sdk, requests, serde',
    depFilterLabel: 'Symbol filter (optional)',
    depFilterPlaceholder: 'ZodString, parse, toJSONSchema...',
    inspectDepBtn: 'Inspect Contract',
    depNotFound: 'Package not found in local workspace lockfiles or dependencies.',
    depVersionLabel: 'Locked Version',
    depEntryLabel: 'Entry',
    depExportsLabel: 'Exports',
    depSignaturesTitle: 'Exported Signatures',
    depCopyBtn: 'Copy Contract',
    depCopiedToast: 'Copied offline dependency contract to clipboard.',
    depTruncatedBadge: 'Capped <=8.8 KB',
    autoRtkTitle: 'Auto-RTK Transparent Compression',
    autoRtkDesc: 'Opt-in hook wrapper for safe whitelisted commands (npm test, vitest, git diff, pytest) preserving exit codes and raw logs.',
    autoRtkOn: 'ENABLED',
    autoRtkOff: 'OFF (opt-in)',
    autoRtkToggleOn: 'Enable Auto-RTK',
    autoRtkToggleOff: 'Disable Auto-RTK',
    autoRtkUpdatedToast: 'Updated Auto-RTK preference.',
    hotspotsTitle: 'High-Savings Command Hotspots',
    hotspotsEmpty: 'No noisy command hotspots recorded yet. Run tests/builds/git diffs to surface savings candidates.',
    hotspotsRunsUnit: 'runs',
    hotspotsWasteLabel: 'est. reclaimable tokens',
    packBanner: 'Token-budgeted, O(n) secret-redacted Markdown context pack · skips .env, keys, symlinks & binaries.',
    packScopeLabel: 'Directory scope',
    packScopePlaceholder: 'src/modules/turbo',
    packGlobsLabel: 'Glob filters (comma or newline separated)',
    packGlobsPlaceholder: '**/*.ts, **/*.tsx',
    packGitDiffLabel: 'Current Git Diff only',
    packBudgetLabel: 'Token budget',
    packBuildBtn: 'Build Context Pack',
    packCopyBtn: 'Copy Pack',
    packAttachBtn: 'Attach to Next Turn',
    packCopiedToast: 'Copied redacted Context Pack to clipboard.',
    packAttachedToast: 'Attached Context Pack to model context.',
    packFilesStat: 'Files',
    packTokensStat: 'Est. Tokens',
    packRedactedStat: 'Redacted Secrets',
    packSkippedStat: 'Skipped Safe/Bin',
    packTruncatedBadge: 'Budget Capped',
    packTreeTitle: 'Directory Tree',
    packFilesTitle: 'Included Files',
    packPreviewTitle: 'Markdown Preview',
    presetAuto: 'Auto',
    presetTest: 'Test',
    presetBuild: 'Build',
    presetGit: 'Git',
    presetGeneric: 'Generic',
  },
  'zh-CN': {
    tabSearchRefs: '搜索 / 引用',
    tabOutlineDep: '大纲 / 依赖契约',
    tabCompactAuto: '压缩与 Auto-RTK',
    tabContextPack: '上下文代码包',
    modeBatchSearch: '批量搜索',
    modeSymbolRefs: '符号引用',
    modeFileOutline: '文件大纲切片',
    modeDepContract: '离线依赖契约',
    settingsBtn: '设置',
    symbolInputLabel: '符号标识符（精确词法边界匹配，零常驻 LSP）',
    symbolInputPlaceholder: 'registerTurboModule',
    scopeOptionalLabel: '扫描目录（可选）',
    scopeOptionalPlaceholder: 'src',
    findRefsBtn: '检索符号引用',
    refsSummary: '已扫描 {files} 个文件 · {hits} 处命中（{ms}ms）',
    refsDefinitions: '定义（Definitions）',
    refsImports: '导入（Imports）',
    refsUsages: '调用引用（Usages）',
    refsNone: '该分类暂无命中。',
    depBanner: '100% 离线只读依赖契约检索（node_modules .d.ts / Python .pyi / go.mod / Cargo.lock），严守 <=8.8 KB 上限。',
    depPackageLabel: '锁定依赖包名',
    depPackagePlaceholder: 'zod、@modelcontextprotocol/sdk、requests、serde',
    depFilterLabel: '符号过滤（可选）',
    depFilterPlaceholder: 'ZodString、parse、toJSONSchema...',
    inspectDepBtn: '查询锁定契约',
    depNotFound: '未在当前工作区本地依赖或锁文件中找到该包。',
    depVersionLabel: '锁定版本',
    depEntryLabel: '入口文件',
    depExportsLabel: '导出元信息',
    depSignaturesTitle: '公开 API 签名',
    depCopyBtn: '复制契约',
    depCopiedToast: '已复制离线依赖契约到剪贴板。',
    depTruncatedBadge: '已按 <=8.8 KB 截断',
    autoRtkTitle: 'Auto-RTK 透明压缩',
    autoRtkDesc: '按需开启的安全白名单命令透明压缩（npm test / vitest / git diff / pytest），完整保留退出码与原始日志。',
    autoRtkOn: '已开启',
    autoRtkOff: '已关闭（按需开启）',
    autoRtkToggleOn: '开启 Auto-RTK',
    autoRtkToggleOff: '关闭 Auto-RTK',
    autoRtkUpdatedToast: '已更新 Auto-RTK 开关状态。',
    hotspotsTitle: '高频省流热点命令',
    hotspotsEmpty: '暂未记录到高耗能命令热点。运行测试、构建或 git diff 后将自动汇总省流候选。',
    hotspotsRunsUnit: '次',
    hotspotsWasteLabel: '预计可省 Token',
    packBanner: '受控 Token 预算与 O(n) 凭据脱敏代码包 · 自动跳过 .env、私钥、符号链接与二进制文件。',
    packScopeLabel: '打包目录',
    packScopePlaceholder: 'src/modules/turbo',
    packGlobsLabel: 'Glob 过滤（逗号或换行分隔）',
    packGlobsPlaceholder: '**/*.ts, **/*.tsx',
    packGitDiffLabel: '仅当前 Git Diff 改动文件',
    packBudgetLabel: 'Token 预算上限',
    packBuildBtn: '生成脱敏代码包',
    packCopyBtn: '复制代码包',
    packAttachBtn: '挂载到下轮上下文',
    packCopiedToast: '已复制脱敏上下文代码包。',
    packAttachedToast: '已将脱敏代码包挂载到模型下轮上下文。',
    packFilesStat: '包含文件',
    packTokensStat: '估算 Token',
    packRedactedStat: '脱敏凭据',
    packSkippedStat: '跳过敏感/二进制',
    packTruncatedBadge: '已按预算截断',
    packTreeTitle: '目录树',
    packFilesTitle: '已包含文件',
    packPreviewTitle: 'Markdown 代码包预览',
    presetAuto: '自动识别',
    presetTest: '测试日志',
    presetBuild: '构建日志',
    presetGit: 'Git 差异',
    presetGeneric: '通用日志',
  },
  'zh-TW': {
    tabSearchRefs: '搜尋 / 引用',
    tabOutlineDep: '大綱 / 相依契約',
    tabCompactAuto: '壓縮與 Auto-RTK',
    tabContextPack: '上下文程式碼包',
    modeBatchSearch: '批次搜尋',
    modeSymbolRefs: '符號引用',
    modeFileOutline: '檔案大綱切片',
    modeDepContract: '離線相依契約',
    settingsBtn: '設定',
    symbolInputLabel: '符號識別碼（精確詞法邊界比對，零常駐 LSP）',
    symbolInputPlaceholder: 'registerTurboModule',
    scopeOptionalLabel: '掃描目錄（選填）',
    scopeOptionalPlaceholder: 'src',
    findRefsBtn: '檢索符號引用',
    refsSummary: '已掃描 {files} 個檔案 · {hits} 處命中（{ms}ms）',
    refsDefinitions: '定義（Definitions）',
    refsImports: '匯入（Imports）',
    refsUsages: '呼叫引用（Usages）',
    refsNone: '此分類暫無命中。',
    depBanner: '100% 離線唯讀相依契約檢索（node_modules .d.ts / Python .pyi / go.mod / Cargo.lock），嚴守 <=8.8 KB 上限。',
    depPackageLabel: '鎖定相依套件名稱',
    depPackagePlaceholder: 'zod、@modelcontextprotocol/sdk、requests、serde',
    depFilterLabel: '符號篩選（選填）',
    depFilterPlaceholder: 'ZodString、parse、toJSONSchema...',
    inspectDepBtn: '查詢鎖定契約',
    depNotFound: '未在目前工作區本機相依或鎖定檔中找到此套件。',
    depVersionLabel: '鎖定版本',
    depEntryLabel: '入口檔案',
    depExportsLabel: '匯出中繼資訊',
    depSignaturesTitle: '公開 API 簽章',
    depCopyBtn: '複製契約',
    depCopiedToast: '已複製離線相依契約至剪貼簿。',
    depTruncatedBadge: '已按 <=8.8 KB 截斷',
    autoRtkTitle: 'Auto-RTK 透明壓縮',
    autoRtkDesc: '按需開啟的安全白名單命令透明壓縮（npm test / vitest / git diff / pytest），完整保留結束碼與原始日誌。',
    autoRtkOn: '已開啟',
    autoRtkOff: '已關閉（按需開啟）',
    autoRtkToggleOn: '開啟 Auto-RTK',
    autoRtkToggleOff: '關閉 Auto-RTK',
    autoRtkUpdatedToast: '已更新 Auto-RTK 狀態。',
    hotspotsTitle: '高頻省流熱點命令',
    hotspotsEmpty: '暫無高耗能命令熱點記錄。執行測試、建置或 git diff 後將自動彙總省流候選。',
    hotspotsRunsUnit: '次',
    hotspotsWasteLabel: '預估可省 Token',
    packBanner: '受控 Token 預算與 O(n) 憑證去敏程式碼包 · 自動略過 .env、私鑰、符號連結與二進位檔。',
    packScopeLabel: '打包目錄',
    packScopePlaceholder: 'src/modules/turbo',
    packGlobsLabel: 'Glob 篩選（逗號或換行分隔）',
    packGlobsPlaceholder: '**/*.ts, **/*.tsx',
    packGitDiffLabel: '僅目前 Git Diff 變更檔案',
    packBudgetLabel: 'Token 預算上限',
    packBuildBtn: '產生去敏程式碼包',
    packCopyBtn: '複製程式碼包',
    packAttachBtn: '掛載至下輪上下文',
    packCopiedToast: '已複製去敏上下文程式碼包。',
    packAttachedToast: '已將去敏程式碼包掛載至模型下輪上下文。',
    packFilesStat: '包含檔案',
    packTokensStat: '估算 Token',
    packRedactedStat: '去敏憑證',
    packSkippedStat: '略過敏感/二進位',
    packTruncatedBadge: '已按預算截斷',
    packTreeTitle: '目錄樹',
    packFilesTitle: '已包含檔案',
    packPreviewTitle: 'Markdown 程式碼包預覽',
    presetAuto: '自動偵測',
    presetTest: '測試日誌',
    presetBuild: '建置日誌',
    presetGit: 'Git 差異',
    presetGeneric: '一般日誌',
  },
  ja: {
    tabSearchRefs: '検索 / 参照',
    tabOutlineDep: '概要 / 依存契約',
    tabCompactAuto: '圧縮 & Auto-RTK',
    tabContextPack: 'コンテキストパック',
    modeBatchSearch: '一括検索',
    modeSymbolRefs: 'シンボル参照',
    modeFileOutline: 'ファイル概要',
    modeDepContract: 'オフライン依存契約',
    settingsBtn: '設定',
    symbolInputLabel: 'シンボル識別子（厳密字句一致・LSP 不要）',
    symbolInputPlaceholder: 'registerTurboModule',
    scopeOptionalLabel: '対象ディレクトリ（任意）',
    scopeOptionalPlaceholder: 'src',
    findRefsBtn: '参照を検索',
    refsSummary: '{files} ファイルを走査 · {hits} 件ヒット（{ms}ms）',
    refsDefinitions: '定義 (Definitions)',
    refsImports: 'インポート (Imports)',
    refsUsages: '使用箇所 (Usages)',
    refsNone: 'この分類に該当はありません。',
    depBanner: '100% オフライン読み取り専用の依存 API 契約検査（.d.ts / .pyi / go.mod / Cargo.lock）、<=8.8 KB 上限。',
    depPackageLabel: 'ロック済みパッケージ名',
    depPackagePlaceholder: 'zod, @modelcontextprotocol/sdk, requests, serde',
    depFilterLabel: 'シンボル絞り込み（任意）',
    depFilterPlaceholder: 'ZodString, parse, toJSONSchema...',
    inspectDepBtn: '契約を検査',
    depNotFound: 'ワークスペース内のローカル依存・ロックファイルに該当パッケージが見つかりません。',
    depVersionLabel: 'ロック版',
    depEntryLabel: 'エントリ',
    depExportsLabel: 'エクスポート情報',
    depSignaturesTitle: '公開シグネチャ',
    depCopyBtn: '契約をコピー',
    depCopiedToast: 'オフライン依存契約をコピーしました。',
    depTruncatedBadge: '<=8.8 KB 制限適用',
    autoRtkTitle: 'Auto-RTK 透過圧縮',
    autoRtkDesc: '安全なホワイトリストコマンド（npm test / vitest / git diff / pytest）の出力を透過圧縮し、終了コードと生ログを保持します。',
    autoRtkOn: '有効',
    autoRtkOff: '無効（オプトイン）',
    autoRtkToggleOn: 'Auto-RTK を有効化',
    autoRtkToggleOff: 'Auto-RTK を無効化',
    autoRtkUpdatedToast: 'Auto-RTK 設定を更新しました。',
    hotspotsTitle: '高節約コマンドホットスポット',
    hotspotsEmpty: '高出力コマンドのホットスポットはまだ記録されていません。',
    hotspotsRunsUnit: '回',
    hotspotsWasteLabel: '削減見込みトークン',
    packBanner: 'トークン予算制御・O(n) 機密マスク済み Markdown パック（.env・秘密鍵・シンボリックリンク・バイナリを除外）。',
    packScopeLabel: '対象ディレクトリ',
    packScopePlaceholder: 'src/modules/turbo',
    packGlobsLabel: 'Glob フィルタ（カンマまたは改行区切り）',
    packGlobsPlaceholder: '**/*.ts, **/*.tsx',
    packGitDiffLabel: '現在の Git Diff 変更のみ',
    packBudgetLabel: 'トークン予算上限',
    packBuildBtn: 'パックを生成',
    packCopyBtn: 'パックをコピー',
    packAttachBtn: '次ターンの文脈に添付',
    packCopiedToast: '機密マスク済みパックをコピーしました。',
    packAttachedToast: 'コンテキストパックをモデル文脈に添付しました。',
    packFilesStat: '収録ファイル',
    packTokensStat: '推定トークン',
    packRedactedStat: 'マスク済み機密',
    packSkippedStat: '除外 (機密/バイナリ)',
    packTruncatedBadge: '予算上限で切り詰め',
    packTreeTitle: 'ディレクトリツリー',
    packFilesTitle: '収録ファイル一覧',
    packPreviewTitle: 'Markdown プレビュー',
    presetAuto: '自動',
    presetTest: 'テスト',
    presetBuild: 'ビルド',
    presetGit: 'Git',
    presetGeneric: '汎用',
  },
  ko: {
    tabSearchRefs: '검색 / 참조',
    tabOutlineDep: '개요 / 의존 계약',
    tabCompactAuto: '압축 & Auto-RTK',
    tabContextPack: '컨텍스트 팩',
    modeBatchSearch: '일괄 검색',
    modeSymbolRefs: '심볼 참조',
    modeFileOutline: '파일 개요 슬라이스',
    modeDepContract: '오프라인 의존 계약',
    settingsBtn: '설정',
    symbolInputLabel: '심볼 식별자 (정확한 어휘 경계 일치, LSP 없음)',
    symbolInputPlaceholder: 'registerTurboModule',
    scopeOptionalLabel: '검색 디렉터리 (선택)',
    scopeOptionalPlaceholder: 'src',
    findRefsBtn: '참조 찾기',
    refsSummary: '{files}개 파일 스캔 · {hits}건 일치 ({ms}ms)',
    refsDefinitions: '정의 (Definitions)',
    refsImports: '가져오기 (Imports)',
    refsUsages: '사용처 (Usages)',
    refsNone: '이 분류에 일치 항목이 없습니다.',
    depBanner: '100% 오프라인 읽기 전용 의존 계약 조회 (.d.ts / .pyi / go.mod / Cargo.lock), <=8.8 KB 상한.',
    depPackageLabel: '잠긴 패키지 이름',
    depPackagePlaceholder: 'zod, @modelcontextprotocol/sdk, requests, serde',
    depFilterLabel: '심볼 필터 (선택)',
    depFilterPlaceholder: 'ZodString, parse, toJSONSchema...',
    inspectDepBtn: '계약 조회',
    depNotFound: '로컬 워크스페이스 의존성 또는 락파일에서 해당 패키지를 찾을 수 없습니다.',
    depVersionLabel: '잠긴 버전',
    depEntryLabel: '진입 파일',
    depExportsLabel: '내보내기 요약',
    depSignaturesTitle: '공개 API 시그니처',
    depCopyBtn: '계약 복사',
    depCopiedToast: '오프라인 의존 계약을 클립보드에 복사했습니다.',
    depTruncatedBadge: '<=8.8 KB 제한 적용',
    autoRtkTitle: 'Auto-RTK 투명 압축',
    autoRtkDesc: '허용 목록 명령(npm test, vitest, git diff, pytest)을 투명 압축하며 종료 코드와 원본 로그를 보존합니다.',
    autoRtkOn: '켜짐',
    autoRtkOff: '꺼짐 (선택 활성)',
    autoRtkToggleOn: 'Auto-RTK 켜기',
    autoRtkToggleOff: 'Auto-RTK 끄기',
    autoRtkUpdatedToast: 'Auto-RTK 설정이 업데이트되었습니다.',
    hotspotsTitle: '절감 핫스팟 명령',
    hotspotsEmpty: '기록된 고출력 명령 핫스팟이 없습니다. 테스트/빌드/git diff 실행 후 표시됩니다.',
    hotspotsRunsUnit: '회',
    hotspotsWasteLabel: '예상 절감 토큰',
    packBanner: '토큰 예산 제어 및 O(n) 비밀 마스킹 Markdown 팩 (.env, 개인키, 심볼릭 링크, 바이너리 제외).',
    packScopeLabel: '대상 디렉터리',
    packScopePlaceholder: 'src/modules/turbo',
    packGlobsLabel: 'Glob 필터 (쉼표 또는 줄바꿈 구분)',
    packGlobsPlaceholder: '**/*.ts, **/*.tsx',
    packGitDiffLabel: '현재 Git Diff 변경 파일만',
    packBudgetLabel: '토큰 예산',
    packBuildBtn: '컨텍스트 팩 생성',
    packCopyBtn: '팩 복사',
    packAttachBtn: '다음 턴 컨텍스트에 첨부',
    packCopiedToast: '마스킹된 컨텍스트 팩을 복사했습니다.',
    packAttachedToast: '컨텍스트 팩을 모델 컨텍스트에 첨부했습니다.',
    packFilesStat: '포함 파일',
    packTokensStat: '추정 토큰',
    packRedactedStat: '마스킹 비밀',
    packSkippedStat: '제외 (민감/바이너리)',
    packTruncatedBadge: '예산 한도 절단',
    packTreeTitle: '디렉터리 트리',
    packFilesTitle: '포함된 파일',
    packPreviewTitle: 'Markdown 미리보기',
    presetAuto: '자동',
    presetTest: '테스트',
    presetBuild: '빌드',
    presetGit: 'Git',
    presetGeneric: '일반',
  },
  es: {
    tabSearchRefs: 'Buscar / Refs',
    tabOutlineDep: 'Esquema / Dep',
    tabCompactAuto: 'Compresión & Auto-RTK',
    tabContextPack: 'Paquete de Contexto',
    modeBatchSearch: 'Búsqueda por lotes',
    modeSymbolRefs: 'Referencias de símbolos',
    modeFileOutline: 'Esquema y corte',
    modeDepContract: 'Contrato de dependencia',
    settingsBtn: 'Ajustes',
    symbolInputLabel: 'Identificador de símbolo (léxico exacto, sin LSP)',
    symbolInputPlaceholder: 'registerTurboModule',
    scopeOptionalLabel: 'Directorio alcance (opcional)',
    scopeOptionalPlaceholder: 'src',
    findRefsBtn: 'Buscar referencias',
    refsSummary: '{files} archivos · {hits} coincidencias en {ms}ms',
    refsDefinitions: 'Definiciones',
    refsImports: 'Importaciones',
    refsUsages: 'Usos',
    refsNone: 'Sin resultados en esta categoría.',
    depBanner: 'Consulta 100% offline de contratos locales (.d.ts, .pyi, go.mod, Cargo.lock) con límite <=8.8 KB.',
    depPackageLabel: 'Paquete bloqueado',
    depPackagePlaceholder: 'zod, @modelcontextprotocol/sdk, requests, serde',
    depFilterLabel: 'Filtro de símbolo (opcional)',
    depFilterPlaceholder: 'ZodString, parse, toJSONSchema...',
    inspectDepBtn: 'Inspeccionar contrato',
    depNotFound: 'Paquete no encontrado en dependencias o archivos de bloqueo locales.',
    depVersionLabel: 'Versión',
    depEntryLabel: 'Entrada',
    depExportsLabel: 'Exportaciones',
    depSignaturesTitle: 'Firmas exportadas',
    depCopyBtn: 'Copiar contrato',
    depCopiedToast: 'Contrato de dependencia copiado.',
    depTruncatedBadge: 'Tope <=8.8 KB',
    autoRtkTitle: 'Compresión transparente Auto-RTK',
    autoRtkDesc: 'Comprime comandos seguros en lista blanca (npm test, vitest, git diff, pytest) preservando códigos de salida y logs.',
    autoRtkOn: 'ACTIVO',
    autoRtkOff: 'DESACTIVADO',
    autoRtkToggleOn: 'Activar Auto-RTK',
    autoRtkToggleOff: 'Desactivar Auto-RTK',
    autoRtkUpdatedToast: 'Preferencia de Auto-RTK actualizada.',
    hotspotsTitle: 'Comandos con mayor ahorro potencial',
    hotspotsEmpty: 'Aún no hay comandos registrados. Ejecuta pruebas, compilaciones o git diff.',
    hotspotsRunsUnit: 'veces',
    hotspotsWasteLabel: 'tokens recuperables est.',
    packBanner: 'Paquete Markdown con presupuesto de tokens y redacción O(n) de secretos · omite .env, claves y binarios.',
    packScopeLabel: 'Directorio base',
    packScopePlaceholder: 'src/modules/turbo',
    packGlobsLabel: 'Filtros Glob (coma o nueva línea)',
    packGlobsPlaceholder: '**/*.ts, **/*.tsx',
    packGitDiffLabel: 'Solo Git Diff actual',
    packBudgetLabel: 'Presupuesto de tokens',
    packBuildBtn: 'Generar paquete',
    packCopyBtn: 'Copiar paquete',
    packAttachBtn: 'Adjuntar al contexto',
    packCopiedToast: 'Paquete redactado copiado al portapapeles.',
    packAttachedToast: 'Paquete adjuntado al contexto del modelo.',
    packFilesStat: 'Archivos',
    packTokensStat: 'Tokens est.',
    packRedactedStat: 'Secretos ocultos',
    packSkippedStat: 'Omitidos',
    packTruncatedBadge: 'Recortado por presupuesto',
    packTreeTitle: 'Árbol de directorios',
    packFilesTitle: 'Archivos incluidos',
    packPreviewTitle: 'Vista previa Markdown',
    presetAuto: 'Auto',
    presetTest: 'Pruebas',
    presetBuild: 'Compilación',
    presetGit: 'Git',
    presetGeneric: 'Genérico',
  },
  fr: {
    tabSearchRefs: 'Recherche / Réfs',
    tabOutlineDep: 'Plan / Dépendances',
    tabCompactAuto: 'Compact & Auto-RTK',
    tabContextPack: 'Pack de Contexte',
    modeBatchSearch: 'Recherche groupée',
    modeSymbolRefs: 'Références de symbole',
    modeFileOutline: 'Plan & extrait',
    modeDepContract: 'Contrat de dépendance',
    settingsBtn: 'Paramètres',
    symbolInputLabel: 'Identifiant de symbole (lexical exact, sans LSP)',
    symbolInputPlaceholder: 'registerTurboModule',
    scopeOptionalLabel: 'Répertoire cible (optionnel)',
    scopeOptionalPlaceholder: 'src',
    findRefsBtn: 'Chercher les références',
    refsSummary: '{files} fichiers · {hits} occurrences en {ms}ms',
    refsDefinitions: 'Définitions',
    refsImports: 'Imports',
    refsUsages: 'Utilisations',
    refsNone: 'Aucune occurrence dans cette catégorie.',
    depBanner: 'Inspection 100% hors-ligne des contrats verrouillés (.d.ts, .pyi, go.mod, Cargo.lock), plafond <=8.8 Ko.',
    depPackageLabel: 'Paquet verrouillé',
    depPackagePlaceholder: 'zod, @modelcontextprotocol/sdk, requests, serde',
    depFilterLabel: 'Filtre de symbole (optionnel)',
    depFilterPlaceholder: 'ZodString, parse, toJSONSchema...',
    inspectDepBtn: 'Inspecter le contrat',
    depNotFound: 'Paquet introuvable dans les dépendances locales ou fichiers de verrouillage.',
    depVersionLabel: 'Version',
    depEntryLabel: 'Entrée',
    depExportsLabel: 'Exports',
    depSignaturesTitle: 'Signatures exportées',
    depCopyBtn: 'Copier le contrat',
    depCopiedToast: 'Contrat de dépendance copié.',
    depTruncatedBadge: 'Plafonné <=8.8 Ko',
    autoRtkTitle: 'Compression transparente Auto-RTK',
    autoRtkDesc: 'Compresse sur option les commandes autorisées (npm test, vitest, git diff, pytest) en préservant le code retour.',
    autoRtkOn: 'ACTIF',
    autoRtkOff: 'INACTIF',
    autoRtkToggleOn: 'Activer Auto-RTK',
    autoRtkToggleOff: 'Désactiver Auto-RTK',
    autoRtkUpdatedToast: 'Préférence Auto-RTK mise à jour.',
    hotspotsTitle: 'Commandes à fort gain potentiel',
    hotspotsEmpty: 'Aucun point chaud enregistré. Lancez des tests, builds ou git diff.',
    hotspotsRunsUnit: 'fois',
    hotspotsWasteLabel: 'tokens économisables est.',
    packBanner: 'Pack Markdown sous budget de tokens avec masquage O(n) des secrets · ignore .env, clés et binaires.',
    packScopeLabel: 'Répertoire',
    packScopePlaceholder: 'src/modules/turbo',
    packGlobsLabel: 'Filtres Glob (virgule ou retour ligne)',
    packGlobsPlaceholder: '**/*.ts, **/*.tsx',
    packGitDiffLabel: 'Git Diff courant uniquement',
    packBudgetLabel: 'Budget de tokens',
    packBuildBtn: 'Générer le pack',
    packCopyBtn: 'Copier le pack',
    packAttachBtn: 'Joindre au contexte',
    packCopiedToast: 'Pack masqué copié dans le presse-papiers.',
    packAttachedToast: 'Pack joint au contexte du modèle.',
    packFilesStat: 'Fichiers',
    packTokensStat: 'Tokens est.',
    packRedactedStat: 'Secrets masqués',
    packSkippedStat: 'Ignorés',
    packTruncatedBadge: 'Tronqué au budget',
    packTreeTitle: 'Arborescence',
    packFilesTitle: 'Fichiers inclus',
    packPreviewTitle: 'Aperçu Markdown',
    presetAuto: 'Auto',
    presetTest: 'Test',
    presetBuild: 'Build',
    presetGit: 'Git',
    presetGeneric: 'Générique',
  },
  de: {
    tabSearchRefs: 'Suche / Refs',
    tabOutlineDep: 'Struktur / Dep',
    tabCompactAuto: 'Kompakt & Auto-RTK',
    tabContextPack: 'Kontext-Paket',
    modeBatchSearch: 'Stapelsuche',
    modeSymbolRefs: 'Symbol-Referenzen',
    modeFileOutline: 'Dateistruktur',
    modeDepContract: 'Offline-Dep-Vertrag',
    settingsBtn: 'Einstellungen',
    symbolInputLabel: 'Symbolbezeichner (exakt lexikalisch, ohne LSP)',
    symbolInputPlaceholder: 'registerTurboModule',
    scopeOptionalLabel: 'Zielverzeichnis (optional)',
    scopeOptionalPlaceholder: 'src',
    findRefsBtn: 'Referenzen suchen',
    refsSummary: '{files} Dateien · {hits} Treffer in {ms}ms',
    refsDefinitions: 'Definitionen',
    refsImports: 'Importe',
    refsUsages: 'Verwendungen',
    refsNone: 'Keine Treffer in dieser Kategorie.',
    depBanner: '100% Offline-Vertragsprüfung (.d.ts, .pyi, go.mod, Cargo.lock) mit <=8.8 KB Schutzgrenze.',
    depPackageLabel: 'Gesperrter Paketname',
    depPackagePlaceholder: 'zod, @modelcontextprotocol/sdk, requests, serde',
    depFilterLabel: 'Symbolfilter (optional)',
    depFilterPlaceholder: 'ZodString, parse, toJSONSchema...',
    inspectDepBtn: 'Vertrag prüfen',
    depNotFound: 'Paket nicht in lokalen Abhängigkeiten oder Lockfiles gefunden.',
    depVersionLabel: 'Version',
    depEntryLabel: 'Einstieg',
    depExportsLabel: 'Exporte',
    depSignaturesTitle: 'Exportierte Signaturen',
    depCopyBtn: 'Vertrag kopieren',
    depCopiedToast: 'Offline-Abhängigkeitsvertrag kopiert.',
    depTruncatedBadge: '<=8.8 KB begrenzt',
    autoRtkTitle: 'Auto-RTK Transparente Kompression',
    autoRtkDesc: 'Optionale Kompression für sichere Befehle (npm test, vitest, git diff, pytest) mit vollem Exit-Code-Erhalt.',
    autoRtkOn: 'AKTIV',
    autoRtkOff: 'AUS (Opt-in)',
    autoRtkToggleOn: 'Auto-RTK aktivieren',
    autoRtkToggleOff: 'Auto-RTK deaktivieren',
    autoRtkUpdatedToast: 'Auto-RTK Einstellung aktualisiert.',
    hotspotsTitle: 'Einsparungs-Hotspots',
    hotspotsEmpty: 'Noch keine Hotspots erfasst. Führen Sie Tests, Builds oder git diff aus.',
    hotspotsRunsUnit: 'Läufe',
    hotspotsWasteLabel: 'geschätzte sparb. Tokens',
    packBanner: 'Token-budgetiertes Markdown-Paket mit O(n)-Geheimnis-Schwärzung · überspringt .env, Keys & Binaries.',
    packScopeLabel: 'Verzeichnisbereich',
    packScopePlaceholder: 'src/modules/turbo',
    packGlobsLabel: 'Glob-Filter (Komma oder Zeilenumbruch)',
    packGlobsPlaceholder: '**/*.ts, **/*.tsx',
    packGitDiffLabel: 'Nur aktuelles Git Diff',
    packBudgetLabel: 'Token-Budget',
    packBuildBtn: 'Paket erstellen',
    packCopyBtn: 'Paket kopieren',
    packAttachBtn: 'An nächsten Zug anhängen',
    packCopiedToast: 'Geschwärztes Kontext-Paket kopiert.',
    packAttachedToast: 'Kontext-Paket an Modellkontext angehängt.',
    packFilesStat: 'Dateien',
    packTokensStat: 'Gesch. Tokens',
    packRedactedStat: 'Geschwärzt',
    packSkippedStat: 'Übersprungen',
    packTruncatedBadge: 'Budget erreicht',
    packTreeTitle: 'Verzeichnisbaum',
    packFilesTitle: 'Enthaltene Dateien',
    packPreviewTitle: 'Markdown-Vorschau',
    presetAuto: 'Auto',
    presetTest: 'Test',
    presetBuild: 'Build',
    presetGit: 'Git',
    presetGeneric: 'Allgemein',
  },
};

interface TurboGainBucket {
  operations: number;
  rawTokens: number;
  returnedTokens: number;
  savedTokens: number;
  savedPercent: number;
  estimatedSavedUsd: number;
}

interface TurboGainSummary {
  totalOperations: number;
  totalRawTokens: number;
  totalReturnedTokens: number;
  totalSavedTokens: number;
  avgCompressionPercent: number;
  estimatedSavedUsd: number;
  guardrailTriggeredCount: number;
  byOperation: {
    search: TurboGainBucket;
    outline: TurboGainBucket;
    compact: TurboGainBucket;
  };
  recent: Array<{
    op: 'batch_search' | 'read_outline' | 'compact_output';
    label: string;
    savedTokens: number;
    savedPercent: number;
    guardrailApplied: boolean;
    timestamp: string;
  }>;
}

interface TurboPrefsView {
  schemaVersion: 1;
  autoRtk: boolean;
  updatedAt: string;
}

interface TurboHotspotView {
  commandPrefix: string;
  count: number;
  lastCommand: string;
  estimatedWasteTokens: number;
  lastSeenAt: string;
}

interface SymbolRefHitView {
  file: string;
  line: number;
  column: number;
  kind: 'definition' | 'import' | 'usage';
  snippet: string;
}

interface SymbolRefsView {
  symbol: string;
  scope: string;
  scannedFiles: number;
  definitions: SymbolRefHitView[];
  imports: SymbolRefHitView[];
  usages: SymbolRefHitView[];
  totalHits: number;
  truncated: boolean;
  elapsedMs: number;
}

interface DepContractView {
  found: boolean;
  ecosystem: string;
  packageName: string;
  version: string | null;
  entryFile: string | null;
  exportsSummary: string;
  signatures: Array<{ line: number; kind: string; signature: string; sourceFile?: string }>;
  snippet: string;
  totalBytes: number;
  truncated: boolean;
  note?: string;
}

interface ContextPackView {
  mode: 'scope' | 'git_diff';
  scope: string;
  globs: string[];
  maxTokens: number;
  estimatedTokens: number;
  totalChars: number;
  totalFiles: number;
  includedFiles: number;
  skippedSensitive: number;
  skippedBinary: number;
  skippedSymlinks: number;
  skippedOversized: number;
  redactionCount: number;
  truncated: boolean;
  tree: string;
  files: Array<{
    path: string;
    bytes: number;
    estimatedTokens: number;
    truncated: boolean;
    redactions: number;
  }>;
  markdown: string;
  elapsedMs: number;
  note?: string;
}

interface TurboState {
  mode: string;
  stats: {
    searchCount: number;
    outlineCount: number;
    compactionCount: number;
    indexedChunks: number;
    estimatedSavedTokens: number;
  };
  gain?: TurboGainSummary;
  prefs?: TurboPrefsView;
  hotspots?: TurboHotspotView[];
  chunks: Array<{
    chunkId: string;
    label: string;
    totalLines: number;
    estimatedSavedTokens: number;
    detectedPreset?: Exclude<CompactPresetOption, 'auto'>;
    savedPercent?: number;
  }>;
  lastSearch: {
    scannedFiles: number;
    totalMatches: number;
    skippedSensitive: number;
    elapsedMs: number;
    results: Array<{
      query: string;
      totalHits: number;
      matches: Array<{ file: string; line: number; snippet: string }>;
    }>;
  } | null;
  lastReferences?: SymbolRefsView | null;
  lastOutline: {
    file: string;
    language: string;
    totalLines: number;
    estimatedSavedTokens: number;
    outline: Array<{
      kind: string;
      name: string;
      line: number;
      level?: number;
      parent?: string;
    }>;
    slice: { startLine: number; endLine: number; content: string };
  } | null;
  lastDepContract?: DepContractView | null;
  lastCompact: {
    chunkId: string;
    label: string;
    summaryText: string;
    estimatedRawTokens: number;
    estimatedSummaryTokens: number;
    estimatedSavedTokens: number;
    compressionRatio?: number;
    detectedPreset?: Exclude<CompactPresetOption, 'auto'>;
    linesBefore?: number;
    linesAfter?: number;
    savedPercent?: number;
  } | null;
  lastContextPack?: ContextPackView | null;
}

export const TurboPanel: React.FC<NovModulePanelProps> = ({
  bridge,
  active,
  onNotify,
  onOpenSettings,
}) => {
  const { locale, dict, t } = useNovI18n();
  const [caps, setCaps] = useState(() => bridge.getCapabilities());
  useEffect(() => {
    let mounted = true;
    void bridge.ready().then(() => {
      if (mounted) setCaps(bridge.getCapabilities());
    });
    return () => {
      mounted = false;
    };
  }, [bridge]);
  const canUpdateContext = caps.updateModelContext;
  const v08 = TURBO_V08_LABELS[locale] ?? TURBO_V08_LABELS.en;

  const [tab, setTab] = useState<TurboTabId>('search');
  const [searchMode, setSearchMode] = useState<SearchSubMode>('text');
  const [outlineMode, setOutlineMode] = useState<OutlineSubMode>('outline');
  const [state, setState] = useState<TurboState | null>(null);
  const [prefs, setPrefs] = useState<TurboPrefsView>({
    schemaVersion: 1,
    autoRtk: false,
    updatedAt: '',
  });
  const [hotspots, setHotspots] = useState<TurboHotspotView[]>([]);
  const [busy, setBusy] = useState(false);

  // Search & Refs state
  const [queriesText, setQueriesText] = useState('createNovServer\nMODULE_CATALOG');
  const [refSymbol, setRefSymbol] = useState('registerTurboModule');
  const [refScope, setRefScope] = useState('src');

  // Outline & Dep Contract state
  const [filePath, setFilePath] = useState('src/core/catalog.ts');
  const [startLine, setStartLine] = useState('1');
  const [endLine, setEndLine] = useState('45');
  const [depPackage, setDepPackage] = useState('zod');
  const [depSymbolFilter, setDepSymbolFilter] = useState('');

  // Compact state
  const [rawOutput, setRawOutput] = useState('');
  const [compactPreset, setCompactPreset] = useState<CompactPresetOption>('auto');
  const [chunkQuery, setChunkQuery] = useState('');
  const [chunkHits, setChunkHits] = useState<Array<{ matchedLine: number; snippet: string }> | null>(
    null,
  );

  // Context Pack state
  const [packScope, setPackScope] = useState('src');
  const [packGlobsText, setPackGlobsText] = useState('**/*.ts');
  const [packFromGitDiff, setPackFromGitDiff] = useState(false);
  const [packMaxTokens, setPackMaxTokens] = useState(8000);

  const loadState = useCallback(async () => {
    try {
      const [stateRes, prefsRes] = await Promise.all([
        bridge.callTool<TurboState>('app_turbo_get_state', {}),
        bridge
          .callTool<{ prefs: TurboPrefsView; hotspots: TurboHotspotView[] }>(
            'app_turbo_get_prefs',
            {},
          )
          .catch(() => null),
      ]);
      setState(stateRes);
      if (prefsRes?.prefs) {
        setPrefs(prefsRes.prefs);
      } else if (stateRes?.prefs) {
        setPrefs(stateRes.prefs);
      }
      if (Array.isArray(prefsRes?.hotspots)) {
        setHotspots(prefsRes.hotspots);
      } else if (Array.isArray(stateRes?.hotspots)) {
        setHotspots(stateRes.hotspots);
      }
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    }
  }, [bridge, onNotify]);

  useEffect(() => {
    if (active) void loadState();
  }, [active, loadState]);

  const runSearch = async () => {
    const queries = queriesText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 8);
    if (queries.length === 0) return;
    setBusy(true);
    try {
      const res = await bridge.callTool<{ state: TurboState }>('app_turbo_batch_search', {
        queries,
        mode: 'text',
      });
      setState(res.state);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runReferences = async () => {
    const sym = refSymbol.trim();
    if (!sym) return;
    setBusy(true);
    try {
      const res = await bridge.callTool<{ state: TurboState }>('app_turbo_batch_search', {
        queries: [sym],
        mode: 'references',
        directory: refScope.trim() || undefined,
      });
      setState(res.state);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runOutline = async () => {
    if (!filePath.trim()) return;
    setBusy(true);
    try {
      const s = Number(startLine) || 1;
      const e = Number(endLine) || undefined;
      const res = await bridge.callTool<{ state: TurboState }>('app_turbo_read_outline', {
        filePath: filePath.trim(),
        startLine: s,
        endLine: e,
      });
      setState(res.state);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runInspectDep = async () => {
    const pkg = depPackage.trim();
    if (!pkg) return;
    setBusy(true);
    try {
      const res = await bridge.callTool<{ state: TurboState }>('app_turbo_inspect_dep', {
        packageName: pkg,
        symbolFilter: depSymbolFilter.trim() || undefined,
      });
      setState(res.state);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleAutoRtk = async () => {
    setBusy(true);
    try {
      const nextVal = !prefs.autoRtk;
      const res = await bridge.callTool<{ prefs: TurboPrefsView; hotspots: TurboHotspotView[] }>(
        'app_turbo_update_prefs',
        { autoRtk: nextVal },
      );
      if (res?.prefs) setPrefs(res.prefs);
      if (Array.isArray(res?.hotspots)) setHotspots(res.hotspots);
      onNotify?.(v08.autoRtkUpdatedToast);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runCompact = async () => {
    if (!rawOutput.trim()) return;
    setBusy(true);
    setChunkHits(null);
    try {
      const res = await bridge.callTool<{ state: TurboState }>('app_turbo_compact_output', {
        label: 'pasted-log',
        rawText: rawOutput,
        preset: compactPreset,
      });
      setState(res.state);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runChunkQuery = async (chunkId: string) => {
    if (!chunkQuery.trim()) return;
    setBusy(true);
    try {
      const res = await bridge.callTool<{
        matches: Array<{ matchedLine: number; snippet: string }>;
      }>('app_turbo_query_chunk', { chunkId, query: chunkQuery.trim(), limit: 10 });
      setChunkHits(res.matches ?? []);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runBuildContextPack = async () => {
    setBusy(true);
    try {
      const globs = packGlobsText
        .split(/[,\r\n]+/)
        .map((g) => g.trim())
        .filter(Boolean)
        .slice(0, 16);
      const res = await bridge.callTool<{ state: TurboState }>('app_turbo_build_context_pack', {
        scope: packScope.trim() || undefined,
        globs: globs.length > 0 ? globs : undefined,
        fromGitDiff: packFromGitDiff,
        maxTokens: packMaxTokens,
      });
      setState(res.state);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const copyTextSafe = async (text: string, toastMessage: string) => {
    try {
      await navigator.clipboard?.writeText(text);
      onNotify?.(toastMessage);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    }
  };

  const attachContextPack = async (markdown: string) => {
    try {
      const outcome = await bridge.updateModelContext(markdown);
      onNotify?.(outcome === 'context' ? v08.packAttachedToast : v08.packCopiedToast);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    }
  };

  const compactPresetChoices: ReadonlyArray<{ value: CompactPresetOption; label: string }> = [
    { value: 'auto', label: v08.presetAuto },
    { value: 'test', label: v08.presetTest },
    { value: 'build', label: v08.presetBuild },
    { value: 'git', label: v08.presetGit },
    { value: 'generic', label: v08.presetGeneric },
  ];

  const lastCompact = state?.lastCompact;
  const lastRefs = state?.lastReferences ?? null;
  const lastDep = state?.lastDepContract ?? null;
  const lastPack = state?.lastContextPack ?? null;
  const gain = state?.gain;

  const savedRatio = lastCompact
    ? typeof lastCompact.savedPercent === 'number'
      ? Math.max(0, Math.min(100, Math.round(lastCompact.savedPercent)))
      : typeof lastCompact.compressionRatio === 'number'
        ? Math.max(0, Math.round(lastCompact.compressionRatio * 100))
        : lastCompact.estimatedRawTokens > 0
          ? Math.max(
              0,
              Math.round((lastCompact.estimatedSavedTokens / lastCompact.estimatedRawTokens) * 100),
            )
          : 0
    : 0;

  const gainTotalSavedTokens = gain?.totalSavedTokens ?? state?.stats.estimatedSavedTokens ?? 0;
  const gainEstUsdSaved = gain?.estimatedSavedUsd ?? 0;
  const gainAvgCompression = gain?.avgCompressionPercent ?? 0;
  const gainTotalOps =
    gain?.totalOperations ??
    (state
      ? state.stats.searchCount + state.stats.outlineCount + state.stats.compactionCount
      : 0);
  const gainGuardrailCount = gain?.guardrailTriggeredCount ?? 0;

  const formatGainOpLabel = (op: 'batch_search' | 'read_outline' | 'compact_output'): string => {
    if (op === 'batch_search') return dict.turbo.tabSearch;
    if (op === 'read_outline') return dict.turbo.tabOutline;
    return dict.turbo.tabCompact;
  };

  const renderRefGroup = (title: string, items: SymbolRefHitView[], badgeClass: string) => (
    <div className="nov-p-item">
      <div className="nov-p-row">
        <strong style={{ fontSize: '12px' }}>{title}</strong>
        <span className={`nov-badge ${badgeClass}`}>{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: '11.5px', color: 'var(--nov-text-2)' }}>{v08.refsNone}</div>
      ) : (
        items.slice(0, 25).map((hit, idx) => (
          <div
            key={`${hit.file}:${hit.line}:${hit.column}:${idx}`}
            style={{ fontSize: '11.5px', fontFamily: 'var(--nov-font-mono)' }}
          >
            <span style={{ color: 'var(--nov-accent)' }}>
              {hit.file}:{hit.line}:{hit.column}
            </span>{' '}
            <span style={{ color: 'var(--nov-text-1)' }}>{hit.snippet}</span>
          </div>
        ))
      )}
    </div>
  );

  return (
    <div className="nov-p-page">
      <section className="nov-p-card">
        <div className="nov-p-row">
          <div>
            <h2 className="nov-hero-title">{dict.turbo.title}</h2>
            <p className="nov-hero-sub">{dict.turbo.subtitle}</p>
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            {onOpenSettings && (
              <button
                type="button"
                className="nov-p-btn"
                title={v08.settingsBtn}
                onClick={() => onOpenSettings('turbo')}
              >
                {v08.settingsBtn}
              </button>
            )}
            <button type="button" className="nov-p-btn" onClick={() => void loadState()}>
              {dict.common.refresh}
            </button>
          </div>
        </div>

        <div className="nov-p-stat-grid">
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{dict.turbo.tabSearch}</div>
            <div className="nov-p-stat-val">{state?.stats.searchCount ?? 0}</div>
          </div>
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{dict.turbo.tabOutline}</div>
            <div className="nov-p-stat-val">{state?.stats.outlineCount ?? 0}</div>
          </div>
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{dict.turbo.tabCompact}</div>
            <div className="nov-p-stat-val">{state?.stats.indexedChunks ?? 0}</div>
          </div>
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{dict.turbo.gainTokensSaved}</div>
            <div className="nov-p-stat-val" style={{ color: 'var(--nov-success)' }}>
              ~{gainTotalSavedTokens.toLocaleString()}
            </div>
          </div>
        </div>

        <div className="nov-p-banner">{dict.turbo.safetyNote}</div>

        <div className="nov-p-tabs">
          {(
            [
              { id: 'search', label: v08.tabSearchRefs },
              { id: 'outline', label: v08.tabOutlineDep },
              { id: 'compact', label: v08.tabCompactAuto },
              { id: 'pack', label: v08.tabContextPack },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nov-preset-btn ${tab === item.id ? 'is-active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <section className="nov-p-card">
        <div className="nov-p-row">
          <strong style={{ fontSize: '13px' }}>{dict.turbo.gainTitle}</strong>
          <span className={`nov-badge ${gainGuardrailCount > 0 ? 'is-accent' : 'is-offline'}`}>
            {dict.turbo.guardrailBadge}
            {gainGuardrailCount > 0 ? ` · ${gainGuardrailCount}` : ''}
          </span>
        </div>

        <div className="nov-p-stat-grid">
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{dict.turbo.gainTokensSaved}</div>
            <div className="nov-p-stat-val" style={{ color: 'var(--nov-success)' }}>
              ~{gainTotalSavedTokens.toLocaleString()}
            </div>
          </div>
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{dict.turbo.gainEstUsdSaved}</div>
            <div className="nov-p-stat-val" style={{ color: 'var(--nov-accent)' }}>
              ${gainEstUsdSaved.toFixed(4)}
            </div>
          </div>
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{dict.turbo.gainAvgRatio}</div>
            <div className="nov-p-stat-val">{gainAvgCompression}%</div>
          </div>
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{dict.turbo.gainOpsCount}</div>
            <div className="nov-p-stat-val">{gainTotalOps}</div>
          </div>
        </div>

        {gain && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            <span className="nov-badge">
              {dict.turbo.tabSearch}: {gain.byOperation.search.operations} (
              {gain.byOperation.search.savedPercent}%)
            </span>
            <span className="nov-badge">
              {dict.turbo.tabOutline}: {gain.byOperation.outline.operations} (
              {gain.byOperation.outline.savedPercent}%)
            </span>
            <span className="nov-badge">
              {dict.turbo.tabCompact}: {gain.byOperation.compact.operations} (
              {gain.byOperation.compact.savedPercent}%)
            </span>
          </div>
        )}

        {gain && gain.recent.length > 0 && (
          <div className="nov-p-list">
            {gain.recent.slice(0, 4).map((entry, idx) => (
              <div
                key={`${entry.timestamp}-${entry.op}-${idx}`}
                className="nov-p-row"
                style={{ fontSize: '11.5px', fontFamily: 'var(--nov-font-mono)' }}
              >
                <span style={{ display: 'flex', gap: '6px', alignItems: 'center', minWidth: 0 }}>
                  <span className="nov-badge">{formatGainOpLabel(entry.op)}</span>
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {entry.label}
                  </span>
                </span>
                <span style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
                  {entry.guardrailApplied && (
                    <span className="nov-badge is-accent">{dict.turbo.guardrailBadge}</span>
                  )}
                  <span style={{ color: 'var(--nov-success)' }}>
                    -{entry.savedTokens.toLocaleString()} ({entry.savedPercent}%)
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {tab === 'search' && (
        <section className="nov-p-card">
          <div className="nov-p-tabs" style={{ marginBottom: '4px' }}>
            <button
              type="button"
              className={`nov-preset-btn ${searchMode === 'text' ? 'is-active' : ''}`}
              onClick={() => setSearchMode('text')}
            >
              {v08.modeBatchSearch}
            </button>
            <button
              type="button"
              className={`nov-preset-btn ${searchMode === 'references' ? 'is-active' : ''}`}
              onClick={() => setSearchMode('references')}
            >
              {v08.modeSymbolRefs}
            </button>
          </div>

          {searchMode === 'text' ? (
            <>
              <label style={{ fontSize: '12px', fontWeight: 600 }}>{dict.turbo.queriesLabel}</label>
              <textarea
                className="nov-p-textarea"
                value={queriesText}
                placeholder={dict.turbo.queriesPlaceholder}
                onChange={(e) => setQueriesText(e.target.value)}
              />
              <div className="nov-p-row">
                <button
                  type="button"
                  className="nov-p-btn is-primary"
                  disabled={busy}
                  onClick={() => void runSearch()}
                >
                  {busy ? dict.common.loading : dict.turbo.searchBtn}
                </button>
                {state?.lastSearch && (
                  <span style={{ fontSize: '12px', color: 'var(--nov-text-1)' }}>
                    {t(dict.turbo.matchesSummary, {
                      files: state.lastSearch.scannedFiles,
                      matches: state.lastSearch.totalMatches,
                    })}
                  </span>
                )}
              </div>

              {state?.lastSearch && (
                <div className="nov-p-list">
                  {state.lastSearch.results.map((r) => (
                    <div key={r.query} className="nov-p-item">
                      <div className="nov-p-row">
                        <strong>{r.query}</strong>
                        <span className="nov-badge">{r.totalHits}</span>
                      </div>
                      {r.matches.slice(0, 6).map((m, idx) => (
                        <div
                          key={`${m.file}:${m.line}:${idx}`}
                          style={{ fontSize: '11.5px', fontFamily: 'var(--nov-font-mono)' }}
                        >
                          <span style={{ color: 'var(--nov-accent)' }}>
                            {m.file}:{m.line}
                          </span>{' '}
                          <span style={{ color: 'var(--nov-text-1)' }}>{m.snippet}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <label style={{ fontSize: '12px', fontWeight: 600 }}>{v08.symbolInputLabel}</label>
              <div className="nov-p-row" style={{ gap: '8px', flexWrap: 'wrap' }}>
                <input
                  className="nov-p-input"
                  style={{ flex: 2, minWidth: '180px' }}
                  value={refSymbol}
                  placeholder={v08.symbolInputPlaceholder}
                  onChange={(e) => setRefSymbol(e.target.value)}
                />
                <input
                  className="nov-p-input"
                  style={{ flex: 1, minWidth: '120px' }}
                  value={refScope}
                  placeholder={v08.scopeOptionalPlaceholder}
                  aria-label={v08.scopeOptionalLabel}
                  onChange={(e) => setRefScope(e.target.value)}
                />
                <button
                  type="button"
                  className="nov-p-btn is-primary"
                  disabled={busy || !refSymbol.trim()}
                  onClick={() => void runReferences()}
                >
                  {busy ? dict.common.loading : v08.findRefsBtn}
                </button>
              </div>

              {lastRefs && (
                <>
                  <div className="nov-p-row">
                    <span style={{ fontSize: '12px', fontWeight: 600, fontFamily: 'var(--nov-font-mono)' }}>
                      {lastRefs.symbol} ({lastRefs.scope})
                    </span>
                    <span style={{ fontSize: '11.5px', color: 'var(--nov-text-1)' }}>
                      {t(v08.refsSummary, {
                        files: lastRefs.scannedFiles,
                        hits: lastRefs.totalHits,
                        ms: lastRefs.elapsedMs,
                      })}
                    </span>
                  </div>
                  <div className="nov-p-list">
                    {renderRefGroup(v08.refsDefinitions, lastRefs.definitions, 'is-accent')}
                    {renderRefGroup(v08.refsImports, lastRefs.imports, 'is-offline')}
                    {renderRefGroup(v08.refsUsages, lastRefs.usages, '')}
                  </div>
                </>
              )}
            </>
          )}
        </section>
      )}

      {tab === 'outline' && (
        <section className="nov-p-card">
          <div className="nov-p-tabs" style={{ marginBottom: '4px' }}>
            <button
              type="button"
              className={`nov-preset-btn ${outlineMode === 'outline' ? 'is-active' : ''}`}
              onClick={() => setOutlineMode('outline')}
            >
              {v08.modeFileOutline}
            </button>
            <button
              type="button"
              className={`nov-preset-btn ${outlineMode === 'dep' ? 'is-active' : ''}`}
              onClick={() => setOutlineMode('dep')}
            >
              {v08.modeDepContract}
            </button>
          </div>

          {outlineMode === 'outline' ? (
            <>
              <div className="nov-p-banner">{dict.turbo.nestedOutlineNote}</div>
              <label style={{ fontSize: '12px', fontWeight: 600 }}>{dict.turbo.filePathLabel}</label>
              <input
                className="nov-p-input"
                value={filePath}
                placeholder={dict.turbo.filePathPlaceholder}
                onChange={(e) => setFilePath(e.target.value)}
              />
              <div className="nov-p-row">
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <label style={{ fontSize: '11.5px' }}>{dict.turbo.startLine}</label>
                  <input
                    className="nov-p-input"
                    style={{ width: '80px' }}
                    value={startLine}
                    onChange={(e) => setStartLine(e.target.value)}
                  />
                  <label style={{ fontSize: '11.5px' }}>{dict.turbo.endLine}</label>
                  <input
                    className="nov-p-input"
                    style={{ width: '80px' }}
                    value={endLine}
                    onChange={(e) => setEndLine(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="nov-p-btn is-primary"
                  disabled={busy}
                  onClick={() => void runOutline()}
                >
                  {busy ? dict.common.loading : dict.turbo.outlineBtn}
                </button>
              </div>

              {state?.lastOutline && (
                <>
                  <div style={{ fontSize: '12px', fontWeight: 600 }}>
                    {dict.turbo.symbolsTitle} ({state.lastOutline.file})
                  </div>
                  <div className="nov-p-list">
                    {state.lastOutline.outline.slice(0, 40).map((sym, idx) => {
                      const isNested = sym.level === 1 || Boolean(sym.parent);
                      return (
                        <div
                          key={`${sym.line}-${sym.parent ?? ''}-${sym.name}-${idx}`}
                          className="nov-p-row"
                          style={{
                            fontSize: '12px',
                            fontFamily: 'var(--nov-font-mono)',
                            paddingLeft: isNested ? '18px' : undefined,
                            borderLeft: isNested ? '2px solid var(--nov-border)' : undefined,
                          }}
                        >
                          <span>
                            <span className={`nov-badge ${isNested ? 'is-accent' : ''}`}>
                              {sym.kind}
                            </span>{' '}
                            {sym.parent ? (
                              <>
                                <span style={{ color: 'var(--nov-text-2)' }}>{sym.parent}::</span>
                                {sym.name}
                              </>
                            ) : (
                              sym.name
                            )}
                          </span>
                          <span style={{ color: 'var(--nov-text-2)' }}>L{sym.line}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: '12px', fontWeight: 600 }}>{dict.turbo.sliceTitle}</div>
                  <pre className="nov-p-pre">{state.lastOutline.slice.content}</pre>
                </>
              )}
            </>
          ) : (
            <>
              <div className="nov-p-banner">{v08.depBanner}</div>
              <div className="nov-p-row" style={{ gap: '8px', flexWrap: 'wrap' }}>
                <div style={{ flex: 2, minWidth: '180px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>{v08.depPackageLabel}</label>
                  <input
                    className="nov-p-input"
                    value={depPackage}
                    placeholder={v08.depPackagePlaceholder}
                    onChange={(e) => setDepPackage(e.target.value)}
                  />
                </div>
                <div style={{ flex: 1, minWidth: '150px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>{v08.depFilterLabel}</label>
                  <input
                    className="nov-p-input"
                    value={depSymbolFilter}
                    placeholder={v08.depFilterPlaceholder}
                    onChange={(e) => setDepSymbolFilter(e.target.value)}
                  />
                </div>
              </div>
              <div className="nov-p-row">
                <button
                  type="button"
                  className="nov-p-btn is-primary"
                  disabled={busy || !depPackage.trim()}
                  onClick={() => void runInspectDep()}
                >
                  {busy ? dict.common.loading : v08.inspectDepBtn}
                </button>
                {lastDep && lastDep.found && (
                  <button
                    type="button"
                    className="nov-p-btn"
                    onClick={() => void copyTextSafe(lastDep.snippet, v08.depCopiedToast)}
                  >
                    {v08.depCopyBtn}
                  </button>
                )}
              </div>

              {lastDep && (
                <div className="nov-p-list">
                  {!lastDep.found ? (
                    <div className="nov-p-item" style={{ fontSize: '12px', color: 'var(--nov-text-1)' }}>
                      {lastDep.note || v08.depNotFound}
                    </div>
                  ) : (
                    <>
                      <div className="nov-p-item">
                        <div className="nov-p-row" style={{ flexWrap: 'wrap', gap: '6px' }}>
                          <strong style={{ fontFamily: 'var(--nov-font-mono)' }}>
                            {lastDep.packageName}
                            {lastDep.version ? `@${lastDep.version}` : ''}
                          </strong>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            <span className="nov-badge is-accent">{lastDep.ecosystem.toUpperCase()}</span>
                            {lastDep.version && (
                              <span className="nov-badge is-offline">
                                {v08.depVersionLabel}: {lastDep.version}
                              </span>
                            )}
                            <span className="nov-badge">
                              {lastDep.totalBytes.toLocaleString()} B
                            </span>
                            {lastDep.truncated && (
                              <span className="nov-badge is-accent">{v08.depTruncatedBadge}</span>
                            )}
                          </div>
                        </div>
                        {lastDep.entryFile && (
                          <div style={{ fontSize: '11.5px', fontFamily: 'var(--nov-font-mono)', color: 'var(--nov-text-1)' }}>
                            {v08.depEntryLabel}: {lastDep.entryFile}
                          </div>
                        )}
                        {lastDep.exportsSummary && (
                          <div style={{ fontSize: '11.5px', color: 'var(--nov-text-2)' }}>
                            {v08.depExportsLabel}: {lastDep.exportsSummary}
                          </div>
                        )}
                      </div>

                      <div style={{ fontSize: '12px', fontWeight: 600 }}>
                        {v08.depSignaturesTitle} ({lastDep.signatures.length})
                      </div>
                      <div className="nov-p-list">
                        {lastDep.signatures.slice(0, 40).map((sig, idx) => (
                          <div
                            key={`${sig.line}-${sig.kind}-${idx}`}
                            className="nov-p-row"
                            style={{ fontSize: '11.5px', fontFamily: 'var(--nov-font-mono)', gap: '8px' }}
                          >
                            <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                              <span className="nov-badge">{sig.kind}</span> {sig.signature}
                            </span>
                            <span style={{ color: 'var(--nov-text-2)', flexShrink: 0 }}>L{sig.line}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {tab === 'compact' && (
        <>
          <section className="nov-p-card">
            <div className="nov-p-row" style={{ flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: '220px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <strong style={{ fontSize: '13px' }}>{v08.autoRtkTitle}</strong>
                  <span className={`nov-badge ${prefs.autoRtk ? 'is-accent' : 'is-offline'}`}>
                    {prefs.autoRtk ? v08.autoRtkOn : v08.autoRtkOff}
                  </span>
                </div>
                <span style={{ fontSize: '11.5px', color: 'var(--nov-text-1)' }}>
                  {v08.autoRtkDesc}
                </span>
              </div>
              <button
                type="button"
                className={`nov-p-btn ${prefs.autoRtk ? '' : 'is-primary'}`}
                disabled={busy}
                onClick={() => void toggleAutoRtk()}
              >
                {prefs.autoRtk ? v08.autoRtkToggleOff : v08.autoRtkToggleOn}
              </button>
            </div>

            <div style={{ fontSize: '12px', fontWeight: 600, marginTop: '4px' }}>
              {v08.hotspotsTitle} ({hotspots.length})
            </div>
            {hotspots.length === 0 ? (
              <div style={{ fontSize: '11.5px', color: 'var(--nov-text-2)' }}>
                {v08.hotspotsEmpty}
              </div>
            ) : (
              <div className="nov-p-list">
                {hotspots.slice(0, 6).map((hs, idx) => (
                  <div key={`${hs.commandPrefix}-${idx}`} className="nov-p-item">
                    <div className="nov-p-row" style={{ flexWrap: 'wrap', gap: '6px' }}>
                      <strong style={{ fontFamily: 'var(--nov-font-mono)', fontSize: '12px' }}>
                        {hs.commandPrefix}
                      </strong>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <span className="nov-badge">
                          {hs.count} {v08.hotspotsRunsUnit}
                        </span>
                        <span className="nov-badge is-accent">
                          ~{hs.estimatedWasteTokens.toLocaleString()} {v08.hotspotsWasteLabel}
                        </span>
                      </div>
                    </div>
                    {hs.lastCommand && hs.lastCommand !== hs.commandPrefix && (
                      <div style={{ fontSize: '11px', fontFamily: 'var(--nov-font-mono)', color: 'var(--nov-text-2)' }}>
                        {hs.lastCommand}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="nov-p-card">
            <div className="nov-p-row">
              <label style={{ fontSize: '12px', fontWeight: 600 }}>{dict.turbo.rawOutputLabel}</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <label htmlFor="nov-turbo-preset" style={{ fontSize: '11.5px', color: 'var(--nov-text-1)' }}>
                  {dict.turbo.presetLabel}
                </label>
                <select
                  id="nov-turbo-preset"
                  className="nov-p-select"
                  style={{ width: 'auto', minWidth: '118px', padding: '5px 9px' }}
                  value={compactPreset}
                  onChange={(e) => setCompactPreset(e.target.value as CompactPresetOption)}
                >
                  {compactPresetChoices.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <textarea
              className="nov-p-textarea"
              value={rawOutput}
              placeholder={dict.turbo.rawOutputPlaceholder}
              onChange={(e) => setRawOutput(e.target.value)}
            />
            <div className="nov-p-row">
              <button
                type="button"
                className="nov-p-btn is-primary"
                disabled={busy || !rawOutput.trim()}
                onClick={() => void runCompact()}
              >
                {busy ? dict.common.loading : dict.turbo.compactBtn}
              </button>
              {lastCompact && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                  {lastCompact.detectedPreset && (
                    <span className="nov-badge is-accent">
                      {dict.turbo.presetLabel}: {lastCompact.detectedPreset.toUpperCase()}
                    </span>
                  )}
                  <span className="nov-badge is-accent">
                    {t(dict.turbo.compressionSaved, { percent: savedRatio })}
                  </span>
                  {typeof lastCompact.linesBefore === 'number' &&
                    typeof lastCompact.linesAfter === 'number' && (
                      <span className="nov-badge">
                        {lastCompact.linesBefore} → {lastCompact.linesAfter}
                      </span>
                    )}
                  <span className="nov-badge is-offline">
                    {t(dict.turbo.savedTokens, {
                      tokens: lastCompact.estimatedSavedTokens,
                      ratio: savedRatio,
                    })}
                  </span>
                </div>
              )}
            </div>

            {lastCompact && (
              <>
                <pre className="nov-p-pre">{lastCompact.summaryText}</pre>
                <div className="nov-p-row">
                  <input
                    className="nov-p-input"
                    style={{ flex: 1 }}
                    value={chunkQuery}
                    placeholder={dict.turbo.queryChunkPlaceholder}
                    onChange={(e) => setChunkQuery(e.target.value)}
                  />
                  <button
                    type="button"
                    className="nov-p-btn"
                    disabled={busy}
                    onClick={() => void runChunkQuery(lastCompact.chunkId)}
                  >
                    {dict.turbo.queryChunkBtn}
                  </button>
                </div>
                {chunkHits && (
                  <pre className="nov-p-pre">
                    {chunkHits.length > 0
                      ? chunkHits.map((h) => `[L${h.matchedLine}]\n${h.snippet}`).join('\n---\n')
                      : dict.common.empty}
                  </pre>
                )}
              </>
            )}
          </section>
        </>
      )}

      {tab === 'pack' && (
        <section className="nov-p-card">
          <div className="nov-p-banner">{v08.packBanner}</div>

          <div className="nov-p-row" style={{ gap: '8px', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '160px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600 }}>{v08.packScopeLabel}</label>
              <input
                className="nov-p-input"
                value={packScope}
                placeholder={v08.packScopePlaceholder}
                onChange={(e) => setPackScope(e.target.value)}
              />
            </div>
            <div style={{ flex: 1, minWidth: '180px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600 }}>{v08.packGlobsLabel}</label>
              <input
                className="nov-p-input"
                value={packGlobsText}
                placeholder={v08.packGlobsPlaceholder}
                onChange={(e) => setPackGlobsText(e.target.value)}
              />
            </div>
          </div>

          <div className="nov-p-row" style={{ flexWrap: 'wrap', gap: '12px' }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={packFromGitDiff}
                onChange={(e) => setPackFromGitDiff(e.target.checked)}
              />
              {v08.packGitDiffLabel}
            </label>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '200px' }}>
              <label htmlFor="nov-turbo-pack-budget" style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>
                {v08.packBudgetLabel}: <strong>{packMaxTokens.toLocaleString()}</strong>
              </label>
              <input
                id="nov-turbo-pack-budget"
                type="range"
                min={1000}
                max={32000}
                step={500}
                value={packMaxTokens}
                onChange={(e) => setPackMaxTokens(Number(e.target.value))}
                style={{ flex: 1 }}
              />
            </div>
          </div>

          <div className="nov-p-row" style={{ flexWrap: 'wrap', gap: '8px' }}>
            <button
              type="button"
              className="nov-p-btn is-primary"
              disabled={busy}
              onClick={() => void runBuildContextPack()}
            >
              {busy ? dict.common.loading : v08.packBuildBtn}
            </button>
            {lastPack && (
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="nov-p-btn"
                  onClick={() => void copyTextSafe(lastPack.markdown, v08.packCopiedToast)}
                >
                  {v08.packCopyBtn}
                </button>
                <button
                  type="button"
                  className="nov-p-btn is-primary"
                  onClick={() => void attachContextPack(lastPack.markdown)}
                >
                  {canUpdateContext ? v08.packAttachBtn : dict.common.copyPrompt}
                </button>
              </div>
            )}
          </div>

          {lastPack && (
            <>
              <div className="nov-p-stat-grid">
                <div className="nov-p-stat">
                  <div className="nov-p-stat-label">{v08.packFilesStat}</div>
                  <div className="nov-p-stat-val">
                    {lastPack.includedFiles}/{lastPack.totalFiles}
                  </div>
                </div>
                <div className="nov-p-stat">
                  <div className="nov-p-stat-label">{v08.packTokensStat}</div>
                  <div className="nov-p-stat-val">
                    ~{lastPack.estimatedTokens.toLocaleString()}
                  </div>
                </div>
                <div className="nov-p-stat">
                  <div className="nov-p-stat-label">{v08.packRedactedStat}</div>
                  <div className="nov-p-stat-val" style={{ color: 'var(--nov-success)' }}>
                    {lastPack.redactionCount}
                  </div>
                </div>
                <div className="nov-p-stat">
                  <div className="nov-p-stat-label">{v08.packSkippedStat}</div>
                  <div className="nov-p-stat-val">
                    {lastPack.skippedSensitive +
                      lastPack.skippedBinary +
                      lastPack.skippedSymlinks +
                      lastPack.skippedOversized}
                  </div>
                </div>
              </div>

              {lastPack.truncated && (
                <div>
                  <span className="nov-badge is-accent">{v08.packTruncatedBadge}</span>
                </div>
              )}

              <div style={{ fontSize: '12px', fontWeight: 600 }}>{v08.packTreeTitle}</div>
              <pre className="nov-p-pre" style={{ maxHeight: '140px' }}>
                {lastPack.tree}
              </pre>

              {lastPack.files.length > 0 && (
                <>
                  <div style={{ fontSize: '12px', fontWeight: 600 }}>
                    {v08.packFilesTitle} ({lastPack.files.length})
                  </div>
                  <div className="nov-p-list">
                    {lastPack.files.slice(0, 20).map((f) => (
                      <div
                        key={f.path}
                        className="nov-p-row"
                        style={{ fontSize: '11.5px', fontFamily: 'var(--nov-font-mono)' }}
                      >
                        <span>{f.path}</span>
                        <span style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          {f.redactions > 0 && (
                            <span className="nov-badge is-accent">-{f.redactions}</span>
                          )}
                          <span className="nov-badge">~{f.estimatedTokens} tok</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div style={{ fontSize: '12px', fontWeight: 600 }}>{v08.packPreviewTitle}</div>
              <pre className="nov-p-pre" style={{ maxHeight: '280px' }}>
                {lastPack.markdown}
              </pre>
            </>
          )}
        </section>
      )}
    </div>
  );
};
