import type { AntigravityConversation } from './types.js';

export interface ConversationServiceConfig {
  lsAddress?: string;
  csrfToken?: string;
  projectId?: string;
  demoMode?: boolean;
}

interface RawConversation {
  id?: string;
  annotations?: {
    title?: string;
    tags?: string[];
    pinned?: boolean;
    starred?: boolean;
    archived?: boolean;
  };
  state?: {
    summary?: string;
    runState?: string;
    updateTime?: string;
  };
}

function normalizeConversation(raw: RawConversation): AntigravityConversation {
  const id = raw.id ?? 'unknown';
  const summary = raw.state?.summary ?? '';
  const title = raw.annotations?.title || summary || `Conversation ${id.slice(0, 8)}`;
  return {
    id,
    title,
    summary,
    runState: raw.state?.runState ?? 'RUN_STATE_IDLE',
    updateTime: raw.state?.updateTime ?? new Date().toISOString(),
    tags: raw.annotations?.tags ?? [],
    pinned: Boolean(raw.annotations?.pinned),
    starred: Boolean(raw.annotations?.starred),
    archived: Boolean(raw.annotations?.archived),
  };
}

export class ConversationClient {
  private demoStore: AntigravityConversation[];

  constructor(private readonly opts: ConversationServiceConfig = {}) {
    this.demoStore = [
      {
        id: 'conv-demo-001',
        title: 'Migrate billing webhooks to idempotent queue',
        summary: 'Running integration test suite after adding Stripe idempotency keys',
        runState: 'RUN_STATE_RUNNING',
        updateTime: new Date(Date.now() - 25_000).toISOString(),
        tags: ['backend', 'goal'],
        pinned: true,
        starred: true,
        archived: false,
      },
      {
        id: 'conv-demo-002',
        title: 'Nightly dependency security audit',
        summary: 'Completed npm audit triage; 2 low-severity advisories documented',
        runState: 'RUN_STATE_IDLE',
        updateTime: new Date(Date.now() - 18 * 60_000).toISOString(),
        tags: ['automation'],
        pinned: false,
        starred: false,
        archived: false,
      },
      {
        id: 'conv-demo-003',
        title: 'Refactor iOS push notification payload',
        summary: 'Updated APNs collapse-id header and verified sandbox delivery',
        runState: 'RUN_STATE_IDLE',
        updateTime: new Date(Date.now() - 2 * 3600_000).toISOString(),
        tags: ['mobile'],
        pinned: false,
        starred: true,
        archived: false,
      },
    ];
  }

  private get lsAddress(): string | undefined {
    return this.opts.lsAddress || process.env.ANTIGRAVITY_LS_ADDRESS;
  }

  private get csrfToken(): string | undefined {
    return this.opts.csrfToken || process.env.ANTIGRAVITY_CSRF_TOKEN;
  }

  private get isLive(): boolean {
    return !this.opts.demoMode && Boolean(this.lsAddress && this.csrfToken);
  }

  private async rpc<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`http://${this.lsAddress}/product.v1.ConversationService/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'x-antigravity-csrf-token': this.csrfToken ?? '',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      throw new Error(`ConversationService/${method} failed: HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }

  async listConversations(pageSize = 20): Promise<{ conversations: AntigravityConversation[]; live: boolean }> {
    if (!this.isLive) {
      return { conversations: this.demoStore.slice(0, pageSize), live: false };
    }
    try {
      const data = await this.rpc<{ conversations?: RawConversation[] }>('ListConversations', {
        pageSize,
        includeArchived: false,
      });
      return {
        conversations: (data.conversations ?? []).map(normalizeConversation),
        live: true,
      };
    } catch {
      return { conversations: this.demoStore.slice(0, pageSize), live: false };
    }
  }

  async createConversation(input: {
    title?: string;
    prompt: string;
    model?: 'flash_lite' | 'flash' | 'pro';
    tags?: string[];
  }): Promise<{ conversation: AntigravityConversation; live: boolean }> {
    if (!this.isLive) {
      const created: AntigravityConversation = {
        id: `conv-remote-${Date.now().toString(36)}`,
        title: input.title || input.prompt.slice(0, 64),
        summary: input.prompt.slice(0, 120),
        runState: 'RUN_STATE_RUNNING',
        updateTime: new Date().toISOString(),
        tags: input.tags ?? ['agy-remote'],
        pinned: false,
        starred: false,
        archived: false,
      };
      this.demoStore.unshift(created);
      return { conversation: created, live: false };
    }

    const payload: Record<string, unknown> = {
      title: input.title,
      model: input.model ?? 'flash',
      tags: input.tags ?? ['agy-remote'],
      prompt: [{ text: input.prompt }],
    };
    const projectId = this.opts.projectId || process.env.ANTIGRAVITY_PROJECT_ID;
    if (projectId) payload.projectId = projectId;

    const data = await this.rpc<{ conversation: RawConversation }>('CreateConversation', payload);
    return {
      conversation: normalizeConversation(data.conversation ?? {}),
      live: true,
    };
  }
}
