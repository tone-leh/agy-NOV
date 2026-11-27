import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getModuleDataDir, resolveNovDataDir } from '../../core/config.js';
import type {
  ModuleRegistrationResult,
  ModuleToolHandle,
  NovRuntimeOptions,
} from '../../core/types.js';
import {
  CanvasStore,
  compileFeedbackPrompt,
  loadLocalFileContent,
  toBoardMeta,
} from './store.js';
import { isSafeImageDataUri } from './validation.js';

function toHandle(
  name: string,
  reg: { enable: () => void; disable: () => void },
): ModuleToolHandle {
  return {
    name,
    enable: () => reg.enable(),
    disable: () => reg.disable(),
  };
}

export function registerCanvasModule(
  server: McpServer,
  opts: NovRuntimeOptions,
  uiResourceUri: string,
): ModuleRegistrationResult {
  const rootDataDir = resolveNovDataDir(opts.dataDir);
  const dataDir = getModuleDataDir(rootDataDir, 'canvas');
  const workspaceRoot = path.resolve(opts.workspaceRoot || process.cwd());
  const store = new CanvasStore(dataDir, Boolean(opts.demoMode));

  const UI_META = {
    ui: { resourceUri: uiResourceUri },
  };

  const APP_ONLY_META = {
    ui: {
      resourceUri: uiResourceUri,
      visibility: ['app'] as ['app'],
    },
  };

  const modelTools: ModuleToolHandle[] = [];

  // 1. Model-visible: publish or update a versioned visual artifact
  const publishTool = server.registerTool(
    'canvas_publish_artifact',
    {
      title: 'Publish Visual Artifact to Canvas',
      description:
        'Render an HTML prototype, SVG diagram, Markdown spec, Slide deck (--- separated), or base64 data-URI raster image into Visual Canvas with automatic versioning (v1, v2, ...).',
      inputSchema: {
        boardId: z.string().optional().describe('Stable board ID to push a new revision to'),
        title: z.string().min(1),
        kind: z.enum(['html', 'svg', 'markdown', 'slides', 'image']),
        content: z.string().min(1),
        summary: z.string().optional().describe('Short note describing this revision'),
        sourcePath: z.string().optional().describe('Optional absolute file path backing this artifact'),
      },
      _meta: UI_META,
    },
    async (input) => {
      if (input.kind === 'image' && !isSafeImageDataUri(input.content)) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'Rejected image artifact: only base64 data:image/(png|jpeg|webp|gif) URIs are allowed.',
            },
          ],
        };
      }
      const board = store.publishArtifact(input);
      const boards = store.listBoards();
      return {
        content: [
          {
            type: 'text',
            text: `Published "${board.title}" (boardId="${board.id}", v${board.currentVersion}) to Visual Canvas. User can now click/drag annotations and send pinpoint feedback.`,
          },
        ],
        structuredContent: {
          novModule: 'canvas',
          boards,
          boardId: board.id,
          board: toBoardMeta(board),
        },
      };
    },
  );
  modelTools.push(toHandle('canvas_publish_artifact', publishTool));

  // 2. Model-visible: load a workspace-scoped visual file onto the canvas
  const openFileTool = server.registerTool(
    'canvas_open_file',
    {
      title: 'Open Local File on Canvas',
      description:
        'Load an existing workspace HTML, SVG, Markdown, slide deck, or raster image file onto Visual Canvas for visual annotation.',
      inputSchema: {
        filePath: z.string().min(1),
        title: z.string().optional(),
        boardId: z.string().optional(),
      },
      _meta: UI_META,
    },
    async ({ filePath, title, boardId }) => {
      let loaded: ReturnType<typeof loadLocalFileContent>;
      try {
        loaded = loadLocalFileContent(filePath, workspaceRoot);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to load local file.';
        return {
          isError: true,
          content: [{ type: 'text', text: message }],
        };
      }
      const board = store.publishArtifact({
        boardId,
        title: title || path.basename(loaded.resolvedPath),
        kind: loaded.kind,
        content: loaded.content,
        sourcePath: loaded.resolvedPath,
        summary: `Loaded from ${path.basename(loaded.resolvedPath)}`,
      });
      return {
        content: [
          {
            type: 'text',
            text: `Loaded ${path.basename(loaded.resolvedPath)} as "${board.title}" (${board.kind}, v${board.currentVersion}) on Visual Canvas.`,
          },
        ],
        structuredContent: {
          novModule: 'canvas',
          boards: store.listBoards(),
          boardId: board.id,
          board: toBoardMeta(board),
        },
      };
    },
  );
  modelTools.push(toHandle('canvas_open_file', openFileTool));

  // 3. Model-visible: read open review feedback
  const getFeedbackTool = server.registerTool(
    'canvas_get_feedback',
    {
      title: 'Get Open Canvas Feedback',
      description: 'Return all open numbered review pins and compiled revision prompt for a canvas board.',
      inputSchema: {
        boardId: z.string().optional(),
      },
    },
    async ({ boardId }) => {
      const board = store.getBoard(boardId);
      if (!board) {
        return {
          content: [
            {
              type: 'text',
              text: boardId !== undefined ? `Canvas board "${boardId}" not found.` : 'No canvas board found.',
            },
          ],
        };
      }
      const prompt = compileFeedbackPrompt(board);
      return {
        content: [{ type: 'text', text: prompt }],
        structuredContent: { boardId: board.id, prompt, annotations: board.annotations },
      };
    },
  );
  modelTools.push(toHandle('canvas_get_feedback', getFeedbackTool));

  // 4. Model-visible: mark annotations resolved after applying edits
  const resolveTool = server.registerTool(
    'canvas_resolve_annotations',
    {
      title: 'Resolve Canvas Annotations',
      description: 'Mark specific review pin IDs (or all open pins when annotationIds is omitted) as resolved.',
      inputSchema: {
        boardId: z.string().min(1),
        annotationIds: z.array(z.string()).optional(),
      },
    },
    async ({ boardId, annotationIds }) => {
      const board = store.updateAnnotationStatus(boardId, annotationIds ?? [], 'resolved');
      if (!board) {
        return { content: [{ type: 'text', text: `Board "${boardId}" not found.` }] };
      }
      return {
        content: [
          {
            type: 'text',
            text: `Resolved annotations on "${board.title}". Remaining open pins: ${board.annotations.filter((a) => a.status === 'open').length}.`,
          },
        ],
        structuredContent: {
          boards: store.listBoards(),
          boardId: board.id,
          board: toBoardMeta(board),
        },
      };
    },
  );
  modelTools.push(toHandle('canvas_resolve_annotations', resolveTool));

  // App-only tools (6)
  server.registerTool(
    'app_canvas_list_boards',
    {
      title: 'List Canvas Boards (App Only)',
      description: 'List saved canvas boards.',
      inputSchema: {},
      _meta: APP_ONLY_META,
    },
    async () => ({
      content: [{ type: 'text', text: 'ok' }],
      structuredContent: { boards: store.listBoards() },
    }),
  );

  server.registerTool(
    'app_canvas_get_board',
    {
      title: 'Get Canvas Board (App Only)',
      description: 'Fetch full board content and revision history.',
      inputSchema: { boardId: z.string().optional() },
      _meta: APP_ONLY_META,
    },
    async ({ boardId }) => ({
      content: [{ type: 'text', text: 'ok' }],
      structuredContent: { boards: store.listBoards(), board: store.getBoard(boardId) },
    }),
  );

  server.registerTool(
    'app_canvas_add_annotation',
    {
      title: 'Add Visual Pin (App Only)',
      description: 'Persist a point or bounding-box review annotation on disk.',
      inputSchema: {
        boardId: z.string(),
        xPct: z.number(),
        yPct: z.number(),
        wPct: z.number().optional(),
        hPct: z.number().optional(),
        tag: z.enum(['fix', 'layout', 'copy', 'polish']).optional(),
        note: z.string().min(1),
        revision: z.number().int().optional(),
        slideIndex: z.number().int().optional(),
      },
      _meta: APP_ONLY_META,
    },
    async (input) => {
      const board = store.addAnnotation(input.boardId, input);
      return {
        content: [{ type: 'text', text: 'added' }],
        structuredContent: { boards: store.listBoards(), board },
      };
    },
  );

  server.registerTool(
    'app_canvas_toggle_annotation',
    {
      title: 'Toggle Pin Status (App Only)',
      description: 'Toggle an annotation between open and resolved.',
      inputSchema: {
        boardId: z.string(),
        annotationId: z.string(),
        status: z.enum(['open', 'resolved']),
      },
      _meta: APP_ONLY_META,
    },
    async ({ boardId, annotationId, status }) => {
      const board = store.updateAnnotationStatus(boardId, [annotationId], status);
      return {
        content: [{ type: 'text', text: status }],
        structuredContent: { boards: store.listBoards(), board },
      };
    },
  );

  server.registerTool(
    'app_canvas_delete_annotation',
    {
      title: 'Delete Pin (App Only)',
      description: 'Remove an annotation from a board.',
      inputSchema: { boardId: z.string(), annotationId: z.string() },
      _meta: APP_ONLY_META,
    },
    async ({ boardId, annotationId }) => {
      const board = store.deleteAnnotation(boardId, annotationId);
      return {
        content: [{ type: 'text', text: 'deleted' }],
        structuredContent: { boards: store.listBoards(), board },
      };
    },
  );

  server.registerTool(
    'app_canvas_compile_feedback',
    {
      title: 'Compile Feedback Prompt (App Only)',
      description: 'Compile open visual pins into a structured Markdown prompt ready for app.sendMessage.',
      inputSchema: { boardId: z.string() },
      _meta: APP_ONLY_META,
    },
    async ({ boardId }) => {
      const board = store.getBoard(boardId);
      const prompt = board ? compileFeedbackPrompt(board) : '';
      return {
        content: [{ type: 'text', text: prompt }],
        structuredContent: { prompt },
      };
    },
  );

  return {
    moduleId: 'canvas',
    modelTools,
  };
}
