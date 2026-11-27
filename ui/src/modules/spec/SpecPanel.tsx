import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { NovBridge } from '../../bridge.js';
import { useNovI18n, type ResolvedUiLocale } from '../../i18n/index.js';

export interface NovModulePanelProps {
  bridge: NovBridge;
  active: boolean;
  onNotify?: (message: string) => void;
  incomingEvent?: { toolName?: string; structuredContent: Record<string, unknown> } | null;
  onOpenSettings?: (moduleId: 'spec') => void;
}

type SpecStatus = 'draft' | 'approved' | 'completed' | 'archived';
type SpecTaskStatus = 'pending' | 'in_progress' | 'done' | 'blocked';
type SpecTaskComputedState = 'ready' | 'waiting_deps' | 'in_progress' | 'done' | 'blocked';
type SpecMode = 'full' | 'delta';
type SpecDeltaKind = 'added' | 'modified' | 'removed';
type SpecAnnotationKind = 'comment' | 'strike' | 'replace';

interface SpecDeltaItem {
  id: string;
  kind: SpecDeltaKind;
  area?: string;
  text: string;
}

interface SpecRevisionEntry {
  revision: number;
  planMarkdown: string;
  updatedAt: string;
  summary?: string;
}

interface SpecPlanAnnotation {
  id: string;
  revision: number;
  lineStart: number;
  lineEnd: number;
  kind: SpecAnnotationKind;
  note: string;
  suggestedText?: string;
  resolved: boolean;
  createdAt: string;
  resolvedAt?: string;
}

interface SpecRevisionDiffHunk {
  type: 'same' | 'add' | 'del';
  oldLine?: number;
  newLine?: number;
  text: string;
}

interface SpecRevisionDiffResponse {
  specId: string;
  fromRevision: number;
  toRevision: number;
  availableRevisions: number[];
  addedLines: number;
  removedLines: number;
  degraded: boolean;
  hunks: SpecRevisionDiffHunk[];
}

interface SpecTaskView {
  id: string;
  title: string;
  description?: string;
  dependsOn: string[];
  status: SpecTaskStatus;
  note?: string;
  updatedAt?: string;
  computedState?: SpecTaskComputedState;
  unmetDeps?: string[];
  depth?: number;
}

interface SpecDocumentView {
  id: string;
  title: string;
  goal: string;
  mode?: SpecMode;
  deltaItems?: SpecDeltaItem[];
  planMarkdown?: string;
  revision?: number;
  revisions?: SpecRevisionEntry[];
  annotations?: SpecPlanAnnotation[];
  unresolvedAnnotations?: number;
  archivedMemoryId?: string;
  acceptanceCriteria: string[];
  planSteps: string[];
  status: SpecStatus;
  enforcePlanBeforeWrite: boolean;
  requireUiApproval: boolean;
  approvedBy?: string;
  approvedAt?: string;
  approvalNote?: string;
  tasks: SpecTaskView[];
  createdAt?: string;
  updatedAt?: string;
}

interface SpecSummaryItem {
  id: string;
  title: string;
  mode?: SpecMode;
  revision?: number;
  unresolvedAnnotations?: number;
  archivedMemoryId?: string;
  status: SpecStatus;
  enforcePlanBeforeWrite: boolean;
  requireUiApproval: boolean;
  totalTasks: number;
  doneTasks: number;
  readyTasks: number;
  updatedAt?: string;
}

interface SpecStateView {
  mode: string;
  activeSpecId: string | null;
  activeSpec: SpecDocumentView | null;
  specs: SpecSummaryItem[];
  writeLockActive: boolean;
}

interface DraftTaskItem {
  id: string;
  title: string;
  dependsOn: string[];
}

interface DraftDeltaItem {
  id: string;
  kind: SpecDeltaKind;
  area: string;
  text: string;
}

interface NormalizedTaskNode {
  task: SpecTaskView;
  computedState: SpecTaskComputedState;
  unmetDeps: string[];
  depth: number;
  originalIndex: number;
}

interface SpecPanelExtraLabels {
  start: string;
  done: string;
  reset: string;
  addTask: string;
  depsLabel: string;
  planStepsLabel: string;
  specsLabel: string;
  selectSpecHint: string;
  settingsTooltip: string;
  tabReview: string;
  tabCreateDelta: string;
  modeFullBadge: string;
  modeDeltaBadge: string;
  modeFullTitle: string;
  modeFullDesc: string;
  modeDeltaTitle: string;
  modeDeltaDesc: string;
  deltaSectionTitle: string;
  deltaAdded: string;
  deltaModified: string;
  deltaRemoved: string;
  deltaAreaPlaceholder: string;
  deltaTextPlaceholder: string;
  addDeltaBtn: string;
  archiveToMemBtn: string;
  updateMemArchiveBtn: string;
  archivedBadge: string;
  archiveSuccessPrefix: string;
  archiveDemoSuffix: string;
  reviewStatLabel: string;
  unresolvedBadge: string;
  resolvedBadge: string;
  allResolvedHint: string;
  reviewLineHint: string;
  emptyPlanHint: string;
  showResolvedLabel: string;
  toggleDiffBtn: string;
  exitDiffBtn: string;
  diffFromLabel: string;
  diffToLabel: string;
  diffSingleRevHint: string;
  diffNoChangesHint: string;
  diffDegradedNotice: string;
  sendFeedbackBtn: string;
  copyFeedbackBtn: string;
  feedbackSentToast: string;
  feedbackContextToast: string;
  feedbackCopiedToast: string;
  kindComment: string;
  kindStrike: string;
  kindReplace: string;
  selectedRangeLabel: string;
  lineStartLabel: string;
  lineEndLabel: string;
  notePlaceholderComment: string;
  notePlaceholderStrike: string;
  notePlaceholderReplace: string;
  replaceTextLabel: string;
  replaceTextPlaceholder: string;
  submitAnnotationBtn: string;
  cancelBtn: string;
  resolveBtn: string;
  reopenBtn: string;
  suggestedLabel: string;
  detachedAnnotationsTitle: string;
  planMarkdownLabel: string;
  planMarkdownHint: string;
  planMarkdownPlaceholder: string;
  acceptancePlaceholder: string;
  openReviewLink: string;
  annotationAddedToast: string;
}

const ACTION_LABELS: Record<ResolvedUiLocale, SpecPanelExtraLabels> = {
  en: {
    start: 'Start',
    done: 'Done',
    reset: 'Reset',
    addTask: 'Add Task',
    depsLabel: 'Depends on',
    planStepsLabel: 'Plan Steps',
    specsLabel: 'Specs',
    selectSpecHint: 'No active spec selected. Click a spec in the list above to activate it.',
    settingsTooltip: 'Spec module policy & settings',
    tabReview: 'Plan Review',
    tabCreateDelta: 'Create / Delta',
    modeFullBadge: 'FULL',
    modeDeltaBadge: 'DELTA',
    modeFullTitle: 'Full Spec',
    modeFullDesc: 'Greenfield specification with goal, criteria, plan, and task DAG.',
    modeDeltaTitle: 'Brownfield Delta Spec',
    modeDeltaDesc: 'Incremental behavioral diff (ADDED / MODIFIED / REMOVED) on existing code.',
    deltaSectionTitle: 'Behavioral Delta Contract',
    deltaAdded: 'ADDED',
    deltaModified: 'MODIFIED',
    deltaRemoved: 'REMOVED',
    deltaAreaPlaceholder: 'Area (e.g. auth/service)',
    deltaTextPlaceholder: 'Describe added, modified, or removed behavior...',
    addDeltaBtn: 'Add Delta',
    archiveToMemBtn: 'Archive to Memory Graph',
    updateMemArchiveBtn: 'Update Memory Archive',
    archivedBadge: 'Archived in Mem',
    archiveSuccessPrefix: 'Archived spec decisions to memory',
    archiveDemoSuffix: '(demo in-memory)',
    reviewStatLabel: 'Open Reviews',
    unresolvedBadge: 'open',
    resolvedBadge: 'Resolved',
    allResolvedHint: 'All inline plan annotations are resolved.',
    reviewLineHint: 'Click any line number to select a line, or click a second line to select a range for Comment / Strike / Replace.',
    emptyPlanHint: 'No plan Markdown available for this spec yet.',
    showResolvedLabel: 'Show resolved',
    toggleDiffBtn: 'Revision Diff',
    exitDiffBtn: 'Back to Review',
    diffFromLabel: 'From',
    diffToLabel: 'To',
    diffSingleRevHint: 'Only one revision exists so far. Publish a revised plan to compare diffs.',
    diffNoChangesHint: 'Selected revisions have identical plan Markdown.',
    diffDegradedNotice: 'Large document (>600 lines): linear block diff guardrail active.',
    sendFeedbackBtn: 'Send Annotations to Agent',
    copyFeedbackBtn: 'Copy Review Prompt',
    feedbackSentToast: 'Sent structured plan annotations to Agent.',
    feedbackContextToast: 'Attached structured plan annotations to model context.',
    feedbackCopiedToast: 'Copied structured plan annotations to clipboard.',
    kindComment: 'Comment',
    kindStrike: 'Strike / Cut',
    kindReplace: 'Replace',
    selectedRangeLabel: 'Selected lines',
    lineStartLabel: 'Start',
    lineEndLabel: 'End',
    notePlaceholderComment: 'Add review feedback or question for these lines...',
    notePlaceholderStrike: 'Optional reason for cutting this scope...',
    notePlaceholderReplace: 'Why replace these lines?',
    replaceTextLabel: 'Suggested replacement Markdown',
    replaceTextPlaceholder: 'Write the suggested replacement lines...',
    submitAnnotationBtn: 'Add Annotation',
    cancelBtn: 'Cancel',
    resolveBtn: 'Resolve',
    reopenBtn: 'Reopen',
    suggestedLabel: 'Suggested replacement',
    detachedAnnotationsTitle: 'Annotations from earlier line ranges',
    planMarkdownLabel: 'Plan Markdown (optional)',
    planMarkdownHint: 'Leave empty to auto-synthesize clean Markdown from goal, delta items, criteria, and tasks.',
    planMarkdownPlaceholder: '# Implementation Plan\n1. Define schema & migration\n2. Implement core logic & tests',
    acceptancePlaceholder: '- Typecheck passes cleanly\n- Unit tests cover all edge cases',
    openReviewLink: 'Review Plan',
    annotationAddedToast: 'Added inline plan annotation',
  },
  'zh-CN': {
    start: '开始',
    done: '完成',
    reset: '重置',
    addTask: '添加任务',
    depsLabel: '前置依赖',
    planStepsLabel: '实施步骤',
    specsLabel: '规格列表',
    selectSpecHint: '当前未激活规格。请点击上方列表中的规格进行激活。',
    settingsTooltip: 'Spec 模块策略与设置',
    tabReview: '方案审阅台',
    tabCreateDelta: '新建 / Delta',
    modeFullBadge: 'FULL',
    modeDeltaBadge: 'DELTA',
    modeFullTitle: '完整规格（Full Spec）',
    modeFullDesc: '面向新功能或完整模块，定义目标、验收标准、方案文档与任务 DAG。',
    modeDeltaTitle: '存量增量规格（Brownfield Delta）',
    modeDeltaDesc: '面向存量代码演进，以新增 / 修改 / 移除条目精确约束行为变更契约。',
    deltaSectionTitle: '行为增量契约（Delta）',
    deltaAdded: '新增',
    deltaModified: '修改',
    deltaRemoved: '移除',
    deltaAreaPlaceholder: '影响域（如 auth/service）',
    deltaTextPlaceholder: '描述新增、修改或移除的行为契约...',
    addDeltaBtn: '添加条目',
    archiveToMemBtn: '归档至记忆图谱',
    updateMemArchiveBtn: '更新记忆归档',
    archivedBadge: '已归档至记忆',
    archiveSuccessPrefix: '已将规格决策归档至记忆图谱',
    archiveDemoSuffix: '（演示内存模式）',
    reviewStatLabel: '待处理批注',
    unresolvedBadge: '条待处理',
    resolvedBadge: '已解决',
    allResolvedHint: '当前方案的所有行内批注均已解决。',
    reviewLineHint: '点击任意行号选中单行，再点击另一行号即可框选起止范围，添加「批注 / 划删砍范围 / 替换建议」。',
    emptyPlanHint: '当前规格暂无可审阅的方案 Markdown。',
    showResolvedLabel: '显示已解决',
    toggleDiffBtn: '修订版 Diff',
    exitDiffBtn: '返回审阅',
    diffFromLabel: '旧版',
    diffToLabel: '新版',
    diffSingleRevHint: '当前仅有 1 个修订版，更新方案内容后即可查看逐行 Diff。',
    diffNoChangesHint: '所选两个修订版的方案内容完全一致。',
    diffDegradedNotice: '文档超过 600 行，已自动启用线性块级 Diff 护栏。',
    sendFeedbackBtn: '一键打包批注打回 Agent',
    copyFeedbackBtn: '复制批注指令',
    feedbackSentToast: '已将结构化批注返修指令发送给 Agent。',
    feedbackContextToast: '已将结构化批注写入模型上下文。',
    feedbackCopiedToast: '已复制结构化批注返修指令。',
    kindComment: '批注',
    kindStrike: '划删砍范围',
    kindReplace: '替换建议',
    selectedRangeLabel: '已选行范围',
    lineStartLabel: '起始行',
    lineEndLabel: '结束行',
    notePlaceholderComment: '填写针对所选行的审阅意见或问题...',
    notePlaceholderStrike: '可选：说明为何砍掉这部分范围...',
    notePlaceholderReplace: '说明建议替换的原因...',
    replaceTextLabel: '建议替换为（Markdown）',
    replaceTextPlaceholder: '输入建议替换后的文本...',
    submitAnnotationBtn: '提交批注',
    cancelBtn: '取消',
    resolveBtn: '标记解决',
    reopenBtn: '重新打开',
    suggestedLabel: '建议替换为',
    detachedAnnotationsTitle: '旧版行号范围批注',
    planMarkdownLabel: '方案 Markdown（可选）',
    planMarkdownHint: '留空将根据目标、Delta 条目、验收标准与任务自动合成标准 Markdown 供行内审阅。',
    planMarkdownPlaceholder: '# 实施方案\n1. 定义数据结构与迁移脚本\n2. 实现核心逻辑并补齐单测',
    acceptancePlaceholder: '- 类型检查全部通过\n- 单元测试覆盖核心边界条件',
    openReviewLink: '进入审阅',
    annotationAddedToast: '已添加行内方案批注',
  },
  'zh-TW': {
    start: '開始',
    done: '完成',
    reset: '重設',
    addTask: '新增任務',
    depsLabel: '前置相依',
    planStepsLabel: '實作步驟',
    specsLabel: '規格清單',
    selectSpecHint: '目前未啟用規格。請點擊上方清單中的規格以進行啟用。',
    settingsTooltip: 'Spec 模組策略與設定',
    tabReview: '方案審閱台',
    tabCreateDelta: '新建 / Delta',
    modeFullBadge: 'FULL',
    modeDeltaBadge: 'DELTA',
    modeFullTitle: '完整規格（Full Spec）',
    modeFullDesc: '適用於全新功能，完整定義目標、驗收條件、方案文件與任務 DAG。',
    modeDeltaTitle: '存量增量規格（Brownfield Delta）',
    modeDeltaDesc: '適用於既有程式碼演進，以新增 / 修改 / 移除條目精確描述行為差異。',
    deltaSectionTitle: '行為增量契約（Delta）',
    deltaAdded: '新增',
    deltaModified: '修改',
    deltaRemoved: '移除',
    deltaAreaPlaceholder: '影響領域（如 auth/service）',
    deltaTextPlaceholder: '描述新增、修改或移除的行為契約...',
    addDeltaBtn: '新增條目',
    archiveToMemBtn: '歸檔至記憶圖譜',
    updateMemArchiveBtn: '更新記憶歸檔',
    archivedBadge: '已歸檔至記憶',
    archiveSuccessPrefix: '已將規格決策歸檔至記憶圖譜',
    archiveDemoSuffix: '（展示記憶體模式）',
    reviewStatLabel: '待處理批註',
    unresolvedBadge: '則待處理',
    resolvedBadge: '已解決',
    allResolvedHint: '目前方案的所有行內批註皆已解決。',
    reviewLineHint: '點擊任意行號選取單行，再點擊另一行號即可框選起訖範圍，新增「批註 / 劃刪砍範圍 / 替換建議」。',
    emptyPlanHint: '目前規格尚無可審閱的方案 Markdown。',
    showResolvedLabel: '顯示已解決',
    toggleDiffBtn: '修訂版 Diff',
    exitDiffBtn: '返回審閱',
    diffFromLabel: '舊版',
    diffToLabel: '新版',
    diffSingleRevHint: '目前僅有 1 個修訂版，更新方案內容後即可檢視逐行 Diff。',
    diffNoChangesHint: '所選兩個修訂版的方案內容完全一致。',
    diffDegradedNotice: '文件超過 600 行，已自動啟用線性區塊 Diff 護欄。',
    sendFeedbackBtn: '一鍵打包批註打回 Agent',
    copyFeedbackBtn: '複製批註指令',
    feedbackSentToast: '已將結構化批註返修指令傳送給 Agent。',
    feedbackContextToast: '已將結構化批註寫入模型上下文。',
    feedbackCopiedToast: '已複製結構化批註返修指令。',
    kindComment: '批註',
    kindStrike: '劃刪砍範圍',
    kindReplace: '替換建議',
    selectedRangeLabel: '已選行範圍',
    lineStartLabel: '起始行',
    lineEndLabel: '結束行',
    notePlaceholderComment: '填寫針對所選行的審閱意見或問題...',
    notePlaceholderStrike: '可選：說明為何刪減此範圍...',
    notePlaceholderReplace: '說明建議替換的原因...',
    replaceTextLabel: '建議替換為（Markdown）',
    replaceTextPlaceholder: '輸入建議替換後的文字...',
    submitAnnotationBtn: '提交批註',
    cancelBtn: '取消',
    resolveBtn: '標記解決',
    reopenBtn: '重新開啟',
    suggestedLabel: '建議替換為',
    detachedAnnotationsTitle: '舊版行號範圍批註',
    planMarkdownLabel: '方案 Markdown（可選）',
    planMarkdownHint: '留空將依目標、Delta 條目、驗收條件與任務自動合成標準 Markdown 供行內審閱。',
    planMarkdownPlaceholder: '# 實作方案\n1. 定義資料結構與遷移腳本\n2. 實作核心邏輯並補齊單元測試',
    acceptancePlaceholder: '- 型別檢查全數通過\n- 單元測試涵蓋核心邊界情境',
    openReviewLink: '進入審閱',
    annotationAddedToast: '已新增行內方案批註',
  },
  ja: {
    start: '開始',
    done: '完了',
    reset: 'リセット',
    addTask: 'タスク追加',
    depsLabel: '依存先',
    planStepsLabel: '実装ステップ',
    specsLabel: 'Spec 一覧',
    selectSpecHint: 'アクティブな Spec が未選択です。上のリストから Spec をクリックして有効化してください。',
    settingsTooltip: 'Spec モジュールポリシーと設定',
    tabReview: '計画レビュー',
    tabCreateDelta: '作成 / Delta',
    modeFullBadge: 'FULL',
    modeDeltaBadge: 'DELTA',
    modeFullTitle: 'フル Spec',
    modeFullDesc: '新規機能向けに目標・受入基準・計画・タスク DAG を一式定義します。',
    modeDeltaTitle: 'Brownfield Delta Spec',
    modeDeltaDesc: '既存コード向けに 追加 / 変更 / 削除 の振る舞い差分を明確化します。',
    deltaSectionTitle: '振る舞い Delta 契約',
    deltaAdded: '追加',
    deltaModified: '変更',
    deltaRemoved: '削除',
    deltaAreaPlaceholder: '対象領域（例: auth/service）',
    deltaTextPlaceholder: '追加・変更・削除される仕様を記述...',
    addDeltaBtn: 'Delta 追加',
    archiveToMemBtn: 'メモリグラフへアーカイブ',
    updateMemArchiveBtn: 'メモリアーカイブを更新',
    archivedBadge: 'Mem 保存済み',
    archiveSuccessPrefix: 'Spec の意思決定をメモリへ保存しました',
    archiveDemoSuffix: '（デモメモリ動作）',
    reviewStatLabel: '未解決注釈',
    unresolvedBadge: '件未解決',
    resolvedBadge: '解決済み',
    allResolvedHint: 'インライン注釈はすべて解決済みです。',
    reviewLineHint: '行番号をクリックして単一行を選択、もう1行クリックして範囲選択し、コメント / 削除線 / 置換提案を追加できます。',
    emptyPlanHint: 'この Spec には計画 Markdown がまだありません。',
    showResolvedLabel: '解決済みを表示',
    toggleDiffBtn: 'リビジョン Diff',
    exitDiffBtn: 'レビューへ戻る',
    diffFromLabel: '比較元',
    diffToLabel: '比較先',
    diffSingleRevHint: 'リビジョンがまだ 1 件のみです。計画を更新すると Diff を比較できます。',
    diffNoChangesHint: '選択したリビジョン間に差分はありません。',
    diffDegradedNotice: '600 行超のため、線形ブロック Diff ガードレールで表示しています。',
    sendFeedbackBtn: '注釈をまとめて Agent へ差戻し',
    copyFeedbackBtn: 'レビュー指示をコピー',
    feedbackSentToast: '構造化レビュー注釈を Agent へ送信しました。',
    feedbackContextToast: '構造化レビュー注釈をモデルコンテキストへ添付しました。',
    feedbackCopiedToast: '構造化レビュー注釈をクリップボードへコピーしました。',
    kindComment: 'コメント',
    kindStrike: '削除線・削減',
    kindReplace: '置換提案',
    selectedRangeLabel: '選択行',
    lineStartLabel: '開始行',
    lineEndLabel: '終了行',
    notePlaceholderComment: '選択行へのレビューコメントや質問を入力...',
    notePlaceholderStrike: '任意：スコープ削減の理由を入力...',
    notePlaceholderReplace: '置換を提案する理由を入力...',
    replaceTextLabel: '置換候補 Markdown',
    replaceTextPlaceholder: '提案する置換テキストを入力...',
    submitAnnotationBtn: '注釈を追加',
    cancelBtn: 'キャンセル',
    resolveBtn: '解決済みにする',
    reopenBtn: '再オープン',
    suggestedLabel: '置換候補',
    detachedAnnotationsTitle: '旧リビジョン行範囲の注釈',
    planMarkdownLabel: '計画 Markdown（任意）',
    planMarkdownHint: '空欄の場合、目標・Delta・受入基準・タスクから Markdown を自動生成します。',
    planMarkdownPlaceholder: '# 実装計画\n1. スキーマ定義とマイグレーション\n2. コアロジックとテスト実装',
    acceptancePlaceholder: '- 型チェックが通過すること\n- 単体テストが境界条件を網羅すること',
    openReviewLink: '計画をレビュー',
    annotationAddedToast: 'インライン注釈を追加しました',
  },
  ko: {
    start: '시작',
    done: '완료',
    reset: '초기화',
    addTask: '작업 추가',
    depsLabel: '선행 의존',
    planStepsLabel: '실행 단계',
    specsLabel: 'Spec 목록',
    selectSpecHint: '활성화된 Spec이 없습니다. 위 목록에서 Spec을 클릭하여 활성화하세요.',
    settingsTooltip: 'Spec 모듈 정책 및 설정',
    tabReview: '계획 리뷰',
    tabCreateDelta: '생성 / Delta',
    modeFullBadge: 'FULL',
    modeDeltaBadge: 'DELTA',
    modeFullTitle: '전체 Spec (Full)',
    modeFullDesc: '신규 기능을 위해 목표, 인수 기준, 실행 계획, 작업 DAG를 정의합니다.',
    modeDeltaTitle: 'Brownfield Delta Spec',
    modeDeltaDesc: '기존 코드베이스의 추가 / 수정 / 제거 동작 변경 계약을 명시합니다.',
    deltaSectionTitle: '동작 Delta 계약',
    deltaAdded: '추가',
    deltaModified: '수정',
    deltaRemoved: '제거',
    deltaAreaPlaceholder: '영역 (예: auth/service)',
    deltaTextPlaceholder: '추가, 수정 또는 제거될 동작 계약을 입력...',
    addDeltaBtn: 'Delta 추가',
    archiveToMemBtn: '메모리 그래프에 아카이브',
    updateMemArchiveBtn: '메모리 아카이브 갱신',
    archivedBadge: 'Mem 보관됨',
    archiveSuccessPrefix: 'Spec 결정을 메모리에 저장했습니다',
    archiveDemoSuffix: '(데모 메모리 모드)',
    reviewStatLabel: '미해결 주석',
    unresolvedBadge: '건 미해결',
    resolvedBadge: '해결됨',
    allResolvedHint: '모든 인라인 계획 주석이 해결되었습니다.',
    reviewLineHint: '줄 번호를 클릭해 단일 줄을 선택하거나 다른 줄 번호를 클릭해 범위를 지정한 뒤 주석 / 취소선 / 교체 제안을 남기세요.',
    emptyPlanHint: '이 Spec에 아직 계획 Markdown이 없습니다.',
    showResolvedLabel: '해결됨 표시',
    toggleDiffBtn: '리비전 Diff',
    exitDiffBtn: '리뷰로 돌아가기',
    diffFromLabel: '이전 버전',
    diffToLabel: '비교 버전',
    diffSingleRevHint: '아직 리비전이 1개뿐입니다. 계획을 수정하면 줄 단위 Diff를 비교할 수 있습니다.',
    diffNoChangesHint: '선택한 두 리비전의 계획 내용이 동일합니다.',
    diffDegradedNotice: '600줄 초과 문서로 선형 블록 Diff 가드레일이 적용되었습니다.',
    sendFeedbackBtn: '주석 묶어서 Agent로 반려',
    copyFeedbackBtn: '리뷰 프롬프트 복사',
    feedbackSentToast: '구조화된 계획 주석을 Agent로 전송했습니다.',
    feedbackContextToast: '구조화된 계획 주석을 모델 컨텍스트에 첨부했습니다.',
    feedbackCopiedToast: '구조화된 계획 주석을 클립보드에 복사했습니다.',
    kindComment: '코멘트',
    kindStrike: '취소선 / 범위 축소',
    kindReplace: '교체 제안',
    selectedRangeLabel: '선택된 줄',
    lineStartLabel: '시작',
    lineEndLabel: '끝',
    notePlaceholderComment: '선택한 줄에 대한 리뷰 의견이나 질문을 입력...',
    notePlaceholderStrike: '선택 사항: 범위를 제외하는 이유...',
    notePlaceholderReplace: '교체를 제안하는 이유...',
    replaceTextLabel: '교체 제안 Markdown',
    replaceTextPlaceholder: '제안할 교체 내용을 입력...',
    submitAnnotationBtn: '주석 추가',
    cancelBtn: '취소',
    resolveBtn: '해결 완료',
    reopenBtn: '다시 열기',
    suggestedLabel: '교체 제안',
    detachedAnnotationsTitle: '이전 줄 범위 주석',
    planMarkdownLabel: '계획 Markdown (선택)',
    planMarkdownHint: '비워두면 목표, Delta 항목, 인수 기준, 작업으로 Markdown을 자동 생성합니다.',
    planMarkdownPlaceholder: '# 구현 계획\n1. 스키마 및 마이그레이션 정의\n2. 핵심 로직 및 테스트 구현',
    acceptancePlaceholder: '- 타입 체크 통과\n- 단위 테스트로 경계 조건 검증',
    openReviewLink: '계획 리뷰',
    annotationAddedToast: '인라인 계획 주석을 추가했습니다',
  },
  es: {
    start: 'Iniciar',
    done: 'Completar',
    reset: 'Reiniciar',
    addTask: 'Añadir tarea',
    depsLabel: 'Depende de',
    planStepsLabel: 'Pasos del plan',
    specsLabel: 'Specs',
    selectSpecHint: 'No hay ninguna spec activa. Haz clic en una spec de la lista superior para activarla.',
    settingsTooltip: 'Política y ajustes del módulo Spec',
    tabReview: 'Revisión del plan',
    tabCreateDelta: 'Crear / Delta',
    modeFullBadge: 'FULL',
    modeDeltaBadge: 'DELTA',
    modeFullTitle: 'Spec completa',
    modeFullDesc: 'Especificación desde cero con objetivo, criterios, plan y DAG de tareas.',
    modeDeltaTitle: 'Delta Spec (Brownfield)',
    modeDeltaDesc: 'Contrato incremental de comportamiento (AÑADIDO / MODIFICADO / ELIMINADO).',
    deltaSectionTitle: 'Contrato Delta de comportamiento',
    deltaAdded: 'AÑADIDO',
    deltaModified: 'MODIFICADO',
    deltaRemoved: 'ELIMINADO',
    deltaAreaPlaceholder: 'Área (p. ej. auth/service)',
    deltaTextPlaceholder: 'Describe el cambio añadido, modificado o eliminado...',
    addDeltaBtn: 'Añadir Delta',
    archiveToMemBtn: 'Archivar en grafo de memoria',
    updateMemArchiveBtn: 'Actualizar archivo en memoria',
    archivedBadge: 'Archivado en Mem',
    archiveSuccessPrefix: 'Decisiones de la spec archivadas en memoria',
    archiveDemoSuffix: '(demo en memoria)',
    reviewStatLabel: 'Anotaciones abiertas',
    unresolvedBadge: 'abiertas',
    resolvedBadge: 'Resuelta',
    allResolvedHint: 'Todas las anotaciones en línea están resueltas.',
    reviewLineHint: 'Haz clic en un número de línea para seleccionarla, o en otra línea para marcar un rango y añadir Comentario / Tachar / Reemplazar.',
    emptyPlanHint: 'Aún no hay Markdown del plan para esta spec.',
    showResolvedLabel: 'Mostrar resueltas',
    toggleDiffBtn: 'Diff de revisiones',
    exitDiffBtn: 'Volver a revisión',
    diffFromLabel: 'Desde',
    diffToLabel: 'Hasta',
    diffSingleRevHint: 'Solo existe una revisión. Publica una nueva versión para comparar cambios.',
    diffNoChangesHint: 'Las revisiones seleccionadas son idénticas.',
    diffDegradedNotice: 'Documento extenso (>600 líneas): modo de protección lineal activo.',
    sendFeedbackBtn: 'Enviar anotaciones al Agente',
    copyFeedbackBtn: 'Copiar prompt de revisión',
    feedbackSentToast: 'Anotaciones estructuradas enviadas al Agente.',
    feedbackContextToast: 'Anotaciones estructuradas adjuntadas al contexto del modelo.',
    feedbackCopiedToast: 'Prompt de anotaciones copiado al portapapeles.',
    kindComment: 'Comentario',
    kindStrike: 'Tachar alcance',
    kindReplace: 'Reemplazar',
    selectedRangeLabel: 'Líneas seleccionadas',
    lineStartLabel: 'Inicio',
    lineEndLabel: 'Fin',
    notePlaceholderComment: 'Escribe comentarios o preguntas sobre estas líneas...',
    notePlaceholderStrike: 'Opcional: motivo para recortar este alcance...',
    notePlaceholderReplace: '¿Por qué reemplazar estas líneas?',
    replaceTextLabel: 'Markdown de reemplazo sugerido',
    replaceTextPlaceholder: 'Escribe las líneas de reemplazo sugeridas...',
    submitAnnotationBtn: 'Guardar anotación',
    cancelBtn: 'Cancelar',
    resolveBtn: 'Resolver',
    reopenBtn: 'Reabrir',
    suggestedLabel: 'Reemplazo sugerido',
    detachedAnnotationsTitle: 'Anotaciones de rangos anteriores',
    planMarkdownLabel: 'Plan en Markdown (opcional)',
    planMarkdownHint: 'Déjalo vacío para sintetizar Markdown limpio a partir del objetivo, Delta, criterios y tareas.',
    planMarkdownPlaceholder: '# Plan de implementación\n1. Definir esquema y migración\n2. Implementar lógica y pruebas',
    acceptancePlaceholder: '- Verificación de tipos sin errores\n- Pruebas unitarias en casos límite',
    openReviewLink: 'Revisar plan',
    annotationAddedToast: 'Anotación en línea añadida',
  },
  fr: {
    start: 'Démarrer',
    done: 'Terminer',
    reset: 'Réinitialiser',
    addTask: 'Ajouter tâche',
    depsLabel: 'Dépend de',
    planStepsLabel: 'Étapes du plan',
    specsLabel: 'Specs',
    selectSpecHint: 'Aucune spec active. Cliquez sur une spec dans la liste ci-dessus pour l’activer.',
    settingsTooltip: 'Politique et réglages du module Spec',
    tabReview: 'Revue du plan',
    tabCreateDelta: 'Créer / Delta',
    modeFullBadge: 'FULL',
    modeDeltaBadge: 'DELTA',
    modeFullTitle: 'Spec complète',
    modeFullDesc: 'Spécification complète avec objectif, critères, plan et DAG de tâches.',
    modeDeltaTitle: 'Delta Spec (Brownfield)',
    modeDeltaDesc: 'Diff comportemental incrémental (AJOUTÉ / MODIFIÉ / SUPPRIMÉ) sur l’existant.',
    deltaSectionTitle: 'Contrat Delta comportemental',
    deltaAdded: 'AJOUTÉ',
    deltaModified: 'MODIFIÉ',
    deltaRemoved: 'SUPPRIMÉ',
    deltaAreaPlaceholder: 'Zone (ex. auth/service)',
    deltaTextPlaceholder: 'Décrivez le comportement ajouté, modifié ou supprimé...',
    addDeltaBtn: 'Ajouter Delta',
    archiveToMemBtn: 'Archiver dans le graphe mémoire',
    updateMemArchiveBtn: 'Mettre à jour l’archive mémoire',
    archivedBadge: 'Archivé dans Mem',
    archiveSuccessPrefix: 'Décisions de la spec archivées en mémoire',
    archiveDemoSuffix: '(démo en mémoire)',
    reviewStatLabel: 'Annotations ouvertes',
    unresolvedBadge: 'ouvertes',
    resolvedBadge: 'Résolue',
    allResolvedHint: 'Toutes les annotations du plan sont résolues.',
    reviewLineHint: 'Cliquez sur un numéro de ligne pour la sélectionner, ou sur une seconde ligne pour définir une plage (Commenter / Barrer / Remplacer).',
    emptyPlanHint: 'Aucun Markdown de plan disponible pour cette spec.',
    showResolvedLabel: 'Afficher résolues',
    toggleDiffBtn: 'Diff des révisions',
    exitDiffBtn: 'Retour à la revue',
    diffFromLabel: 'De',
    diffToLabel: 'À',
    diffSingleRevHint: 'Une seule révision existe pour le moment. Publiez une révision pour comparer.',
    diffNoChangesHint: 'Les révisions sélectionnées sont identiques.',
    diffDegradedNotice: 'Document volumineux (>600 lignes) : garde-fou de diff linéaire actif.',
    sendFeedbackBtn: 'Renvoyer les annotations à l’Agent',
    copyFeedbackBtn: 'Copier le prompt de revue',
    feedbackSentToast: 'Annotations structurées envoyées à l’Agent.',
    feedbackContextToast: 'Annotations structurées ajoutées au contexte du modèle.',
    feedbackCopiedToast: 'Prompt d’annotations copié dans le presse-papiers.',
    kindComment: 'Commentaire',
    kindStrike: 'Barrer / Réduire',
    kindReplace: 'Remplacer',
    selectedRangeLabel: 'Lignes sélectionnées',
    lineStartLabel: 'Début',
    lineEndLabel: 'Fin',
    notePlaceholderComment: 'Ajoutez un retour ou une question sur ces lignes...',
    notePlaceholderStrike: 'Optionnel : raison du retrait de ce périmètre...',
    notePlaceholderReplace: 'Pourquoi remplacer ces lignes ?',
    replaceTextLabel: 'Markdown de remplacement suggéré',
    replaceTextPlaceholder: 'Saisissez le remplacement proposé...',
    submitAnnotationBtn: 'Ajouter l’annotation',
    cancelBtn: 'Annuler',
    resolveBtn: 'Résoudre',
    reopenBtn: 'Rouvrir',
    suggestedLabel: 'Remplacement suggéré',
    detachedAnnotationsTitle: 'Annotations d’anciennes plages de lignes',
    planMarkdownLabel: 'Plan Markdown (optionnel)',
    planMarkdownHint: 'Laissez vide pour synthétiser automatiquement le Markdown depuis l’objectif, les deltas, les critères et les tâches.',
    planMarkdownPlaceholder: '# Plan d’implémentation\n1. Définir le schéma et la migration\n2. Implémenter la logique et les tests',
    acceptancePlaceholder: '- Vérification de types réussie\n- Tests unitaires couvrant les cas limites',
    openReviewLink: 'Revoir le plan',
    annotationAddedToast: 'Annotation en ligne ajoutée',
  },
  de: {
    start: 'Starten',
    done: 'Erledigt',
    reset: 'Zurücksetzen',
    addTask: 'Aufgabe hinzufügen',
    depsLabel: 'Hängt ab von',
    planStepsLabel: 'Planschritte',
    specsLabel: 'Specs',
    selectSpecHint: 'Keine aktive Spec ausgewählt. Klicken Sie oben in der Liste auf eine Spec, um sie zu aktivieren.',
    settingsTooltip: 'Spec-Modulrichtlinien & Einstellungen',
    tabReview: 'Plan-Review',
    tabCreateDelta: 'Erstellen / Delta',
    modeFullBadge: 'FULL',
    modeDeltaBadge: 'DELTA',
    modeFullTitle: 'Vollständige Spec',
    modeFullDesc: 'Vollständige Spezifikation mit Ziel, Akzeptanzkriterien, Plan und Task-DAG.',
    modeDeltaTitle: 'Brownfield-Delta-Spec',
    modeDeltaDesc: 'Inkrementeller Verhaltensvertrag (HINZUGEFÜGT / GEÄNDERT / ENTFERNT) für Bestandscode.',
    deltaSectionTitle: 'Verhaltens-Delta-Vertrag',
    deltaAdded: 'HINZUGEFÜGT',
    deltaModified: 'GEÄNDERT',
    deltaRemoved: 'ENTFERNT',
    deltaAreaPlaceholder: 'Bereich (z. B. auth/service)',
    deltaTextPlaceholder: 'Hinzugefügtes, geändertes oder entferntes Verhalten beschreiben...',
    addDeltaBtn: 'Delta hinzufügen',
    archiveToMemBtn: 'Im Memory-Graph archivieren',
    updateMemArchiveBtn: 'Memory-Archiv aktualisieren',
    archivedBadge: 'In Mem archiviert',
    archiveSuccessPrefix: 'Spec-Entscheidungen im Memory archiviert',
    archiveDemoSuffix: '(Demo im Speicher)',
    reviewStatLabel: 'Offene Reviews',
    unresolvedBadge: 'offen',
    resolvedBadge: 'Erledigt',
    allResolvedHint: 'Alle Inline-Plananmerkungen sind erledigt.',
    reviewLineHint: 'Klicken Sie eine Zeilennummer an (oder eine zweite für einen Bereich), um Kommentar / Streichen / Ersetzen hinzuzufügen.',
    emptyPlanHint: 'Für diese Spec ist noch kein Plan-Markdown vorhanden.',
    showResolvedLabel: 'Erledigte anzeigen',
    toggleDiffBtn: 'Revisions-Diff',
    exitDiffBtn: 'Zurück zum Review',
    diffFromLabel: 'Von',
    diffToLabel: 'Bis',
    diffSingleRevHint: 'Bisher existiert nur eine Revision. Veröffentlichen Sie eine neue Revision für den Diff-Vergleich.',
    diffNoChangesHint: 'Die ausgewählten Revisionen sind identisch.',
    diffDegradedNotice: 'Großes Dokument (>600 Zeilen): linearer Block-Diff-Schutz aktiv.',
    sendFeedbackBtn: 'Anmerkungen an Agent senden',
    copyFeedbackBtn: 'Review-Prompt kopieren',
    feedbackSentToast: 'Strukturierte Plananmerkungen an den Agent gesendet.',
    feedbackContextToast: 'Strukturierte Plananmerkungen dem Modellkontext hinzugefügt.',
    feedbackCopiedToast: 'Review-Prompt in die Zwischenablage kopiert.',
    kindComment: 'Kommentar',
    kindStrike: 'Streichen / Kürzen',
    kindReplace: 'Ersetzen',
    selectedRangeLabel: 'Gewählte Zeilen',
    lineStartLabel: 'Start',
    lineEndLabel: 'Ende',
    notePlaceholderComment: 'Review-Kommentar oder Frage zu diesen Zeilen...',
    notePlaceholderStrike: 'Optional: Grund für das Streichen dieses Umfangs...',
    notePlaceholderReplace: 'Warum sollen diese Zeilen ersetzt werden?',
    replaceTextLabel: 'Vorgeschlagener Ersatz (Markdown)',
    replaceTextPlaceholder: 'Vorgeschlagene Ersatzzeilen eingeben...',
    submitAnnotationBtn: 'Anmerkung speichern',
    cancelBtn: 'Abbrechen',
    resolveBtn: 'Erledigen',
    reopenBtn: 'Wieder öffnen',
    suggestedLabel: 'Vorgeschlagener Ersatz',
    detachedAnnotationsTitle: 'Anmerkungen aus älteren Zeilenbereichen',
    planMarkdownLabel: 'Plan-Markdown (optional)',
    planMarkdownHint: 'Leer lassen, um Markdown automatisch aus Ziel, Deltas, Kriterien und Aufgaben zu erzeugen.',
    planMarkdownPlaceholder: '# Umsetzungsplan\n1. Schema & Migration definieren\n2. Kernlogik und Tests umsetzen',
    acceptancePlaceholder: '- Typecheck fehlerfrei\n- Unit-Tests decken Randfälle ab',
    openReviewLink: 'Plan prüfen',
    annotationAddedToast: 'Inline-Plananmerkung hinzugefügt',
  },
};

function computeDagNodes(tasks: readonly SpecTaskView[]): NormalizedTaskNode[] {
  const byId = new Map<string, SpecTaskView>();
  for (const task of tasks) {
    byId.set(task.id, task);
  }

  const depthMemo = new Map<string, number>();
  const resolveDepth = (id: string, stack: Set<string>): number => {
    if (depthMemo.has(id)) return depthMemo.get(id)!;
    const item = byId.get(id);
    if (!item || !Array.isArray(item.dependsOn) || item.dependsOn.length === 0) {
      depthMemo.set(id, 0);
      return 0;
    }
    if (stack.has(id)) return 0;
    stack.add(id);
    let maxParent = -1;
    for (const depId of item.dependsOn) {
      if (byId.has(depId)) {
        maxParent = Math.max(maxParent, resolveDepth(depId, stack));
      }
    }
    stack.delete(id);
    const depth = maxParent + 1;
    depthMemo.set(id, depth);
    return depth;
  };

  const nodes: NormalizedTaskNode[] = tasks.map((task, idx) => {
    const deps = Array.isArray(task.dependsOn) ? task.dependsOn : [];
    const unmetDeps = Array.isArray(task.unmetDeps)
      ? task.unmetDeps
      : deps.filter((depId) => {
          const parent = byId.get(depId);
          return parent ? parent.status !== 'done' : false;
        });

    let computedState: SpecTaskComputedState;
    if (task.computedState) {
      computedState = task.computedState;
    } else if (task.status === 'done') {
      computedState = 'done';
    } else if (task.status === 'in_progress') {
      computedState = 'in_progress';
    } else if (task.status === 'blocked') {
      computedState = 'blocked';
    } else {
      computedState = unmetDeps.length > 0 ? 'waiting_deps' : 'ready';
    }

    const depth =
      typeof task.depth === 'number' && Number.isFinite(task.depth) && task.depth >= 0
        ? Math.floor(task.depth)
        : resolveDepth(task.id, new Set<string>());

    return {
      task: { ...task, dependsOn: deps },
      computedState,
      unmetDeps,
      depth,
      originalIndex: idx,
    };
  });

  nodes.sort((a, b) => a.depth - b.depth || a.originalIndex - b.originalIndex);
  return nodes;
}

function wouldCreateDraftCycle(
  tasks: readonly DraftTaskItem[],
  sourceId: string,
  candidateDepId: string,
): boolean {
  if (sourceId === candidateDepId) return true;
  const byId = new Map<string, DraftTaskItem>();
  for (const t of tasks) byId.set(t.id, t);

  const visited = new Set<string>();
  const queue: string[] = [candidateDepId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === sourceId) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const item = byId.get(cur);
    if (item) {
      for (const nextDep of item.dependsOn) {
        if (!visited.has(nextDep)) queue.push(nextDep);
      }
    }
  }
  return false;
}

function splitMarkdownLinesClient(md: string): string[] {
  if (!md) return [];
  return md.replace(/\r\n?/g, '\n').split('\n');
}

function buildClientFeedbackPrompt(spec: SpecDocumentView): string {
  const annotations = Array.isArray(spec.annotations) ? spec.annotations : [];
  const unresolved = annotations
    .filter((a) => !a.resolved)
    .sort((a, b) => a.lineStart - b.lineStart || a.lineEnd - b.lineEnd || a.createdAt.localeCompare(b.createdAt));

  const rev = spec.revision ?? 1;
  const specMode: SpecMode = spec.mode === 'delta' ? 'delta' : 'full';
  const lines: string[] = [
    `# Spec Plan Revision Request — "${spec.title}"`,
    `- Spec ID: \`${spec.id}\``,
    `- Mode: ${specMode === 'delta' ? 'Brownfield Delta Spec' : 'Full Spec'}`,
    `- Current Revision: v${rev} -> Target Revision: v${rev + 1}`,
    `- Unresolved Annotations: ${unresolved.length}`,
  ];

  if (unresolved.length === 0) {
    lines.push('');
    lines.push('There are currently no unresolved inline annotations on this plan.');
    return lines.join('\n');
  }

  const mdLines = splitMarkdownLinesClient(spec.planMarkdown ?? '');
  lines.push('');
  lines.push('## Inline Review Feedback');

  unresolved.forEach((ann, idx) => {
    const lineRange = ann.lineStart === ann.lineEnd ? `L${ann.lineStart}` : `L${ann.lineStart}-L${ann.lineEnd}`;
    const kindLabel =
      ann.kind === 'strike'
        ? 'STRIKE / CUT SCOPE'
        : ann.kind === 'replace'
          ? 'REPLACE SUGGESTION'
          : 'COMMENT';

    lines.push('');
    lines.push(`### ${idx + 1}. [${kindLabel}] ${lineRange} (ann: \`${ann.id}\`, on v${ann.revision})`);

    const startIdx = Math.max(0, ann.lineStart - 1);
    const endIdx = Math.min(mdLines.length, ann.lineEnd);
    if (startIdx < endIdx) {
      lines.push('Original excerpt:');
      lines.push('```markdown');
      for (let i = startIdx; i < endIdx; i += 1) {
        lines.push(`${i + 1} | ${mdLines[i]}`);
      }
      lines.push('```');
    }

    if (ann.note) {
      lines.push(`Reviewer note: ${ann.note}`);
    }
    if (ann.kind === 'strike') {
      lines.push('Action: Remove or cut the struck scope from the plan.');
    }
    if (ann.kind === 'replace' && ann.suggestedText) {
      lines.push('Suggested replacement:');
      lines.push('```markdown');
      lines.push(ann.suggestedText);
      lines.push('```');
    }
  });

  const deltaItems = Array.isArray(spec.deltaItems) ? spec.deltaItems : [];
  if (deltaItems.length > 0) {
    lines.push('');
    lines.push('## Current Behavioral Delta Contract');
    for (const item of deltaItems) {
      const area = item.area ? ` (${item.area})` : '';
      lines.push(`- [${item.kind.toUpperCase()}]${area} ${item.text}`);
    }
  }

  lines.push('');
  lines.push('## Required Next Step');
  lines.push(
    `Address all ${unresolved.length} inline annotation(s) above and publish revision v${rev + 1} by calling \`spec_create_or_update\` with \`id: "${spec.id}"\`, updated \`planMarkdown\`, and a concise \`revisionSummary\`. Wait for user review before requesting approval.`,
  );

  return lines.join('\n');
}

function getSpecStatusBadgeProps(
  status: SpecStatus,
  labels: {
    statusDraft: string;
    statusApproved: string;
    statusCompleted: string;
    statusArchived: string;
  },
): { text: string; className: string; style?: React.CSSProperties } {
  switch (status) {
    case 'approved':
      return { text: labels.statusApproved, className: 'nov-badge is-offline' };
    case 'completed':
      return { text: labels.statusCompleted, className: 'nov-badge is-accent' };
    case 'archived':
      return { text: labels.statusArchived, className: 'nov-badge' };
    case 'draft':
    default:
      return { text: labels.statusDraft, className: 'nov-badge is-network' };
  }
}

function getTaskStateBadgeProps(
  state: SpecTaskComputedState,
  labels: {
    readyBadge: string;
    waitingBadge: string;
    doneBadge: string;
    inProgressBadge: string;
    blockedBadge: string;
  },
): { text: string; className: string; style?: React.CSSProperties } {
  switch (state) {
    case 'done':
      return { text: labels.doneBadge, className: 'nov-badge is-offline' };
    case 'in_progress':
      return { text: labels.inProgressBadge, className: 'nov-badge is-accent' };
    case 'blocked':
      return {
        text: labels.blockedBadge,
        className: 'nov-badge',
        style: {
          background: 'var(--nov-danger-soft)',
          color: 'var(--nov-danger)',
          borderColor: 'var(--nov-danger)',
        },
      };
    case 'waiting_deps':
      return { text: labels.waitingBadge, className: 'nov-badge is-network' };
    case 'ready':
    default:
      return {
        text: labels.readyBadge,
        className: 'nov-badge',
        style: {
          background: 'var(--nov-success-soft)',
          color: 'var(--nov-success)',
          borderColor: 'var(--nov-success)',
        },
      };
  }
}

function getDeltaKindStyle(kind: SpecDeltaKind): React.CSSProperties {
  if (kind === 'added') {
    return {
      background: 'var(--nov-success-soft)',
      color: 'var(--nov-success)',
      borderColor: 'var(--nov-success)',
    };
  }
  if (kind === 'removed') {
    return {
      background: 'var(--nov-danger-soft)',
      color: 'var(--nov-danger)',
      borderColor: 'var(--nov-danger)',
    };
  }
  return {
    background: 'var(--nov-warn-soft)',
    color: 'var(--nov-warn)',
    borderColor: 'var(--nov-warn)',
  };
}

function getAnnotationKindStyle(kind: SpecAnnotationKind): React.CSSProperties {
  if (kind === 'strike') {
    return {
      background: 'var(--nov-danger-soft)',
      color: 'var(--nov-danger)',
      borderColor: 'var(--nov-danger)',
    };
  }
  if (kind === 'replace') {
    return {
      background: 'var(--nov-warn-soft)',
      color: 'var(--nov-warn)',
      borderColor: 'var(--nov-warn)',
    };
  }
  return {
    background: 'var(--nov-accent-soft)',
    color: 'var(--nov-accent)',
    borderColor: 'var(--nov-accent)',
  };
}

export const SpecPanel: React.FC<NovModulePanelProps> = ({
  bridge,
  active,
  onNotify,
  incomingEvent,
  onOpenSettings,
}) => {
  const { dict, locale } = useNovI18n();
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
  const canSendMessage = caps.message;
  const sDict = dict.panels.spec;
  const actions = ACTION_LABELS[locale] ?? ACTION_LABELS.en;

  const [tab, setTab] = useState<'board' | 'review' | 'create'>('board');
  const [state, setState] = useState<SpecStateView | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // Plan Review (Plannotator) state
  const [selStart, setSelStart] = useState<number | null>(null);
  const [selEnd, setSelEnd] = useState<number | null>(null);
  const [annKind, setAnnKind] = useState<SpecAnnotationKind>('comment');
  const [annNote, setAnnNote] = useState('');
  const [annSuggestedText, setAnnSuggestedText] = useState('');
  const [showResolved, setShowResolved] = useState(true);

  // Revision diff state
  const [diffMode, setDiffMode] = useState(false);
  const [diffFromRev, setDiffFromRev] = useState<number | undefined>(undefined);
  const [diffToRev, setDiffToRev] = useState<number | undefined>(undefined);
  const [diffResult, setDiffResult] = useState<SpecRevisionDiffResponse | null>(null);

  // New spec / delta creation draft form
  const [draftMode, setDraftMode] = useState<SpecMode>('full');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftGoal, setDraftGoal] = useState('');
  const [draftPlanMarkdown, setDraftPlanMarkdown] = useState('');
  const [draftAcceptance, setDraftAcceptance] = useState('');
  const [draftEnforceLock, setDraftEnforceLock] = useState(true);
  const [draftRequireUiApproval, setDraftRequireUiApproval] = useState(false);
  const [newDeltaKind, setNewDeltaKind] = useState<SpecDeltaKind>('added');
  const [newDeltaArea, setNewDeltaArea] = useState('');
  const [newDeltaText, setNewDeltaText] = useState('');
  const [draftDeltas, setDraftDeltas] = useState<DraftDeltaItem[]>([]);
  const [deltaSeq, setDeltaSeq] = useState(1);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [draftTasks, setDraftTasks] = useState<DraftTaskItem[]>([]);
  const [taskSeq, setTaskSeq] = useState(1);

  const loadState = useCallback(async () => {
    try {
      const res = await bridge.callTool<SpecStateView>('app_spec_get_state', {});
      setState(res);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    }
  }, [bridge, onNotify]);

  useEffect(() => {
    if (active) {
      void loadState();
    }
  }, [active, loadState]);

  useEffect(() => {
    if (!active || !incomingEvent) return;
    const tool = incomingEvent.toolName ?? '';
    const mod = incomingEvent.structuredContent?.novModule;
    if (tool.startsWith('spec_') || tool.startsWith('app_spec_') || mod === 'spec') {
      void loadState();
    }
  }, [active, incomingEvent, loadState]);

  const activeSpec = state?.activeSpec ?? null;
  const specs = Array.isArray(state?.specs) ? state.specs : [];
  const writeLockActive = Boolean(state?.writeLockActive);
  const isBusy = busyAction !== null;

  // Reset line selection & diff view when active spec changes
  const activeSpecIdRef = activeSpec?.id ?? null;
  useEffect(() => {
    setSelStart(null);
    setSelEnd(null);
    setAnnNote('');
    setAnnSuggestedText('');
    setDiffMode(false);
    setDiffResult(null);
    setDiffFromRev(undefined);
    setDiffToRev(undefined);
  }, [activeSpecIdRef]);

  const dagNodes = useMemo(
    () => (activeSpec && Array.isArray(activeSpec.tasks) ? computeDagNodes(activeSpec.tasks) : []),
    [activeSpec],
  );

  const taskTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of dagNodes) {
      map.set(node.task.id, node.task.title);
    }
    return map;
  }, [dagNodes]);

  const taskStatusById = useMemo(() => {
    const map = new Map<string, SpecTaskStatus>();
    for (const node of dagNodes) {
      map.set(node.task.id, node.task.status);
    }
    return map;
  }, [dagNodes]);

  const dagCounts = useMemo(() => {
    let ready = 0;
    let inProgress = 0;
    let done = 0;
    for (const node of dagNodes) {
      if (node.computedState === 'ready') ready += 1;
      else if (node.computedState === 'in_progress') inProgress += 1;
      else if (node.computedState === 'done') done += 1;
    }
    return { ready, inProgress, done };
  }, [dagNodes]);

  const planLines = useMemo(
    () => splitMarkdownLinesClient(activeSpec?.planMarkdown ?? ''),
    [activeSpec?.planMarkdown],
  );

  const allAnnotations = useMemo(
    () => (Array.isArray(activeSpec?.annotations) ? activeSpec.annotations : []),
    [activeSpec?.annotations],
  );

  const unresolvedCount = useMemo(
    () =>
      typeof activeSpec?.unresolvedAnnotations === 'number'
        ? activeSpec.unresolvedAnnotations
        : allAnnotations.filter((a) => !a.resolved).length,
    [activeSpec?.unresolvedAnnotations, allAnnotations],
  );

  const visibleAnnotations = useMemo(
    () => (showResolved ? allAnnotations : allAnnotations.filter((a) => !a.resolved)),
    [allAnnotations, showResolved],
  );

  const availableRevisions = useMemo(() => {
    if (!activeSpec) return [] as number[];
    const list = new Set<number>();
    if (typeof activeSpec.revision === 'number' && activeSpec.revision >= 1) {
      list.add(activeSpec.revision);
    }
    if (Array.isArray(activeSpec.revisions)) {
      for (const r of activeSpec.revisions) {
        if (typeof r.revision === 'number' && r.revision >= 1) {
          list.add(r.revision);
        }
      }
    }
    return Array.from(list).sort((a, b) => a - b);
  }, [activeSpec]);

  const lineDecorations = useMemo(() => {
    const strikeLines = new Set<number>();
    const replaceLines = new Set<number>();
    const commentLines = new Set<number>();
    const byEndLine = new Map<number, SpecPlanAnnotation[]>();
    const detached: SpecPlanAnnotation[] = [];

    for (const ann of visibleAnnotations) {
      if (!ann.resolved) {
        for (let ln = ann.lineStart; ln <= ann.lineEnd; ln += 1) {
          if (ann.kind === 'strike') strikeLines.add(ln);
          else if (ann.kind === 'replace') replaceLines.add(ln);
          else commentLines.add(ln);
        }
      }
      if (ann.lineEnd >= 1 && ann.lineEnd <= planLines.length) {
        const list = byEndLine.get(ann.lineEnd) ?? [];
        list.push(ann);
        byEndLine.set(ann.lineEnd, list);
      } else {
        detached.push(ann);
      }
    }

    return { strikeLines, replaceLines, commentLines, byEndLine, detached };
  }, [visibleAnnotations, planLines.length]);

  const feedbackPrompt = useMemo(
    () => (activeSpec ? buildClientFeedbackPrompt(activeSpec) : ''),
    [activeSpec],
  );

  const loadRevisionDiff = useCallback(
    async (specId: string, fromRev?: number, toRev?: number) => {
      setBusyAction('diff');
      try {
        const res = await bridge.callTool<SpecRevisionDiffResponse>('app_spec_diff_revisions', {
          specId,
          ...(typeof fromRev === 'number' ? { fromRevision: fromRev } : {}),
          ...(typeof toRev === 'number' ? { toRevision: toRev } : {}),
        });
        setDiffResult(res);
        setDiffFromRev(res.fromRevision);
        setDiffToRev(res.toRevision);
        setDiffMode(true);
      } catch (err) {
        onNotify?.(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyAction(null);
      }
    },
    [bridge, onNotify],
  );

  const handleSetSpecStatus = async (params: {
    specId: string;
    status: SpecStatus;
    enforcePlanBeforeWrite?: boolean;
    requireUiApproval?: boolean;
    setActive?: boolean;
    actionKey: string;
    notifyText?: string;
  }) => {
    if (busyAction) return;
    setBusyAction(params.actionKey);
    try {
      const res = await bridge.callTool<{ spec: SpecDocumentView; state: SpecStateView }>(
        'app_spec_set_status',
        {
          specId: params.specId,
          status: params.status,
          ...(typeof params.enforcePlanBeforeWrite === 'boolean'
            ? { enforcePlanBeforeWrite: params.enforcePlanBeforeWrite }
            : {}),
          ...(typeof params.requireUiApproval === 'boolean'
            ? { requireUiApproval: params.requireUiApproval }
            : {}),
          ...(typeof params.setActive === 'boolean' ? { setActive: params.setActive } : {}),
        },
      );
      if (res.state) {
        setState(res.state);
      } else {
        await loadState();
      }
      if (params.notifyText) {
        onNotify?.(params.notifyText);
      }
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleUpdateTask = async (taskId: string, status: SpecTaskStatus) => {
    if (!activeSpec || busyAction) return;
    setBusyAction(`task:${taskId}:${status}`);
    try {
      const res = await bridge.callTool<{ task: SpecTaskView; state: SpecStateView }>(
        'app_spec_update_task',
        {
          specId: activeSpec.id,
          taskId,
          status,
        },
      );
      if (res.state) {
        setState(res.state);
      } else {
        await loadState();
      }
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleArchiveToMem = async () => {
    if (!activeSpec || busyAction) return;
    setBusyAction('archive-mem');
    try {
      const res = await bridge.callTool<{
        memoryId: string;
        demoSimulated?: boolean;
        spec?: SpecDocumentView;
        state?: SpecStateView;
      }>('app_spec_archive_to_mem', {
        specId: activeSpec.id,
      });
      if (res.state) {
        setState(res.state);
      } else {
        await loadState();
      }
      const suffix = res.demoSimulated ? ` ${actions.archiveDemoSuffix}` : '';
      onNotify?.(`${actions.archiveSuccessPrefix}: ${res.memoryId}${suffix}`);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleSelectPlanLine = (lineNumber: number, shiftKey: boolean) => {
    if (selStart === null) {
      setSelStart(lineNumber);
      setSelEnd(lineNumber);
      setAnnSuggestedText(planLines[lineNumber - 1] ?? '');
      return;
    }
    if (shiftKey || (selStart === selEnd && lineNumber !== selStart)) {
      const nextStart = Math.min(selStart, lineNumber);
      const nextEnd = Math.max(selStart, lineNumber);
      setSelStart(nextStart);
      setSelEnd(nextEnd);
      setAnnSuggestedText(planLines.slice(nextStart - 1, nextEnd).join('\n'));
      return;
    }
    if (lineNumber === selStart && lineNumber === selEnd) {
      setSelStart(null);
      setSelEnd(null);
      return;
    }
    setSelStart(lineNumber);
    setSelEnd(lineNumber);
    setAnnSuggestedText(planLines[lineNumber - 1] ?? '');
  };

  const handleSubmitAnnotation = async () => {
    if (!activeSpec || selStart === null || selEnd === null || busyAction) return;
    const start = Math.min(selStart, selEnd);
    const end = Math.max(selStart, selEnd);
    const trimmedNote = annNote.trim();
    const trimmedSuggested = annSuggestedText.trim();

    if (annKind === 'comment' && !trimmedNote) return;
    if (annKind === 'replace' && !trimmedSuggested) return;

    setBusyAction('annotate');
    try {
      const res = await bridge.callTool<{
        annotation: SpecPlanAnnotation;
        spec: SpecDocumentView;
        state: SpecStateView;
      }>('app_spec_annotate', {
        specId: activeSpec.id,
        lineStart: start,
        lineEnd: end,
        kind: annKind,
        ...(trimmedNote ? { note: trimmedNote } : {}),
        ...(annKind === 'replace' ? { suggestedText: trimmedSuggested } : {}),
      });
      if (res.state) {
        setState(res.state);
      } else {
        await loadState();
      }
      setSelStart(null);
      setSelEnd(null);
      setAnnNote('');
      setAnnSuggestedText('');
      onNotify?.(`${actions.annotationAddedToast} (L${start}${end > start ? `-L${end}` : ''})`);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleResolveOrDeleteAnnotation = async (
    annotationId: string,
    action: 'resolve' | 'reopen' | 'delete',
  ) => {
    if (!activeSpec || busyAction) return;
    setBusyAction(`ann:${action}:${annotationId}`);
    try {
      const res = await bridge.callTool<{ spec: SpecDocumentView; state: SpecStateView }>(
        'app_spec_resolve_annotation',
        {
          specId: activeSpec.id,
          annotationId,
          action,
        },
      );
      if (res.state) {
        setState(res.state);
      } else {
        await loadState();
      }
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleSendFeedbackToAgent = async () => {
    if (!activeSpec || unresolvedCount === 0 || busyAction) return;
    setBusyAction('send-feedback');
    try {
      const delivery = await bridge.sendMessage(feedbackPrompt);
      if (delivery === 'sent') {
        onNotify?.(actions.feedbackSentToast);
      } else if (delivery === 'context') {
        onNotify?.(actions.feedbackContextToast);
      } else {
        onNotify?.(actions.feedbackCopiedToast);
      }
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleCopyFeedbackPrompt = async () => {
    if (!activeSpec || !feedbackPrompt) return;
    try {
      await navigator.clipboard?.writeText(feedbackPrompt);
      onNotify?.(actions.feedbackCopiedToast);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    }
  };

  const handleAddDraftDelta = () => {
    const cleanText = newDeltaText.trim();
    if (!cleanText) return;
    const id = `delta-${deltaSeq}`;
    setDeltaSeq((prev) => prev + 1);
    setDraftDeltas((prev) => [
      ...prev,
      { id, kind: newDeltaKind, area: newDeltaArea.trim(), text: cleanText },
    ]);
    setNewDeltaText('');
  };

  const handleRemoveDraftDelta = (id: string) => {
    setDraftDeltas((prev) => prev.filter((item) => item.id !== id));
  };

  const handleAddDraftTask = () => {
    const clean = newTaskTitle.trim();
    if (!clean) return;
    const id = `task-${taskSeq}`;
    setTaskSeq((prev) => prev + 1);
    setDraftTasks((prev) => [...prev, { id, title: clean, dependsOn: [] }]);
    setNewTaskTitle('');
  };

  const handleRemoveDraftTask = (id: string) => {
    setDraftTasks((prev) =>
      prev
        .filter((t) => t.id !== id)
        .map((t) => ({
          ...t,
          dependsOn: t.dependsOn.filter((dep) => dep !== id),
        })),
    );
  };

  const handleToggleDraftDep = (taskId: string, depId: string) => {
    setDraftTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t;
        const exists = t.dependsOn.includes(depId);
        if (exists) {
          return { ...t, dependsOn: t.dependsOn.filter((d) => d !== depId) };
        }
        if (wouldCreateDraftCycle(prev, taskId, depId)) {
          return t;
        }
        return { ...t, dependsOn: [...t.dependsOn, depId] };
      }),
    );
  };

  const handleCreateSpec = async () => {
    const cleanTitle = draftTitle.trim();
    const cleanGoal = draftGoal.trim();
    if (!cleanTitle || !cleanGoal || busyAction) return;

    const acceptanceCriteria = draftAcceptance
      .split(/\r?\n/)
      .map((line) => line.replace(/^[-*•]\s*/, '').trim())
      .filter(Boolean);

    const tasksPayload = draftTasks
      .filter((t) => t.title.trim().length > 0)
      .map((t) => ({
        id: t.id,
        title: t.title.trim(),
        dependsOn: t.dependsOn,
      }));

    const deltaPayload = draftDeltas
      .filter((d) => d.text.trim().length > 0)
      .map((d) => ({
        id: d.id,
        kind: d.kind,
        ...(d.area.trim() ? { area: d.area.trim() } : {}),
        text: d.text.trim(),
      }));

    const cleanPlanMd = draftPlanMarkdown.trim();

    setBusyAction('create');
    try {
      const res = await bridge.callTool<{ spec: SpecDocumentView; state: SpecStateView }>(
        'app_spec_save',
        {
          title: cleanTitle,
          goal: cleanGoal,
          mode: draftMode,
          ...(cleanPlanMd ? { planMarkdown: cleanPlanMd } : {}),
          ...(deltaPayload.length > 0 ? { deltaItems: deltaPayload } : {}),
          ...(acceptanceCriteria.length > 0 ? { acceptanceCriteria } : {}),
          enforcePlanBeforeWrite: draftEnforceLock,
          requireUiApproval: draftRequireUiApproval,
          ...(tasksPayload.length > 0 ? { tasks: tasksPayload } : {}),
          setActive: true,
        },
      );
      if (res.state) {
        setState(res.state);
      } else {
        await loadState();
      }
      setDraftTitle('');
      setDraftGoal('');
      setDraftPlanMarkdown('');
      setDraftAcceptance('');
      setDraftDeltas([]);
      setNewDeltaArea('');
      setNewDeltaText('');
      setDeltaSeq(1);
      setDraftTasks([]);
      setNewTaskTitle('');
      setTaskSeq(1);
      setTab('board');
      onNotify?.(`${sDict.createSpecBtn}: ${res.spec?.title ?? cleanTitle}`);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const getDeltaKindLabel = (kind: SpecDeltaKind): string => {
    if (kind === 'added') return actions.deltaAdded;
    if (kind === 'removed') return actions.deltaRemoved;
    return actions.deltaModified;
  };

  const getAnnotationKindLabel = (kind: SpecAnnotationKind): string => {
    if (kind === 'strike') return actions.kindStrike;
    if (kind === 'replace') return actions.kindReplace;
    return actions.kindComment;
  };

  const activeSpecStatusBadge = activeSpec ? getSpecStatusBadgeProps(activeSpec.status, sDict) : null;
  const activeSpecMode: SpecMode = activeSpec?.mode === 'delta' ? 'delta' : 'full';
  const activeRevision = activeSpec?.revision ?? 1;
  const activeDeltaItems = Array.isArray(activeSpec?.deltaItems) ? activeSpec.deltaItems : [];

  const renderAnnotationCard = (ann: SpecPlanAnnotation) => {
    const kindStyle = getAnnotationKindStyle(ann.kind);
    const rangeText =
      ann.lineStart === ann.lineEnd ? `L${ann.lineStart}` : `L${ann.lineStart}–L${ann.lineEnd}`;
    return (
      <div
        key={ann.id}
        className="nov-p-item"
        style={{
          margin: '6px 10px',
          background: 'var(--nov-bg-1)',
          opacity: ann.resolved ? 0.65 : 1,
          borderLeft: `3px solid ${
            ann.kind === 'strike'
              ? 'var(--nov-danger)'
              : ann.kind === 'replace'
                ? 'var(--nov-warn)'
                : 'var(--nov-accent)'
          }`,
        }}
      >
        <div className="nov-p-row">
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
            <span className="nov-badge" style={kindStyle}>
              {getAnnotationKindLabel(ann.kind)}
            </span>
            <code
              className="nov-badge"
              style={{ fontFamily: 'var(--nov-font-mono)', fontSize: '10.5px' }}
            >
              {rangeText} · v{ann.revision}
            </code>
            {ann.resolved && <span className="nov-badge is-offline">{actions.resolvedBadge}</span>}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            <button
              type="button"
              className="nov-open-btn"
              disabled={isBusy}
              onClick={() =>
                void handleResolveOrDeleteAnnotation(
                  ann.id,
                  ann.resolved ? 'reopen' : 'resolve',
                )
              }
            >
              {ann.resolved ? actions.reopenBtn : actions.resolveBtn}
            </button>
            <button
              type="button"
              className="nov-open-btn"
              style={{ color: 'var(--nov-danger)' }}
              disabled={isBusy}
              onClick={() => void handleResolveOrDeleteAnnotation(ann.id, 'delete')}
            >
              {dict.common.delete}
            </button>
          </div>
        </div>

        {ann.note && (
          <div style={{ fontSize: '12px', color: 'var(--nov-text-0)', whiteSpace: 'pre-wrap' }}>
            {ann.note}
          </div>
        )}

        {ann.kind === 'replace' && ann.suggestedText && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '11px', color: 'var(--nov-text-2)', fontWeight: 600 }}>
              {actions.suggestedLabel}:
            </span>
            <pre
              className="nov-p-pre"
              style={{
                borderColor: 'var(--nov-success)',
                background: 'var(--nov-success-soft)',
                color: 'var(--nov-text-0)',
              }}
            >
              {ann.suggestedText}
            </pre>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="nov-p-page">
      <section className="nov-p-card">
        <div className="nov-p-row">
          <div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
              <h2 className="nov-hero-title">{sDict.title}</h2>
              <span
                className={writeLockActive ? 'nov-badge' : 'nov-badge is-offline'}
                style={
                  writeLockActive
                    ? {
                        background: 'var(--nov-danger-soft)',
                        color: 'var(--nov-danger)',
                        borderColor: 'var(--nov-danger)',
                      }
                    : undefined
                }
              >
                {writeLockActive ? `🔒 ${sDict.writeLockOn}` : `🔓 ${sDict.writeLockOff}`}
              </span>
              {activeSpec && (
                <span
                  className={`nov-badge ${activeSpecMode === 'delta' ? 'is-accent' : ''}`}
                  style={{ fontFamily: 'var(--nov-font-mono)' }}
                >
                  {activeSpecMode === 'delta' ? actions.modeDeltaBadge : actions.modeFullBadge} · v
                  {activeRevision}
                </span>
              )}
            </div>
            <p className="nov-hero-sub">{sDict.subtitle}</p>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
            <button
              type="button"
              className="nov-p-btn"
              disabled={isBusy}
              onClick={() => void loadState()}
            >
              {dict.common.refresh}
            </button>

            {activeSpec && activeSpec.status === 'draft' && (
              <button
                type="button"
                className="nov-p-btn is-primary"
                disabled={isBusy}
                onClick={() =>
                  void handleSetSpecStatus({
                    specId: activeSpec.id,
                    status: 'approved',
                    setActive: true,
                    actionKey: 'approve',
                    notifyText: `${sDict.approveBtn}: ${activeSpec.title}`,
                  })
                }
              >
                {busyAction === 'approve' ? dict.common.loading : sDict.approveBtn}
              </button>
            )}

            {activeSpec && activeSpec.status !== 'draft' && (
              <button
                type="button"
                className="nov-p-btn"
                disabled={isBusy}
                onClick={() =>
                  void handleSetSpecStatus({
                    specId: activeSpec.id,
                    status: 'draft',
                    setActive: true,
                    actionKey: 'revert',
                    notifyText: `${sDict.revertDraftBtn}: ${activeSpec.title}`,
                  })
                }
              >
                {busyAction === 'revert' ? dict.common.loading : sDict.revertDraftBtn}
              </button>
            )}

            {onOpenSettings && (
              <button
                type="button"
                className="nov-p-btn"
                title={actions.settingsTooltip}
                aria-label={actions.settingsTooltip}
                style={{ padding: '6px 9px' }}
                onClick={() => onOpenSettings('spec')}
              >
                ⚙
              </button>
            )}
          </div>
        </div>

        <div className="nov-p-stat-grid">
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{actions.specsLabel}</div>
            <div className="nov-p-stat-val">{specs.length}</div>
          </div>
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{sDict.readyBadge}</div>
            <div className="nov-p-stat-val" style={{ color: 'var(--nov-success)' }}>
              {dagCounts.ready}
            </div>
          </div>
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{sDict.doneBadge}</div>
            <div className="nov-p-stat-val">
              {dagCounts.done}/{dagNodes.length}
            </div>
          </div>
          <div className="nov-p-stat">
            <div className="nov-p-stat-label">{actions.reviewStatLabel}</div>
            <div
              className="nov-p-stat-val"
              style={{
                color: unresolvedCount > 0 ? 'var(--nov-warn)' : 'var(--nov-success)',
              }}
            >
              {unresolvedCount}
            </div>
          </div>
        </div>

        <div className="nov-p-tabs">
          <button
            type="button"
            className={`nov-preset-btn ${tab === 'board' ? 'is-active' : ''}`}
            onClick={() => setTab('board')}
          >
            {sDict.tabBoard}
          </button>
          <button
            type="button"
            className={`nov-preset-btn ${tab === 'review' ? 'is-active' : ''}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            onClick={() => setTab('review')}
          >
            <span>{actions.tabReview}</span>
            {unresolvedCount > 0 && (
              <span className="nov-badge is-network" style={{ padding: '1px 6px' }}>
                {unresolvedCount}
              </span>
            )}
          </button>
          <button
            type="button"
            className={`nov-preset-btn ${tab === 'create' ? 'is-active' : ''}`}
            onClick={() => setTab('create')}
          >
            + {actions.tabCreateDelta}
          </button>
        </div>
      </section>

      {tab === 'board' && (
        <>
          {specs.length === 0 ? (
            <section className="nov-p-card">
              <p style={{ margin: 0, color: 'var(--nov-text-2)' }}>{sDict.emptySpecs}</p>
              <div>
                <button
                  type="button"
                  className="nov-p-btn is-primary"
                  onClick={() => setTab('create')}
                >
                  + {actions.tabCreateDelta}
                </button>
              </div>
            </section>
          ) : (
            <>
              {/* Spec switcher strip */}
              <section className="nov-p-card">
                <div className="nov-p-row">
                  <h3 className="nov-card-title">
                    {actions.specsLabel} ({specs.length})
                  </h3>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {specs.map((item) => {
                    const isSelected = activeSpec?.id === item.id;
                    const badge = getSpecStatusBadgeProps(item.status, sDict);
                    const switching = busyAction === `select:${item.id}`;
                    const itemMode: SpecMode = item.mode === 'delta' ? 'delta' : 'full';
                    const itemOpenAnn = item.unresolvedAnnotations ?? 0;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`nov-preset-btn ${isSelected ? 'is-active' : ''}`}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '6px 10px',
                        }}
                        disabled={isBusy}
                        onClick={() => {
                          if (!isSelected) {
                            void handleSetSpecStatus({
                              specId: item.id,
                              status: item.status,
                              setActive: true,
                              actionKey: `select:${item.id}`,
                            });
                          }
                        }}
                      >
                        <span
                          className={`nov-badge ${itemMode === 'delta' ? 'is-accent' : ''}`}
                          style={{ fontFamily: 'var(--nov-font-mono)', fontSize: '10px' }}
                        >
                          {itemMode === 'delta' ? actions.modeDeltaBadge : actions.modeFullBadge}
                        </span>
                        <span>{switching ? dict.common.loading : item.title}</span>
                        <span className={badge.className} style={badge.style}>
                          {badge.text}
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--nov-text-2)' }}>
                          v{item.revision ?? 1} · {item.doneTasks}/{item.totalTasks}
                        </span>
                        {itemOpenAnn > 0 && (
                          <span className="nov-badge is-network" style={{ fontSize: '10px' }}>
                            {itemOpenAnn} {actions.unresolvedBadge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>

              {!activeSpec ? (
                <section className="nov-p-card">
                  <p style={{ margin: 0, color: 'var(--nov-text-2)' }}>
                    {actions.selectSpecHint}
                  </p>
                </section>
              ) : (
                <>
                  {/* Active spec details, Delta contract, Archive-to-Mem & write-gate switches */}
                  <section className="nov-p-card">
                    <div className="nov-p-row">
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
                        <h3 className="nov-card-title">{activeSpec.title}</h3>
                        <span
                          className={`nov-badge ${activeSpecMode === 'delta' ? 'is-accent' : ''}`}
                          style={{ fontFamily: 'var(--nov-font-mono)' }}
                        >
                          {activeSpecMode === 'delta'
                            ? actions.modeDeltaBadge
                            : actions.modeFullBadge}
                        </span>
                        <span
                          className="nov-badge"
                          style={{ fontFamily: 'var(--nov-font-mono)' }}
                        >
                          v{activeRevision}
                        </span>
                        {activeSpecStatusBadge && (
                          <span
                            className={activeSpecStatusBadge.className}
                            style={activeSpecStatusBadge.style}
                          >
                            {activeSpecStatusBadge.text}
                          </span>
                        )}
                        {activeSpec.archivedMemoryId && (
                          <span
                            className="nov-badge is-offline"
                            title={activeSpec.archivedMemoryId}
                          >
                            ✓ {actions.archivedBadge} ({activeSpec.archivedMemoryId})
                          </span>
                        )}
                        <code
                          style={{
                            fontSize: '11px',
                            color: 'var(--nov-text-2)',
                            fontFamily: 'var(--nov-font-mono)',
                          }}
                        >
                          {activeSpec.id}
                        </code>
                      </div>

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        <button
                          type="button"
                          className="nov-p-btn"
                          disabled={isBusy}
                          onClick={() => setTab('review')}
                        >
                          {actions.openReviewLink}
                          {unresolvedCount > 0 ? ` (${unresolvedCount})` : ''}
                        </button>
                        <button
                          type="button"
                          className="nov-p-btn"
                          disabled={isBusy}
                          onClick={() => void handleArchiveToMem()}
                        >
                          {busyAction === 'archive-mem'
                            ? dict.common.loading
                            : activeSpec.archivedMemoryId
                              ? actions.updateMemArchiveBtn
                              : actions.archiveToMemBtn}
                        </button>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {(['draft', 'approved', 'completed', 'archived'] as const).map((st) => {
                        const stBadge = getSpecStatusBadgeProps(st, sDict);
                        const isCurrent = activeSpec.status === st;
                        const key = `status:${st}`;
                        return (
                          <button
                            key={st}
                            type="button"
                            className={`nov-preset-btn ${isCurrent ? 'is-active' : ''}`}
                            disabled={isBusy || isCurrent}
                            onClick={() =>
                              void handleSetSpecStatus({
                                specId: activeSpec.id,
                                status: st,
                                setActive: true,
                                actionKey: key,
                                notifyText: `${activeSpec.title} -> ${stBadge.text}`,
                              })
                            }
                          >
                            {busyAction === key ? dict.common.loading : stBadge.text}
                          </button>
                        );
                      })}
                    </div>

                    {activeSpec.goal && (
                      <p
                        style={{
                          margin: 0,
                          fontSize: '12.5px',
                          color: 'var(--nov-text-1)',
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {activeSpec.goal}
                      </p>
                    )}

                    {/* Behavioral Delta Contract list */}
                    {activeDeltaItems.length > 0 && (
                      <div
                        className="nov-p-item"
                        style={{ background: 'var(--nov-bg-0)', gap: '8px' }}
                      >
                        <strong style={{ fontSize: '12px', color: 'var(--nov-text-0)' }}>
                          {actions.deltaSectionTitle} ({activeDeltaItems.length})
                        </strong>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {activeDeltaItems.map((item) => (
                            <div
                              key={item.id}
                              style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                alignItems: 'center',
                                gap: '6px',
                                fontSize: '12px',
                              }}
                            >
                              <span
                                className="nov-badge"
                                style={{
                                  ...getDeltaKindStyle(item.kind),
                                  fontFamily: 'var(--nov-font-mono)',
                                  fontSize: '10.5px',
                                }}
                              >
                                {getDeltaKindLabel(item.kind)}
                              </span>
                              {item.area && (
                                <code
                                  className="nov-badge"
                                  style={{
                                    fontFamily: 'var(--nov-font-mono)',
                                    fontSize: '10.5px',
                                  }}
                                >
                                  {item.area}
                                </code>
                              )}
                              <span style={{ color: 'var(--nov-text-1)' }}>{item.text}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div
                      className="nov-p-item"
                      style={{ background: 'var(--nov-bg-0)', gap: '10px' }}
                    >
                      <div className="nov-p-row">
                        <span style={{ fontSize: '12.5px', color: 'var(--nov-text-0)' }}>
                          {sDict.enforceLockLabel}
                        </span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={activeSpec.enforcePlanBeforeWrite}
                          className="nov-switch"
                          disabled={isBusy}
                          onClick={() =>
                            void handleSetSpecStatus({
                              specId: activeSpec.id,
                              status: activeSpec.status,
                              enforcePlanBeforeWrite: !activeSpec.enforcePlanBeforeWrite,
                              setActive: true,
                              actionKey: 'toggle:enforce',
                            })
                          }
                        >
                          <span className="nov-switch-thumb" />
                        </button>
                      </div>

                      <div className="nov-p-row">
                        <span style={{ fontSize: '12.5px', color: 'var(--nov-text-0)' }}>
                          {sDict.requireUiApprovalLabel}
                        </span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={activeSpec.requireUiApproval}
                          className="nov-switch"
                          disabled={isBusy}
                          onClick={() =>
                            void handleSetSpecStatus({
                              specId: activeSpec.id,
                              status: activeSpec.status,
                              requireUiApproval: !activeSpec.requireUiApproval,
                              setActive: true,
                              actionKey: 'toggle:uiApproval',
                            })
                          }
                        >
                          <span className="nov-switch-thumb" />
                        </button>
                      </div>
                    </div>

                    {Array.isArray(activeSpec.acceptanceCriteria) &&
                      activeSpec.acceptanceCriteria.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <strong style={{ fontSize: '12px', color: 'var(--nov-text-1)' }}>
                            {sDict.acceptanceTitle} ({activeSpec.acceptanceCriteria.length})
                          </strong>
                          <ul
                            style={{
                              margin: 0,
                              paddingLeft: '18px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '3px',
                              fontSize: '12px',
                              color: 'var(--nov-text-1)',
                            }}
                          >
                            {activeSpec.acceptanceCriteria.map((criterion, i) => (
                              <li key={`${i}:${criterion}`}>{criterion}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                    {Array.isArray(activeSpec.planSteps) && activeSpec.planSteps.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <strong style={{ fontSize: '12px', color: 'var(--nov-text-1)' }}>
                          {actions.planStepsLabel} ({activeSpec.planSteps.length})
                        </strong>
                        <ol
                          style={{
                            margin: 0,
                            paddingLeft: '18px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '3px',
                            fontSize: '12px',
                            color: 'var(--nov-text-1)',
                          }}
                        >
                          {activeSpec.planSteps.map((step, i) => (
                            <li key={`${i}:${step}`}>{step}</li>
                          ))}
                        </ol>
                      </div>
                    )}
                  </section>

                  {/* Dependency Task DAG card */}
                  <section className="nov-p-card">
                    <div className="nov-p-row">
                      <h3 className="nov-card-title">
                        {sDict.tasksTitle} ({dagCounts.done}/{dagNodes.length})
                      </h3>
                    </div>

                    {dagNodes.length === 0 ? (
                      <p style={{ margin: 0, color: 'var(--nov-text-2)' }}>{dict.common.empty}</p>
                    ) : (
                      <div className="nov-p-list">
                        {dagNodes.map((node) => {
                          const { task, computedState, unmetDeps, depth } = node;
                          const badge = getTaskStateBadgeProps(computedState, sDict);
                          const hasUnmetDeps = unmetDeps.length > 0;
                          const indentPx = Math.min(depth, 5) * 20;

                          const canStart =
                            !hasUnmetDeps &&
                            task.status !== 'in_progress' &&
                            task.status !== 'done';
                          const canDone = !hasUnmetDeps && task.status !== 'done';
                          const canReset = task.status !== 'pending';

                          const startBusy = busyAction === `task:${task.id}:in_progress`;
                          const doneBusy = busyAction === `task:${task.id}:done`;
                          const resetBusy = busyAction === `task:${task.id}:pending`;

                          return (
                            <div
                              key={task.id}
                              style={{
                                marginLeft: `${indentPx}px`,
                                paddingLeft: depth > 0 ? '10px' : '0px',
                                borderLeft:
                                  depth > 0 ? '2px solid var(--nov-border-strong)' : 'none',
                              }}
                            >
                              <div
                                className="nov-p-item"
                                style={
                                  computedState === 'ready'
                                    ? { borderColor: 'var(--nov-success)' }
                                    : computedState === 'in_progress'
                                      ? { borderColor: 'var(--nov-accent)' }
                                      : undefined
                                }
                              >
                                <div className="nov-p-row">
                                  <div
                                    style={{
                                      display: 'flex',
                                      flexWrap: 'wrap',
                                      alignItems: 'center',
                                      gap: '6px',
                                      flex: 1,
                                      minWidth: '200px',
                                    }}
                                  >
                                    <span
                                      className="nov-badge"
                                      style={{
                                        fontFamily: 'var(--nov-font-mono)',
                                        fontSize: '10.5px',
                                      }}
                                    >
                                      L{depth}
                                    </span>
                                    <code
                                      style={{
                                        fontSize: '11.5px',
                                        color: 'var(--nov-text-2)',
                                        fontFamily: 'var(--nov-font-mono)',
                                      }}
                                    >
                                      {task.id}
                                    </code>
                                    <strong
                                      style={{
                                        textDecoration:
                                          task.status === 'done' ? 'line-through' : 'none',
                                        opacity: task.status === 'done' ? 0.75 : 1,
                                      }}
                                    >
                                      {task.title}
                                    </strong>
                                    <span className={badge.className} style={badge.style}>
                                      {badge.text}
                                    </span>
                                  </div>

                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                    <button
                                      type="button"
                                      className="nov-p-btn"
                                      disabled={isBusy || !canStart}
                                      onClick={() => void handleUpdateTask(task.id, 'in_progress')}
                                    >
                                      {startBusy ? dict.common.loading : actions.start}
                                    </button>
                                    <button
                                      type="button"
                                      className="nov-p-btn is-primary"
                                      disabled={isBusy || !canDone}
                                      onClick={() => void handleUpdateTask(task.id, 'done')}
                                    >
                                      {doneBusy ? dict.common.loading : actions.done}
                                    </button>
                                    <button
                                      type="button"
                                      className="nov-p-btn"
                                      disabled={isBusy || !canReset}
                                      onClick={() => void handleUpdateTask(task.id, 'pending')}
                                    >
                                      {resetBusy ? dict.common.loading : actions.reset}
                                    </button>
                                  </div>
                                </div>

                                {task.dependsOn.length > 0 && (
                                  <div
                                    style={{
                                      display: 'flex',
                                      flexWrap: 'wrap',
                                      alignItems: 'center',
                                      gap: '5px',
                                      fontSize: '11.5px',
                                      color: 'var(--nov-text-2)',
                                    }}
                                  >
                                    <span>{actions.depsLabel}:</span>
                                    {task.dependsOn.map((depId) => {
                                      const satisfied = taskStatusById.get(depId) === 'done';
                                      const depTitle = taskTitleById.get(depId);
                                      return (
                                        <span
                                          key={depId}
                                          className={`nov-badge ${satisfied ? 'is-offline' : 'is-network'}`}
                                          style={{ fontFamily: 'var(--nov-font-mono)' }}
                                          title={depTitle ?? depId}
                                        >
                                          {satisfied ? '✓' : '⏳'} {depId}
                                          {depTitle ? ` · ${depTitle}` : ''}
                                        </span>
                                      );
                                    })}
                                  </div>
                                )}

                                {(task.description || task.note) && (
                                  <div
                                    style={{
                                      fontSize: '12px',
                                      color: 'var(--nov-text-1)',
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: '3px',
                                    }}
                                  >
                                    {task.description && <span>{task.description}</span>}
                                    {task.note && (
                                      <span style={{ color: 'var(--nov-text-2)' }}>
                                        {task.note}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                </>
              )}
            </>
          )}
        </>
      )}

      {tab === 'review' && (
        <>
          {!activeSpec ? (
            <section className="nov-p-card">
              <p style={{ margin: 0, color: 'var(--nov-text-2)' }}>
                {specs.length === 0 ? sDict.emptySpecs : actions.selectSpecHint}
              </p>
            </section>
          ) : (
            <section className="nov-p-card">
              {/* Review toolbar */}
              <div className="nov-p-row">
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
                  <h3 className="nov-card-title">{activeSpec.title}</h3>
                  <span
                    className={`nov-badge ${activeSpecMode === 'delta' ? 'is-accent' : ''}`}
                    style={{ fontFamily: 'var(--nov-font-mono)' }}
                  >
                    {activeSpecMode === 'delta' ? actions.modeDeltaBadge : actions.modeFullBadge} ·
                    v{activeRevision}
                  </span>
                  <span
                    className={`nov-badge ${unresolvedCount > 0 ? 'is-network' : 'is-offline'}`}
                  >
                    {unresolvedCount > 0
                      ? `${unresolvedCount} ${actions.unresolvedBadge}`
                      : actions.allResolvedHint}
                  </span>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                  <button
                    type="button"
                    className={`nov-p-btn ${diffMode ? 'is-primary' : ''}`}
                    disabled={isBusy}
                    onClick={() => {
                      if (diffMode) {
                        setDiffMode(false);
                      } else {
                        void loadRevisionDiff(activeSpec.id);
                      }
                    }}
                  >
                    {busyAction === 'diff'
                      ? dict.common.loading
                      : diffMode
                        ? actions.exitDiffBtn
                        : availableRevisions.length >= 2
                          ? `${actions.toggleDiffBtn} (v${availableRevisions[availableRevisions.length - 2]} → v${availableRevisions[availableRevisions.length - 1]})`
                          : actions.toggleDiffBtn}
                  </button>

                  <button
                    type="button"
                    className="nov-p-btn is-primary"
                    disabled={isBusy || unresolvedCount === 0}
                    onClick={() => void handleSendFeedbackToAgent()}
                  >
                    {busyAction === 'send-feedback'
                      ? dict.common.loading
                      : `${canSendMessage ? actions.sendFeedbackBtn : dict.common.copyPrompt} (${unresolvedCount})`}
                  </button>

                  <button
                    type="button"
                    className="nov-p-btn"
                    disabled={isBusy || unresolvedCount === 0}
                    onClick={() => void handleCopyFeedbackPrompt()}
                  >
                    {actions.copyFeedbackBtn}
                  </button>
                </div>
              </div>

              {diffMode ? (
                /* Revision Diff view */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {availableRevisions.length < 2 ? (
                    <div className="nov-p-banner">{actions.diffSingleRevHint}</div>
                  ) : (
                    <div className="nov-p-row">
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
                        <label style={{ fontSize: '12px', color: 'var(--nov-text-1)' }}>
                          {actions.diffFromLabel}:
                        </label>
                        <select
                          className="nov-p-select"
                          style={{ width: 'auto', minWidth: '88px', padding: '4px 8px' }}
                          value={diffFromRev ?? availableRevisions[0]}
                          disabled={isBusy}
                          onChange={(e) => {
                            const nextFrom = Number(e.target.value);
                            setDiffFromRev(nextFrom);
                            void loadRevisionDiff(
                              activeSpec.id,
                              nextFrom,
                              diffToRev ?? activeRevision,
                            );
                          }}
                        >
                          {availableRevisions.map((rev) => (
                            <option key={rev} value={rev}>
                              v{rev}
                            </option>
                          ))}
                        </select>

                        <span style={{ color: 'var(--nov-text-2)' }}>→</span>

                        <label style={{ fontSize: '12px', color: 'var(--nov-text-1)' }}>
                          {actions.diffToLabel}:
                        </label>
                        <select
                          className="nov-p-select"
                          style={{ width: 'auto', minWidth: '88px', padding: '4px 8px' }}
                          value={diffToRev ?? activeRevision}
                          disabled={isBusy}
                          onChange={(e) => {
                            const nextTo = Number(e.target.value);
                            setDiffToRev(nextTo);
                            void loadRevisionDiff(
                              activeSpec.id,
                              diffFromRev ?? availableRevisions[0],
                              nextTo,
                            );
                          }}
                        >
                          {availableRevisions.map((rev) => (
                            <option key={rev} value={rev}>
                              v{rev}
                            </option>
                          ))}
                        </select>
                      </div>

                      {diffResult && (
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <span
                            className="nov-badge"
                            style={{
                              background: 'var(--nov-success-soft)',
                              color: 'var(--nov-success)',
                              borderColor: 'var(--nov-success)',
                              fontFamily: 'var(--nov-font-mono)',
                            }}
                          >
                            +{diffResult.addedLines}
                          </span>
                          <span
                            className="nov-badge"
                            style={{
                              background: 'var(--nov-danger-soft)',
                              color: 'var(--nov-danger)',
                              borderColor: 'var(--nov-danger)',
                              fontFamily: 'var(--nov-font-mono)',
                            }}
                          >
                            -{diffResult.removedLines}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {diffResult?.degraded && (
                    <div className="nov-p-banner">{actions.diffDegradedNotice}</div>
                  )}

                  {diffResult &&
                    diffResult.addedLines === 0 &&
                    diffResult.removedLines === 0 && (
                      <div className="nov-p-banner">{actions.diffNoChangesHint}</div>
                    )}

                  {diffResult && (
                    <div
                      style={{
                        border: '1px solid var(--nov-border)',
                        borderRadius: '8px',
                        overflow: 'hidden',
                        background: 'var(--nov-bg-0)',
                        fontFamily: 'var(--nov-font-mono)',
                        fontSize: '12px',
                      }}
                    >
                      {diffResult.hunks.map((hunk, idx) => {
                        const isAdd = hunk.type === 'add';
                        const isDel = hunk.type === 'del';
                        const bg = isAdd
                          ? 'var(--nov-success-soft)'
                          : isDel
                            ? 'var(--nov-danger-soft)'
                            : 'transparent';
                        const markerColor = isAdd
                          ? 'var(--nov-success)'
                          : isDel
                            ? 'var(--nov-danger)'
                            : 'var(--nov-text-2)';
                        return (
                          <div
                            key={idx}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '42px 42px 18px 1fr',
                              background: bg,
                              borderBottom: '1px solid rgba(148, 163, 184, 0.08)',
                              lineHeight: 1.55,
                            }}
                          >
                            <span
                              style={{
                                textAlign: 'right',
                                padding: '1px 6px',
                                color: 'var(--nov-text-2)',
                                userSelect: 'none',
                              }}
                            >
                              {hunk.oldLine ?? ''}
                            </span>
                            <span
                              style={{
                                textAlign: 'right',
                                padding: '1px 6px',
                                color: 'var(--nov-text-2)',
                                borderRight: '1px solid var(--nov-border)',
                                userSelect: 'none',
                              }}
                            >
                              {hunk.newLine ?? ''}
                            </span>
                            <span
                              style={{
                                textAlign: 'center',
                                fontWeight: 700,
                                color: markerColor,
                                userSelect: 'none',
                              }}
                            >
                              {isAdd ? '+' : isDel ? '-' : ' '}
                            </span>
                            <span
                              style={{
                                padding: '1px 8px 1px 2px',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                                color: 'var(--nov-text-0)',
                                textDecoration: isDel ? 'line-through' : 'none',
                              }}
                            >
                              {hunk.text || ' '}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                /* Plannotator line-by-line review workbench */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div className="nov-p-row">
                    <span style={{ fontSize: '12px', color: 'var(--nov-text-1)' }}>
                      {actions.reviewLineHint}
                    </span>

                    <label
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '12px',
                        color: 'var(--nov-text-1)',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={showResolved}
                        onChange={(e) => setShowResolved(e.target.checked)}
                      />
                      <span>{actions.showResolvedLabel}</span>
                    </label>
                  </div>

                  {planLines.length === 0 ? (
                    <p style={{ margin: 0, color: 'var(--nov-text-2)' }}>
                      {actions.emptyPlanHint}
                    </p>
                  ) : (
                    <div
                      style={{
                        border: '1px solid var(--nov-border)',
                        borderRadius: '8px',
                        overflow: 'hidden',
                        background: 'var(--nov-bg-0)',
                      }}
                    >
                      {planLines.map((lineText, idx) => {
                        const lineNum = idx + 1;
                        const normStart =
                          selStart !== null && selEnd !== null
                            ? Math.min(selStart, selEnd)
                            : null;
                        const normEnd =
                          selStart !== null && selEnd !== null
                            ? Math.max(selStart, selEnd)
                            : null;
                        const isSelected =
                          normStart !== null &&
                          normEnd !== null &&
                          lineNum >= normStart &&
                          lineNum <= normEnd;
                        const isStruck = lineDecorations.strikeLines.has(lineNum);
                        const isReplaced = lineDecorations.replaceLines.has(lineNum);
                        const isCommented = lineDecorations.commentLines.has(lineNum);
                        const lineAnnotations = lineDecorations.byEndLine.get(lineNum) ?? [];

                        let rowBg = 'transparent';
                        let leftBorder = '3px solid transparent';
                        if (isSelected) {
                          rowBg = 'var(--nov-accent-soft)';
                          leftBorder = '3px solid var(--nov-accent)';
                        } else if (isStruck) {
                          rowBg = 'var(--nov-danger-soft)';
                          leftBorder = '3px solid var(--nov-danger)';
                        } else if (isReplaced) {
                          rowBg = 'var(--nov-warn-soft)';
                          leftBorder = '3px solid var(--nov-warn)';
                        } else if (isCommented) {
                          rowBg = 'var(--nov-accent-soft)';
                          leftBorder = '3px solid var(--nov-accent)';
                        }

                        return (
                          <React.Fragment key={lineNum}>
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: '48px 1fr',
                                alignItems: 'stretch',
                                background: rowBg,
                                borderLeft: leftBorder,
                                borderBottom: '1px solid rgba(148, 163, 184, 0.08)',
                                fontFamily: 'var(--nov-font-mono)',
                                fontSize: '12px',
                                lineHeight: 1.6,
                              }}
                            >
                              <button
                                type="button"
                                onClick={(e) => handleSelectPlanLine(lineNum, e.shiftKey)}
                                style={{
                                  appearance: 'none',
                                  border: 'none',
                                  borderRight: '1px solid var(--nov-border)',
                                  background: 'transparent',
                                  color: isSelected
                                    ? 'var(--nov-accent)'
                                    : 'var(--nov-text-2)',
                                  fontFamily: 'var(--nov-font-mono)',
                                  fontSize: '11.5px',
                                  fontWeight: isSelected ? 700 : 500,
                                  textAlign: 'right',
                                  padding: '2px 8px 2px 4px',
                                  cursor: 'pointer',
                                  userSelect: 'none',
                                }}
                              >
                                {lineNum}
                              </button>
                              <div
                                onClick={(e) => handleSelectPlanLine(lineNum, e.shiftKey)}
                                style={{
                                  padding: '2px 10px',
                                  cursor: 'pointer',
                                  whiteSpace: 'pre-wrap',
                                  wordBreak: 'break-word',
                                  color: isStruck ? 'var(--nov-danger)' : 'var(--nov-text-0)',
                                  textDecoration: isStruck ? 'line-through' : 'none',
                                }}
                              >
                                {lineText || ' '}
                              </div>
                            </div>

                            {/* Inline annotation composer right below selected lineEnd */}
                            {normEnd === lineNum && normStart !== null && (
                              <div
                                className="nov-p-item"
                                style={{
                                  margin: '8px 10px',
                                  background: 'var(--nov-bg-1)',
                                  borderColor: 'var(--nov-accent)',
                                  gap: '8px',
                                }}
                              >
                                <div className="nov-p-row">
                                  <div
                                    style={{
                                      display: 'flex',
                                      flexWrap: 'wrap',
                                      alignItems: 'center',
                                      gap: '8px',
                                    }}
                                  >
                                    <strong style={{ fontSize: '12px' }}>
                                      {actions.selectedRangeLabel}: L{normStart}
                                      {normEnd > normStart ? `–L${normEnd}` : ''}
                                    </strong>
                                    <label
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        fontSize: '11.5px',
                                        color: 'var(--nov-text-2)',
                                      }}
                                    >
                                      <span>{actions.lineStartLabel}</span>
                                      <input
                                        type="number"
                                        min={1}
                                        max={planLines.length}
                                        value={normStart}
                                        className="nov-p-input"
                                        style={{ width: '62px', padding: '3px 6px' }}
                                        onChange={(e) => {
                                          const v = Math.max(
                                            1,
                                            Math.min(planLines.length, Number(e.target.value) || 1),
                                          );
                                          setSelStart(v);
                                          setSelEnd(Math.max(v, normEnd));
                                        }}
                                      />
                                    </label>
                                    <label
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        fontSize: '11.5px',
                                        color: 'var(--nov-text-2)',
                                      }}
                                    >
                                      <span>{actions.lineEndLabel}</span>
                                      <input
                                        type="number"
                                        min={normStart}
                                        max={planLines.length}
                                        value={normEnd}
                                        className="nov-p-input"
                                        style={{ width: '62px', padding: '3px 6px' }}
                                        onChange={(e) => {
                                          const v = Math.max(
                                            normStart,
                                            Math.min(
                                              planLines.length,
                                              Number(e.target.value) || normStart,
                                            ),
                                          );
                                          setSelEnd(v);
                                        }}
                                      />
                                    </label>
                                  </div>

                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                    {(['comment', 'strike', 'replace'] as const).map((k) => (
                                      <button
                                        key={k}
                                        type="button"
                                        className={`nov-cat-pill ${annKind === k ? 'is-active' : ''}`}
                                        onClick={() => {
                                          setAnnKind(k);
                                          if (k === 'replace' && !annSuggestedText.trim()) {
                                            setAnnSuggestedText(
                                              planLines.slice(normStart - 1, normEnd).join('\n'),
                                            );
                                          }
                                        }}
                                      >
                                        {getAnnotationKindLabel(k)}
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                <textarea
                                  className="nov-p-textarea"
                                  style={{
                                    fontFamily: 'var(--nov-font-sans)',
                                    minHeight: '58px',
                                  }}
                                  value={annNote}
                                  disabled={isBusy}
                                  placeholder={
                                    annKind === 'strike'
                                      ? actions.notePlaceholderStrike
                                      : annKind === 'replace'
                                        ? actions.notePlaceholderReplace
                                        : actions.notePlaceholderComment
                                  }
                                  onChange={(e) => setAnnNote(e.target.value)}
                                />

                                {annKind === 'replace' && (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    <label
                                      style={{
                                        fontSize: '11.5px',
                                        color: 'var(--nov-text-1)',
                                        fontWeight: 600,
                                      }}
                                    >
                                      {actions.replaceTextLabel}
                                    </label>
                                    <textarea
                                      className="nov-p-textarea"
                                      style={{ minHeight: '68px' }}
                                      value={annSuggestedText}
                                      disabled={isBusy}
                                      placeholder={actions.replaceTextPlaceholder}
                                      onChange={(e) => setAnnSuggestedText(e.target.value)}
                                    />
                                  </div>
                                )}

                                <div className="nov-p-row" style={{ justifyContent: 'flex-end' }}>
                                  <button
                                    type="button"
                                    className="nov-p-btn"
                                    disabled={isBusy}
                                    onClick={() => {
                                      setSelStart(null);
                                      setSelEnd(null);
                                    }}
                                  >
                                    {actions.cancelBtn}
                                  </button>
                                  <button
                                    type="button"
                                    className="nov-p-btn is-primary"
                                    disabled={
                                      isBusy ||
                                      (annKind === 'comment' && !annNote.trim()) ||
                                      (annKind === 'replace' && !annSuggestedText.trim())
                                    }
                                    onClick={() => void handleSubmitAnnotation()}
                                  >
                                    {busyAction === 'annotate'
                                      ? dict.common.loading
                                      : actions.submitAnnotationBtn}
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Inline annotation cards anchored at lineEnd */}
                            {lineAnnotations.map((ann) => renderAnnotationCard(ann))}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  )}

                  {lineDecorations.detached.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <strong style={{ fontSize: '12px', color: 'var(--nov-text-1)' }}>
                        {actions.detachedAnnotationsTitle} ({lineDecorations.detached.length})
                      </strong>
                      {lineDecorations.detached.map((ann) => renderAnnotationCard(ann))}
                    </div>
                  )}

                  {unresolvedCount > 0 && (
                    <div
                      className="nov-p-row"
                      style={{
                        paddingTop: '8px',
                        borderTop: '1px solid var(--nov-border)',
                        justifyContent: 'flex-end',
                      }}
                    >
                      <button
                        type="button"
                        className="nov-p-btn"
                        disabled={isBusy}
                        onClick={() => void handleCopyFeedbackPrompt()}
                      >
                        {actions.copyFeedbackBtn}
                      </button>
                      <button
                        type="button"
                        className="nov-p-btn is-primary"
                        disabled={isBusy}
                        onClick={() => void handleSendFeedbackToAgent()}
                      >
                        {busyAction === 'send-feedback'
                          ? dict.common.loading
                          : `${canSendMessage ? actions.sendFeedbackBtn : dict.common.copyPrompt} (${unresolvedCount})`}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </>
      )}

      {tab === 'create' && (
        <section className="nov-p-card">
          <h3 className="nov-card-title">{actions.tabCreateDelta}</h3>

          {/* Full Spec vs Brownfield Delta Spec selector */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '8px' }}>
            <button
              type="button"
              className={`nov-p-item`}
              style={{
                textAlign: 'left',
                cursor: 'pointer',
                borderColor: draftMode === 'full' ? 'var(--nov-accent)' : 'var(--nov-border)',
                background: draftMode === 'full' ? 'var(--nov-accent-soft)' : 'var(--nov-bg-0)',
              }}
              disabled={isBusy}
              onClick={() => setDraftMode('full')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="nov-badge" style={{ fontFamily: 'var(--nov-font-mono)' }}>
                  {actions.modeFullBadge}
                </span>
                <strong style={{ color: 'var(--nov-text-0)', fontSize: '12.5px' }}>
                  {actions.modeFullTitle}
                </strong>
              </div>
              <span style={{ fontSize: '11.5px', color: 'var(--nov-text-1)' }}>
                {actions.modeFullDesc}
              </span>
            </button>

            <button
              type="button"
              className={`nov-p-item`}
              style={{
                textAlign: 'left',
                cursor: 'pointer',
                borderColor: draftMode === 'delta' ? 'var(--nov-accent)' : 'var(--nov-border)',
                background: draftMode === 'delta' ? 'var(--nov-accent-soft)' : 'var(--nov-bg-0)',
              }}
              disabled={isBusy}
              onClick={() => setDraftMode('delta')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="nov-badge is-accent" style={{ fontFamily: 'var(--nov-font-mono)' }}>
                  {actions.modeDeltaBadge}
                </span>
                <strong style={{ color: 'var(--nov-text-0)', fontSize: '12.5px' }}>
                  {actions.modeDeltaTitle}
                </strong>
              </div>
              <span style={{ fontSize: '11.5px', color: 'var(--nov-text-1)' }}>
                {actions.modeDeltaDesc}
              </span>
            </button>
          </div>

          <input
            className="nov-p-input"
            value={draftTitle}
            placeholder={sDict.specTitlePlaceholder}
            disabled={isBusy}
            onChange={(e) => setDraftTitle(e.target.value)}
          />

          <textarea
            className="nov-p-textarea"
            style={{ fontFamily: 'var(--nov-font-sans)', minHeight: '72px' }}
            value={draftGoal}
            placeholder={sDict.specGoalPlaceholder}
            disabled={isBusy}
            onChange={(e) => setDraftGoal(e.target.value)}
          />

          {/* Brownfield Delta items builder */}
          <div
            className="nov-p-item"
            style={{
              background: 'var(--nov-bg-0)',
              borderColor: draftMode === 'delta' ? 'var(--nov-accent)' : 'var(--nov-border)',
              gap: '8px',
            }}
          >
            <strong style={{ fontSize: '12.5px', color: 'var(--nov-text-0)' }}>
              {actions.deltaSectionTitle} ({draftDeltas.length})
            </strong>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '120px 150px 1fr auto',
                gap: '6px',
                alignItems: 'center',
              }}
            >
              <select
                className="nov-p-select"
                value={newDeltaKind}
                disabled={isBusy}
                onChange={(e) => setNewDeltaKind(e.target.value as SpecDeltaKind)}
              >
                <option value="added">{actions.deltaAdded}</option>
                <option value="modified">{actions.deltaModified}</option>
                <option value="removed">{actions.deltaRemoved}</option>
              </select>

              <input
                className="nov-p-input"
                value={newDeltaArea}
                placeholder={actions.deltaAreaPlaceholder}
                disabled={isBusy}
                onChange={(e) => setNewDeltaArea(e.target.value)}
              />

              <input
                className="nov-p-input"
                value={newDeltaText}
                placeholder={actions.deltaTextPlaceholder}
                disabled={isBusy}
                onChange={(e) => setNewDeltaText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddDraftDelta();
                  }
                }}
              />

              <button
                type="button"
                className="nov-p-btn"
                disabled={isBusy || !newDeltaText.trim()}
                onClick={handleAddDraftDelta}
              >
                + {actions.addDeltaBtn}
              </button>
            </div>

            {draftDeltas.length > 0 && (
              <div className="nov-p-list">
                {draftDeltas.map((item) => (
                  <div key={item.id} className="nov-p-row">
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
                      <span
                        className="nov-badge"
                        style={{
                          ...getDeltaKindStyle(item.kind),
                          fontFamily: 'var(--nov-font-mono)',
                          fontSize: '10.5px',
                        }}
                      >
                        {getDeltaKindLabel(item.kind)}
                      </span>
                      {item.area && (
                        <code className="nov-badge" style={{ fontFamily: 'var(--nov-font-mono)' }}>
                          {item.area}
                        </code>
                      )}
                      <span style={{ fontSize: '12px', color: 'var(--nov-text-1)' }}>
                        {item.text}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="nov-open-btn"
                      style={{ color: 'var(--nov-danger)' }}
                      disabled={isBusy}
                      onClick={() => handleRemoveDraftDelta(item.id)}
                    >
                      {dict.common.delete}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Plan Markdown editor */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '12px', color: 'var(--nov-text-1)', fontWeight: 600 }}>
              {actions.planMarkdownLabel}
            </label>
            <span style={{ fontSize: '11.5px', color: 'var(--nov-text-2)' }}>
              {actions.planMarkdownHint}
            </span>
            <textarea
              className="nov-p-textarea"
              style={{ minHeight: '96px' }}
              value={draftPlanMarkdown}
              placeholder={actions.planMarkdownPlaceholder}
              disabled={isBusy}
              onChange={(e) => setDraftPlanMarkdown(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '12px', color: 'var(--nov-text-1)', fontWeight: 600 }}>
              {sDict.acceptanceTitle}
            </label>
            <textarea
              className="nov-p-textarea"
              style={{ fontFamily: 'var(--nov-font-sans)', minHeight: '64px' }}
              value={draftAcceptance}
              placeholder={actions.acceptancePlaceholder}
              disabled={isBusy}
              onChange={(e) => setDraftAcceptance(e.target.value)}
            />
          </div>

          <div className="nov-p-item" style={{ background: 'var(--nov-bg-0)', gap: '10px' }}>
            <div className="nov-p-row">
              <span style={{ fontSize: '12.5px' }}>{sDict.enforceLockLabel}</span>
              <button
                type="button"
                role="switch"
                aria-checked={draftEnforceLock}
                className="nov-switch"
                disabled={isBusy}
                onClick={() => setDraftEnforceLock((prev) => !prev)}
              >
                <span className="nov-switch-thumb" />
              </button>
            </div>
            <div className="nov-p-row">
              <span style={{ fontSize: '12.5px' }}>{sDict.requireUiApprovalLabel}</span>
              <button
                type="button"
                role="switch"
                aria-checked={draftRequireUiApproval}
                className="nov-switch"
                disabled={isBusy}
                onClick={() => setDraftRequireUiApproval((prev) => !prev)}
              >
                <span className="nov-switch-thumb" />
              </button>
            </div>
          </div>

          {/* Multi-task DAG builder */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <strong style={{ fontSize: '12.5px', color: 'var(--nov-text-0)' }}>
              {sDict.tasksTitle} ({draftTasks.length})
            </strong>

            <div className="nov-p-row" style={{ flexWrap: 'nowrap' }}>
              <input
                className="nov-p-input"
                value={newTaskTitle}
                placeholder={sDict.addTaskPlaceholder}
                disabled={isBusy}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddDraftTask();
                  }
                }}
              />
              <button
                type="button"
                className="nov-p-btn"
                style={{ flexShrink: 0 }}
                disabled={isBusy || !newTaskTitle.trim()}
                onClick={handleAddDraftTask}
              >
                + {actions.addTask}
              </button>
            </div>

            {draftTasks.length > 0 && (
              <div className="nov-p-list">
                {draftTasks.map((task) => {
                  const otherTasks = draftTasks.filter((o) => o.id !== task.id);
                  return (
                    <div key={task.id} className="nov-p-item">
                      <div className="nov-p-row">
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            flex: 1,
                            minWidth: '200px',
                          }}
                        >
                          <code
                            className="nov-badge"
                            style={{ fontFamily: 'var(--nov-font-mono)' }}
                          >
                            {task.id}
                          </code>
                          <input
                            className="nov-p-input"
                            value={task.title}
                            disabled={isBusy}
                            onChange={(e) => {
                              const next = e.target.value;
                              setDraftTasks((prev) =>
                                prev.map((item) =>
                                  item.id === task.id ? { ...item, title: next } : item,
                                ),
                              );
                            }}
                          />
                        </div>
                        <button
                          type="button"
                          className="nov-p-btn is-danger"
                          disabled={isBusy}
                          onClick={() => handleRemoveDraftTask(task.id)}
                        >
                          {dict.common.delete}
                        </button>
                      </div>

                      {otherTasks.length > 0 && (
                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            gap: '6px',
                            fontSize: '11.5px',
                            color: 'var(--nov-text-2)',
                          }}
                        >
                          <span>{actions.depsLabel}:</span>
                          {otherTasks.map((candidate) => {
                            const checked = task.dependsOn.includes(candidate.id);
                            const cycleBlocked =
                              !checked &&
                              wouldCreateDraftCycle(draftTasks, task.id, candidate.id);
                            return (
                              <button
                                key={candidate.id}
                                type="button"
                                className={`nov-cat-pill ${checked ? 'is-active' : ''}`}
                                disabled={isBusy || cycleBlocked}
                                onClick={() => handleToggleDraftDep(task.id, candidate.id)}
                              >
                                {checked ? '✓ ' : '+ '}
                                {candidate.id}: {candidate.title}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="nov-p-row" style={{ justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="nov-p-btn is-primary"
              disabled={isBusy || !draftTitle.trim() || !draftGoal.trim()}
              onClick={() => void handleCreateSpec()}
            >
              {busyAction === 'create' ? dict.common.loading : sDict.createSpecBtn}
            </button>
          </div>
        </section>
      )}
    </div>
  );
};
