import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NovBridge } from '../../bridge.js';
import { useNovI18n } from '../../i18n/index.js';
import './styles.css';

export interface NovModulePanelProps {
  bridge: NovBridge;
  active: boolean;
  onNotify?: (message: string) => void;
  incomingEvent?: { toolName?: string; structuredContent: Record<string, unknown> } | null;
}

type ArtifactKind = 'html' | 'svg' | 'markdown' | 'slides' | 'image';
type AnnotationTag = 'fix' | 'layout' | 'copy' | 'polish';

interface CanvasAnnotation {
  id: string;
  number: number;
  revision: number;
  slideIndex?: number;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  tag: AnnotationTag;
  note: string;
  status: 'open' | 'resolved';
  createdAt: string;
  resolvedAt?: string;
}

interface CanvasRevision {
  version: number;
  createdAt: string;
  summary: string;
  content: string;
}

interface CanvasBoard {
  id: string;
  title: string;
  kind: ArtifactKind;
  sourcePath?: string;
  sourceUri?: string;
  createdAt: string;
  updatedAt: string;
  currentVersion: number;
  revisions: CanvasRevision[];
  annotations: CanvasAnnotation[];
}

interface CanvasBoardSummary {
  id: string;
  title: string;
  kind: ArtifactKind;
  sourcePath?: string;
  currentVersion: number;
  openPins: number;
  totalPins: number;
  updatedAt: string;
}

interface CanvasBoardMeta {
  boardId?: string;
  id?: string;
}

interface CanvasPayload {
  boards?: CanvasBoardSummary[];
  board?: CanvasBoard | null;
}

interface CanvasFileViewerPayload {
  kind: 'opaque-uri' | 'svg' | 'data' | 'openapi';
  targetTab: 'studio' | 'canvas';
  fileName: string;
  extension: string;
  relPath?: string;
  resourceUri?: string;
  uri?: string;
  bytes?: number;
  mode?: 'live' | 'demo';
  readOnly?: boolean;
  note?: string;
  svg?: {
    content: string;
    bytes: number;
    lineCount: number;
    width?: string;
    height?: string;
    viewBox?: string;
  };
}

type HostSvgLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; reason: string }
  | { status: 'unsafe'; reason: string };

const SAFE_IMAGE_DATA_URI_PREFIX = /^data:image\/(png|jpeg|webp|gif);base64,/;
const BASE64_PAYLOAD_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function decodeSvgBase64ToUtf8(rawBase64: string): string | null {
  try {
    const clean = rawBase64.replace(/\s+/g, '');
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

import { validateClientSvgSafety } from './svg-safety.js';
export { validateClientSvgSafety };

function isSafeImageDataUri(src: string): boolean {
  if (typeof src !== 'string') return false;
  const trimmed = src.trim();
  if (!SAFE_IMAGE_DATA_URI_PREFIX.test(trimmed)) return false;
  const commaIdx = trimmed.indexOf(',');
  const payload = trimmed.slice(commaIdx + 1).replace(/\s+/g, '');
  return payload.length > 0 && BASE64_PAYLOAD_RE.test(payload);
}

function buildSafeSvgSrcDoc(svgContent: string, theme: 'dark' | 'light'): string {
  const bg = theme === 'light' ? '#f7f9fc' : '#0b111c';
  const cspMeta = [
    '<meta',
    'http-equiv="Content-Security-Policy"',
    'content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src data:;"',
    '/>',
  ].join(' ');
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8" />',
    cspMeta,
    '<style>',
    `html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: ${bg}; overflow: auto; }`,
    'body { display: flex; align-items: center; justify-content: center; padding: 14px; box-sizing: border-box; }',
    '.svg-stage { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }',
    '.svg-stage svg { max-width: 100%; max-height: 100%; display: block; }',
    '</style>',
    '</head>',
    `<body><div class="svg-stage">${svgContent}</div></body>`,
    '</html>',
  ].join('');
}

function isFullCanvasBoard(b: unknown): b is CanvasBoard {
  return Boolean(b && typeof b === 'object' && Array.isArray((b as CanvasBoard).revisions));
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const tokenRe = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > lastIdx) {
      nodes.push(text.slice(lastIdx, match.index));
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(<code key={key++}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('*') && token.endsWith('*')) {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>);
    } else {
      nodes.push(token);
    }
    lastIdx = match.index + token.length;
  }

  if (lastIdx < text.length) {
    nodes.push(text.slice(lastIdx));
  }
  return nodes;
}

const MarkdownView: React.FC<{ content: string }> = ({ content }) => {
  const blocks = useMemo(() => {
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    const elements: React.ReactNode[] = [];
    let i = 0;
    let key = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed) {
        i++;
        continue;
      }

      if (trimmed.startsWith('### ')) {
        elements.push(<h3 key={key++}>{renderInlineMarkdown(trimmed.slice(4))}</h3>);
        i++;
        continue;
      }
      if (trimmed.startsWith('## ')) {
        elements.push(<h2 key={key++}>{renderInlineMarkdown(trimmed.slice(3))}</h2>);
        i++;
        continue;
      }
      if (trimmed.startsWith('# ')) {
        elements.push(<h1 key={key++}>{renderInlineMarkdown(trimmed.slice(2))}</h1>);
        i++;
        continue;
      }

      if (/^[-*]\s+/.test(trimmed)) {
        const items: React.ReactNode[] = [];
        while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
          items.push(<li key={items.length}>{renderInlineMarkdown(lines[i].trim().replace(/^[-*]\s+/, ''))}</li>);
          i++;
        }
        elements.push(<ul key={key++}>{items}</ul>);
        continue;
      }

      if (/^\d+\.\s+/.test(trimmed)) {
        const items: React.ReactNode[] = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
          items.push(<li key={items.length}>{renderInlineMarkdown(lines[i].trim().replace(/^\d+\.\s+/, ''))}</li>);
          i++;
        }
        elements.push(<ol key={key++}>{items}</ol>);
        continue;
      }

      const paraLines: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() !== '' &&
        !/^#{1,3}\s+/.test(lines[i].trim()) &&
        !/^[-*]\s+/.test(lines[i].trim()) &&
        !/^\d+\.\s+/.test(lines[i].trim())
      ) {
        paraLines.push(lines[i]);
        i++;
      }
      elements.push(
        <p key={key++}>
          {paraLines.map((pl, idx) => (
            <React.Fragment key={idx}>
              {idx > 0 && <br />}
              {renderInlineMarkdown(pl)}
            </React.Fragment>
          ))}
        </p>,
      );
    }

    return elements;
  }, [content]);

  return <div className="canvas-stage-md">{blocks}</div>;
};

export const CanvasPanel: React.FC<NovModulePanelProps> = ({
  bridge,
  active,
  onNotify,
  incomingEvent,
}) => {
  const { dict, t } = useNovI18n();
  const c = dict.panels.canvas;
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

  const [boards, setBoards] = useState<CanvasBoardSummary[]>([]);
  const [board, setBoard] = useState<CanvasBoard | null>(null);
  const [viewVersion, setViewVersion] = useState<number>(1);
  const [slideIdx, setSlideIdx] = useState<number>(0);
  const [annotateMode, setAnnotateMode] = useState<boolean>(true);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [dragBox, setDragBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [draftBox, setDraftBox] = useState<{ xPct: number; yPct: number; wPct: number; hPct: number } | null>(null);
  const [draftTag, setDraftTag] = useState<AnnotationTag>('fix');
  const [draftNote, setDraftNote] = useState('');
  const [compiledPreview, setCompiledPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [resolvingAll, setResolvingAll] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [localToast, setLocalToast] = useState<string | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => bridge.getTheme());
  const [fileViewer, setFileViewer] = useState<CanvasFileViewerPayload | null>(null);
  const [hostSvgState, setHostSvgState] = useState<HostSvgLoadState>({ status: 'idle' });

  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const fetchSeqRef = useRef<number>(0);
  const hostSvgSeqRef = useRef<number>(0);
  const loadedOnceRef = useRef<boolean>(false);
  const lastEventRef = useRef<typeof incomingEvent>(null);
  const toastTimerRef = useRef<number | null>(null);

  const notify = useCallback(
    (msg: string) => {
      if (onNotify) {
        onNotify(msg);
        return;
      }
      setLocalToast(msg);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => setLocalToast(null), 2600);
    },
    [onNotify],
  );

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setTheme(bridge.getTheme());
    return bridge.onThemeChange((nextTheme) => setTheme(nextTheme));
  }, [bridge]);

  const loadFullBoard = useCallback(
    async (targetBoardId?: string, resetSelection = false) => {
      const seq = ++fetchSeqRef.current;
      setLoading(true);
      setErrorMsg(null);
      try {
        const args = targetBoardId !== undefined ? { boardId: targetBoardId } : {};
        const res = await bridge.callTool<CanvasPayload>('app_canvas_get_board', args);
        if (seq !== fetchSeqRef.current) return;

        if (Array.isArray(res.boards)) {
          setBoards(res.boards);
        } else {
          const listRes = await bridge.callTool<{ boards?: CanvasBoardSummary[] }>('app_canvas_list_boards', {});
          if (seq !== fetchSeqRef.current) return;
          if (Array.isArray(listRes.boards)) setBoards(listRes.boards);
        }

        if (res.board !== undefined) {
          setBoard(res.board);
          if (res.board) {
            setViewVersion(res.board.currentVersion);
          }
          if (resetSelection) {
            setSlideIdx(0);
            setDraftBox(null);
            setSelectedPinId(null);
            setCompiledPreview(null);
          }
        }
        loadedOnceRef.current = true;
      } catch (err) {
        if (seq !== fetchSeqRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMsg(msg);
      } finally {
        if (seq === fetchSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [bridge],
  );

  // Initial load when tab becomes active
  useEffect(() => {
    if (!active) return;
    if (!loadedOnceRef.current) {
      void loadFullBoard();
    }
  }, [active, loadFullBoard]);

  const loadHostOpaqueSvg = useCallback(
    async (fv: CanvasFileViewerPayload) => {
      const targetUri = (fv.resourceUri || fv.uri || '').trim();
      if (!targetUri) return;
      const seq = ++hostSvgSeqRef.current;
      setHostSvgState({ status: 'loading' });
      try {
        const res = await bridge.readHostResource(targetUri);
        if (seq !== hostSvgSeqRef.current) return;
        if (!res.ok) {
          setHostSvgState({ status: 'error', reason: res.error });
          return;
        }
        const rawText =
          typeof res.text === 'string'
            ? res.text
            : typeof res.blob === 'string'
              ? decodeSvgBase64ToUtf8(res.blob)
              : null;
        if (!rawText) {
          setHostSvgState({ status: 'error', reason: 'Empty resource payload' });
          return;
        }
        const check = validateClientSvgSafety(rawText);
        if (!check.safe) {
          setHostSvgState({ status: 'unsafe', reason: check.reason });
          return;
        }
        setHostSvgState({ status: 'idle' });
        setFileViewer({
          ...fv,
          kind: 'svg',
          bytes: res.byteLength,
          svg: {
            content: check.content,
            bytes: res.byteLength,
            lineCount: check.lineCount,
            viewBox: check.viewBox,
          },
        });
      } catch (err) {
        if (seq !== hostSvgSeqRef.current) return;
        setHostSvgState({
          status: 'error',
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [bridge],
  );

  // Respond to incoming tool result events (e.g., canvas_publish_artifact / canvas_open_file / app_nov_file_viewer)
  useEffect(() => {
    if (!incomingEvent || incomingEvent === lastEventRef.current) return;
    const sc = incomingEvent.structuredContent;
    if (!sc || typeof sc !== 'object') return;

    const rawFileViewer =
      sc.fileViewer && typeof sc.fileViewer === 'object'
        ? (sc.fileViewer as CanvasFileViewerPayload)
        : null;
    const isCanvasFileViewer = Boolean(
      rawFileViewer &&
        typeof rawFileViewer.fileName === 'string' &&
        (rawFileViewer.targetTab === 'canvas' ||
          rawFileViewer.kind === 'svg' ||
          (typeof rawFileViewer.extension === 'string' &&
            rawFileViewer.extension.toLowerCase() === '.svg')),
    );

    const rawBoard = sc.board as CanvasBoard | CanvasBoardMeta | null | undefined;
    const hasCanvasPayload =
      isCanvasFileViewer ||
      sc.novModule === 'canvas' ||
      typeof sc.boardId === 'string' ||
      sc.boardId === null ||
      rawBoard !== undefined ||
      Array.isArray(sc.boards) ||
      (typeof incomingEvent.toolName === 'string' && incomingEvent.toolName.includes('canvas'));

    if (!hasCanvasPayload) return;
    lastEventRef.current = incomingEvent;

    if (isCanvasFileViewer && rawFileViewer) {
      setFileViewer(rawFileViewer);
      setHostSvgState({ status: 'idle' });
      loadedOnceRef.current = true;
      if (rawFileViewer.kind === 'opaque-uri' && (rawFileViewer.resourceUri || rawFileViewer.uri)) {
        void loadHostOpaqueSvg(rawFileViewer);
      }
      if (rawBoard === undefined && !Array.isArray(sc.boards) && sc.boardId === undefined) {
        return;
      }
    }

    if (Array.isArray(sc.boards)) {
      setBoards(sc.boards as CanvasBoardSummary[]);
    }

    if (isFullCanvasBoard(rawBoard)) {
      setBoard(rawBoard);
      setViewVersion(rawBoard.currentVersion);
      setSlideIdx(0);
      setDraftBox(null);
      setCompiledPreview(null);
      loadedOnceRef.current = true;
      return;
    }

    const targetId =
      typeof sc.boardId === 'string'
        ? sc.boardId
        : rawBoard && typeof rawBoard === 'object'
          ? rawBoard.boardId || rawBoard.id
          : undefined;

    if (targetId) {
      void loadFullBoard(targetId, true);
    } else if (sc.board === null && sc.boardId === null) {
      setBoard(null);
      loadedOnceRef.current = true;
    } else if (active) {
      void loadFullBoard(undefined, false);
    }
  }, [incomingEvent, active, loadFullBoard, loadHostOpaqueSvg]);

  const handleRefresh = async () => {
    try {
      const listRes = await bridge.callTool<{ boards?: CanvasBoardSummary[] }>('app_canvas_list_boards', {});
      if (Array.isArray(listRes.boards)) {
        setBoards(listRes.boards);
      }
    } catch {
      // loadFullBoard will surface any error
    }
    await loadFullBoard(board?.id, false);
  };

  const handleSelectBoard = async (id: string) => {
    await loadFullBoard(id, true);
  };

  const currentRev =
    board?.revisions.find((r) => r.version === viewVersion) ??
    board?.revisions[board.revisions.length - 1];

  const slides = useMemo(() => {
    if (!currentRev || board?.kind !== 'slides') return [];
    return currentRev.content
      .split(/^---$/gm)
      .map((s) => s.trim())
      .filter(Boolean);
  }, [board?.kind, currentRev]);

  const svgSrcDoc = useMemo(() => {
    if (!currentRev || board?.kind !== 'svg') return '';
    return buildSafeSvgSrcDoc(currentRev.content, theme);
  }, [board?.kind, currentRev, theme]);

  const fileViewerSvgSrcDoc = useMemo(() => {
    if (!fileViewer || fileViewer.kind !== 'svg' || !fileViewer.svg?.content) return '';
    return buildSafeSvgSrcDoc(fileViewer.svg.content, theme);
  }, [fileViewer, theme]);

  const safeImageSrc = useMemo(() => {
    if (!currentRev || board?.kind !== 'image') return null;
    return isSafeImageDataUri(currentRev.content) ? currentRev.content.trim() : null;
  }, [board?.kind, currentRev]);

  const visiblePins = useMemo(() => {
    if (!board) return [];
    return board.annotations.filter((a) =>
      board.kind === 'slides' ? (a.slideIndex ?? 0) === slideIdx : true,
    );
  }, [board, slideIdx]);

  const toPct = (e: React.MouseEvent) => {
    const rect = overlayRef.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
    return { x, y };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (!annotateMode || !overlayRef.current) return;
    if ((e.target as HTMLElement).closest('.canvas-pin-box')) return;
    const pt = toPct(e);
    dragStart.current = pt;
    setDragBox({ x: pt.x, y: pt.y, w: 0, h: 0 });
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragStart.current || !overlayRef.current) return;
    const pt = toPct(e);
    const sx = dragStart.current.x;
    const sy = dragStart.current.y;
    setDragBox({
      x: Math.min(sx, pt.x),
      y: Math.min(sy, pt.y),
      w: Math.abs(pt.x - sx),
      h: Math.abs(pt.y - sy),
    });
  };

  const finishDrag = () => {
    if (!dragStart.current || !dragBox) return;
    dragStart.current = null;
    setDraftBox({
      xPct: Number(dragBox.x.toFixed(1)),
      yPct: Number(dragBox.y.toFixed(1)),
      wPct: dragBox.w > 1.5 ? Number(dragBox.w.toFixed(1)) : 0,
      hPct: dragBox.h > 1.5 ? Number(dragBox.h.toFixed(1)) : 0,
    });
    setDragBox(null);
  };

  const handleSavePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!board || !draftBox || !draftNote.trim()) return;
    try {
      const res = await bridge.callTool<CanvasPayload>('app_canvas_add_annotation', {
        boardId: board.id,
        ...draftBox,
        tag: draftTag,
        note: draftNote.trim(),
        revision: viewVersion,
        ...(board.kind === 'slides' ? { slideIndex: slideIdx } : {}),
      });
      if (Array.isArray(res.boards)) setBoards(res.boards);
      if (res.board) setBoard(res.board);
      const savedNum =
        res.board?.annotations[res.board.annotations.length - 1]?.number ??
        (board.annotations.length + 1);
      setDraftBox(null);
      setDraftNote('');
      notify(t(c.toastPinSaved, { n: savedNum }));
    } catch (err) {
      notify(t(dict.common.actionFailed, { error: err instanceof Error ? err.message : String(err) }));
    }
  };

  const handleTogglePin = async (pin: CanvasAnnotation) => {
    if (!board) return;
    try {
      const res = await bridge.callTool<CanvasPayload>('app_canvas_toggle_annotation', {
        boardId: board.id,
        annotationId: pin.id,
        status: pin.status === 'open' ? 'resolved' : 'open',
      });
      if (res.board) setBoard(res.board);
      if (Array.isArray(res.boards)) setBoards(res.boards);
    } catch (err) {
      notify(t(dict.common.actionFailed, { error: err instanceof Error ? err.message : String(err) }));
    }
  };

  const handleDeletePin = async (pinId: string) => {
    if (!board) return;
    try {
      const res = await bridge.callTool<CanvasPayload>('app_canvas_delete_annotation', {
        boardId: board.id,
        annotationId: pinId,
      });
      if (res.board) setBoard(res.board);
      if (Array.isArray(res.boards)) setBoards(res.boards);
      if (selectedPinId === pinId) setSelectedPinId(null);
    } catch (err) {
      notify(t(dict.common.actionFailed, { error: err instanceof Error ? err.message : String(err) }));
    }
  };

  const handleResolveAll = async () => {
    if (!board || resolvingAll) return;
    const openPins = board.annotations.filter((a) => a.status === 'open');
    if (openPins.length === 0) return;
    setResolvingAll(true);
    let lastRes: CanvasPayload | null = null;
    try {
      for (const pin of openPins) {
        lastRes = await bridge.callTool<CanvasPayload>('app_canvas_toggle_annotation', {
          boardId: board.id,
          annotationId: pin.id,
          status: 'resolved',
        });
      }
      notify(c.resolveAll);
    } catch (err) {
      notify(t(dict.common.actionFailed, { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      if (lastRes?.board) setBoard(lastRes.board);
      if (Array.isArray(lastRes?.boards)) setBoards(lastRes.boards);
      setResolvingAll(false);
    }
  };

  const handleSendFeedback = async () => {
    if (!board) return;
    try {
      const res = await bridge.callTool<{ prompt?: string }>('app_canvas_compile_feedback', {
        boardId: board.id,
      });
      const prompt = String(res.prompt ?? '');
      if (!prompt) {
        notify(c.toastNoOpenPins);
        return;
      }
      const openPinsCount = board.annotations.filter((a) => a.status === 'open').length || 1;
      setCompiledPreview(prompt);
      const mode = await bridge.sendMessage(prompt);
      notify(
        mode === 'sent'
          ? t(c.toastFeedbackSent, { n: openPinsCount })
          : mode === 'context'
            ? t(c.toastFeedbackContext, { n: openPinsCount })
            : t(c.toastFeedbackCopied, { n: openPinsCount }),
      );
    } catch (err) {
      notify(t(dict.common.actionFailed, { error: err instanceof Error ? err.message : String(err) }));
    }
  };

  const openCount = board ? board.annotations.filter((a) => a.status === 'open').length : 0;

  return (
    <div className="mod-canvas">
      <header className="canvas-hdr">
        <div className="canvas-brand">
          <span className="canvas-logo">CV</span>
          <span>{c.title}</span>
          {boards.length > 0 && (
            <select
              className="canvas-select"
              aria-label={c.title}
              title={c.publishNew}
              value={board?.id ?? ''}
              onChange={(e) => void handleSelectBoard(e.target.value)}
            >
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title} (v{b.currentVersion} · {b.openPins})
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="canvas-row">
          {board && board.revisions.length > 0 && (
            <select
              className="canvas-select"
              aria-label={c.selectRevisionAria}
              value={viewVersion}
              onChange={(e) => setViewVersion(Number(e.target.value))}
            >
              {board.revisions.map((r) => (
                <option key={r.version} value={r.version}>
                  v{r.version}: {r.summary.slice(0, 26)}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="canvas-btn"
            onClick={() => void handleRefresh()}
            disabled={loading}
          >
            {loading ? dict.common.loading : dict.common.refresh}
          </button>
          <button
            type="button"
            className={`canvas-btn ${annotateMode ? 'is-active' : ''}`}
            onClick={() => setAnnotateMode((v) => !v)}
          >
            {annotateMode ? c.annotations : c.preview}
          </button>
          {(board?.sourceUri || board?.sourcePath) && (
            <button
              type="button"
              className="canvas-btn"
              onClick={async () => {
                const target = board.sourceUri || board.sourcePath!;
                const ok = await bridge.openFile(target);
                if (!ok) {
                  try {
                    await navigator.clipboard?.writeText(target);
                  } catch {
                    // ignore clipboard failure
                  }
                }
                notify(
                  ok
                    ? t(c.toastOpenedSource, { file: target })
                    : t(c.toastOpenSourceFallback, { file: target }),
                );
              }}
            >
              {c.openFile}
            </button>
          )}
          <button
            type="button"
            className="canvas-btn is-send"
            onClick={() => void handleSendFeedback()}
            disabled={!board}
          >
            {canSendMessage ? c.sendFeedback : dict.common.copyPrompt} ({openCount})
          </button>
        </div>
      </header>

      {errorMsg && <div className="canvas-error" role="alert">{errorMsg}</div>}

      {fileViewer && (
        <section
          className="canvas-pin-card is-active"
          aria-label={c.nativeFileViewer}
          style={{ flexShrink: 0 }}
        >
          <div className="canvas-row" style={{ justifyContent: 'space-between' }}>
            <div className="canvas-row">
              <span className="canvas-badge">{c.nativeFileViewer}</span>
              <span className="canvas-badge">{dict.common.readOnlyBadge}</span>
              <strong>{fileViewer.fileName}</strong>
              <span className="canvas-badge">{fileViewer.extension}</span>
              {typeof fileViewer.bytes === 'number' && (
                <span className="canvas-badge">{fileViewer.bytes} B</span>
              )}
              {fileViewer.svg?.viewBox && (
                <span className="canvas-badge">viewBox: {fileViewer.svg.viewBox}</span>
              )}
            </div>
            <button
              type="button"
              className="canvas-btn is-compact"
              onClick={() => {
                setFileViewer(null);
                setHostSvgState({ status: 'idle' });
              }}
            >
              {c.closePreview}
            </button>
          </div>
          {fileViewer.relPath && <div className="canvas-muted">{fileViewer.relPath}</div>}
          {(fileViewer.resourceUri || fileViewer.uri) && (
            <div className="canvas-muted" style={{ wordBreak: 'break-all' }}>
              URI: {fileViewer.resourceUri || fileViewer.uri}
            </div>
          )}
          {fileViewer.note && <div className="canvas-pin-note">{fileViewer.note}</div>}
          {hostSvgState.status === 'loading' && (
            <div className="canvas-muted">{c.hostSvgLoading}</div>
          )}
          {hostSvgState.status === 'error' && (
            <div className="canvas-error" role="alert">
              {t(c.hostSvgReadFailed, { reason: hostSvgState.reason })}
            </div>
          )}
          {hostSvgState.status === 'unsafe' && (
            <div className="canvas-error" role="alert">
              {t(c.hostSvgUnsafeRejected, { reason: hostSvgState.reason })}
            </div>
          )}
        </section>
      )}

      {fileViewer && fileViewer.kind === 'svg' && fileViewerSvgSrcDoc ? (
        <div className="canvas-stage-card" style={{ flex: 1, minHeight: 240 }}>
          <div className="canvas-stage-bar">
            <span>
              <strong>{c.svgFileViewer}</strong> · {fileViewer.fileName}
              {fileViewer.svg ? ` · ${t(c.svgLinesCount, { n: fileViewer.svg.lineCount })}` : ''}
            </span>
            <span className="canvas-badge">{c.sandboxedBadge}</span>
          </div>
          <div className="canvas-stage-body">
            <iframe
              className="canvas-stage-iframe canvas-stage-svg-iframe"
              title={fileViewer.fileName}
              sandbox=""
              referrerPolicy="no-referrer"
              srcDoc={fileViewerSvgSrcDoc}
            />
          </div>
        </div>
      ) : !board || !currentRev ? (
        <div className="canvas-stage-card canvas-empty-card">
          <strong>{loading ? dict.common.loading : c.emptyCanvas}</strong>
          <p>
            {c.publishNew}: <code>canvas_publish_artifact</code> / <code>canvas_open_file</code>
          </p>
        </div>
      ) : (
        <div className="canvas-workspace">
          <div className="canvas-stage-card">
            <div className="canvas-stage-bar">
              <span>
                <strong>{board.kind.toUpperCase()}</strong> · v{currentRev.version} ·{' '}
                {annotateMode ? c.pinPlaceholder : c.preview}
              </span>
              {board.kind === 'slides' && slides.length > 0 && (
                <div className="canvas-row">
                  <button
                    type="button"
                    className="canvas-btn is-compact"
                    onClick={() => setSlideIdx((i) => Math.max(0, i - 1))}
                    disabled={slideIdx === 0}
                  >
                    {c.slidePrev}
                  </button>
                  <span className="canvas-badge">
                    {t(c.slideCounter, { current: slideIdx + 1, total: slides.length })}
                  </span>
                  <button
                    type="button"
                    className="canvas-btn is-compact"
                    onClick={() => setSlideIdx((i) => Math.min(slides.length - 1, i + 1))}
                    disabled={slideIdx >= slides.length - 1}
                  >
                    {c.slideNext}
                  </button>
                </div>
              )}
            </div>

            <div className={`canvas-stage-body ${annotateMode ? 'is-annotating' : ''}`}>
              {board.kind === 'html' && (
                <iframe
                  className="canvas-stage-iframe"
                  title={board.title}
                  sandbox="allow-scripts"
                  referrerPolicy="no-referrer"
                  srcDoc={currentRev.content}
                />
              )}
              {board.kind === 'svg' && (
                <iframe
                  className="canvas-stage-iframe canvas-stage-svg-iframe"
                  title={board.title}
                  sandbox=""
                  referrerPolicy="no-referrer"
                  srcDoc={svgSrcDoc}
                />
              )}
              {board.kind === 'markdown' && <MarkdownView content={currentRev.content} />}
              {board.kind === 'slides' && <MarkdownView content={slides[slideIdx] ?? ''} />}
              {board.kind === 'image' && (
                <div className="canvas-stage-image">
                  {safeImageSrc ? (
                    <img
                      src={safeImageSrc}
                      alt={board.title}
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="canvas-stage-blocked" role="alert">
                      <strong>{c.blockedImageTitle}</strong>
                      <p>{c.blockedImageDesc}</p>
                    </div>
                  )}
                </div>
              )}

              <div
                ref={overlayRef}
                className={`canvas-overlay ${annotateMode ? '' : 'is-passive'}`}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={finishDrag}
                onMouseLeave={finishDrag}
              >
                {dragBox && (
                  <div
                    className="canvas-pin-box"
                    style={{
                      left: `${dragBox.x}%`,
                      top: `${dragBox.y}%`,
                      width: `${Math.max(1, dragBox.w)}%`,
                      height: `${Math.max(1, dragBox.h)}%`,
                    }}
                  />
                )}
                {draftBox && (
                  <div
                    className={`canvas-pin-box is-${draftTag}`}
                    style={{
                      left: `${draftBox.xPct}%`,
                      top: `${draftBox.yPct}%`,
                      width: `${Math.max(2.5, draftBox.wPct)}%`,
                      height: `${Math.max(2.5, draftBox.hPct)}%`,
                    }}
                  >
                    <span className="canvas-pin-badge">+</span>
                  </div>
                )}
                {visiblePins.map((pin) => (
                  <div
                    key={pin.id}
                    className={`canvas-pin-box is-${pin.tag} ${pin.status === 'resolved' ? 'is-resolved' : ''}`}
                    style={{
                      left: `${pin.xPct}%`,
                      top: `${pin.yPct}%`,
                      width: `${Math.max(2.5, pin.wPct)}%`,
                      height: `${Math.max(2.5, pin.hPct)}%`,
                    }}
                    onClick={() => setSelectedPinId(pin.id)}
                    title={`#${pin.number} [${pin.tag}]: ${pin.note}`}
                  >
                    <span className="canvas-pin-badge">{pin.number}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <aside className="canvas-sidebar">
            <div className="canvas-row" style={{ justifyContent: 'space-between' }}>
              <strong className="canvas-sidebar-title">
                {c.annotations} ({openCount})
              </strong>
              {openCount > 0 && (
                <button
                  type="button"
                  className="canvas-btn is-compact"
                  disabled={resolvingAll}
                  onClick={() => void handleResolveAll()}
                >
                  {resolvingAll ? dict.common.loading : c.resolveAll}
                </button>
              )}
            </div>

            {draftBox && (
              <form className="canvas-pin-card is-active" onSubmit={(e) => void handleSavePin(e)}>
                <div className="canvas-row" style={{ justifyContent: 'space-between' }}>
                  <strong>{c.annotations}</strong>
                  <span className="canvas-badge">
                    x:{draftBox.xPct}% y:{draftBox.yPct}%
                  </span>
                </div>
                <select
                  className="canvas-select"
                  value={draftTag}
                  onChange={(e) => setDraftTag(e.target.value as AnnotationTag)}
                >
                  <option value="fix">{c.tagFix}</option>
                  <option value="layout">{c.tagLayout}</option>
                  <option value="copy">{c.tagCopy}</option>
                  <option value="polish">{c.tagPolish}</option>
                </select>
                <textarea
                  className="canvas-textarea"
                  rows={2}
                  autoFocus
                  placeholder={c.pinPlaceholder}
                  value={draftNote}
                  onChange={(e) => setDraftNote(e.target.value)}
                />
                <div className="canvas-row">
                  <button type="submit" className="canvas-btn is-send" style={{ flex: 1 }}>
                    {dict.common.save}
                  </button>
                  <button type="button" className="canvas-btn" onClick={() => setDraftBox(null)}>
                    {dict.common.clear}
                  </button>
                </div>
              </form>
            )}

            {board.annotations.length === 0 ? (
              <div className="canvas-muted">{c.pinPlaceholder}</div>
            ) : (
              board.annotations.map((pin) => (
                <div
                  key={pin.id}
                  className={`canvas-pin-card ${selectedPinId === pin.id ? 'is-active' : ''}`}
                  onClick={() => setSelectedPinId(pin.id)}
                >
                  <div className="canvas-row" style={{ justifyContent: 'space-between' }}>
                    <span>
                      <strong>#{pin.number}</strong>{' '}
                      <span className="canvas-badge">
                        {pin.tag === 'fix'
                          ? c.tagFix
                          : pin.tag === 'layout'
                            ? c.tagLayout
                            : pin.tag === 'copy'
                              ? c.tagCopy
                              : c.tagPolish}
                      </span>
                    </span>
                    <span className="canvas-badge">
                      {pin.status === 'resolved'
                        ? dict.panels.review.resolved
                        : dict.panels.review.unresolved}
                    </span>
                  </div>
                  <div className="canvas-pin-note">{pin.note}</div>
                  <div className="canvas-pin-meta">
                    <span>
                      x:{pin.xPct}% y:{pin.yPct}%{pin.wPct > 1 ? ` (${pin.wPct}×${pin.hPct}%)` : ''}
                    </span>
                    <div className="canvas-row">
                      <button
                        type="button"
                        className="canvas-btn is-compact"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleTogglePin(pin);
                        }}
                      >
                        {pin.status === 'open' ? c.resolvePin : c.reopenPin}
                      </button>
                      <button
                        type="button"
                        className="canvas-btn is-compact"
                        title={dict.common.delete}
                        aria-label={`${dict.common.delete} #${pin.number}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeletePin(pin.id);
                        }}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}

            {compiledPreview && (
              <div className="canvas-pin-card">
                <strong style={{ fontSize: 11.5 }}>{c.lastSentPrompt}</strong>
                <pre className="canvas-pre">{compiledPreview}</pre>
              </div>
            )}
          </aside>
        </div>
      )}

      {!onNotify && localToast && <div className="canvas-toast">{localToast}</div>}
    </div>
  );
};
