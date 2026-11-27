import {
  createHostConversation,
  isConversationServiceConfigured,
  listHostConversationsReadOnly,
  normalizeConversationRecord,
  validateLoopbackLsAddress,
  type ConversationServiceOptions,
} from '../../core/conversation-service.js';
import type { AntigravityConversation } from './types.js';

export interface ConversationServiceConfig {
  lsAddress?: string;
  csrfToken?: string;
  projectId?: string;
  demoMode?: boolean;
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

  private get serviceOptions(): ConversationServiceOptions {
    return {
      lsAddress: this.lsAddress,
      csrfToken: this.csrfToken,
      projectId: this.opts.projectId || process.env.ANTIGRAVITY_PROJECT_ID,
    };
  }

  private get isLive(): boolean {
    if (this.opts.demoMode) return false;
    const addrCheck = validateLoopbackLsAddress(this.lsAddress);
    if (!addrCheck.valid) return false;
    return isConversationServiceConfigured(this.serviceOptions).available;
  }

  async listConversations(pageSize = 20): Promise<{ conversations: AntigravityConversation[]; live: boolean }> {
    if (!this.isLive) {
      return { conversations: this.demoStore.slice(0, pageSize), live: false };
    }
    const res = await listHostConversationsReadOnly(this.serviceOptions, pageSize);
    if (res.ok && res.live) {
      return {
        conversations: res.conversations,
        live: true,
      };
    }
    return { conversations: this.demoStore.slice(0, pageSize), live: false };
  }

  async createConversation(input: {
    title?: string;
    prompt: string;
    model?: 'flash_lite' | 'flash' | 'pro';
    tags?: string[];
  }): Promise<{ conversation: AntigravityConversation; live: boolean }> {
    if (!this.isLive) {
      const created: AntigravityConversation = normalizeConversationRecord({
        id: `conv-remote-${Date.now().toString(36)}`,
        annotations: {
          title: input.title || input.prompt.slice(0, 64),
          tags: input.tags ?? ['agy-remote'],
          pinned: false,
          starred: false,
          archived: false,
        },
        state: {
          summary: input.prompt.slice(0, 120),
          runState: 'RUN_STATE_RUNNING',
          updateTime: new Date().toISOString(),
        },
      });
      this.demoStore.unshift(created);
      return { conversation: created, live: false };
    }

    const res = await createHostConversation(this.serviceOptions, {
      title: input.title,
      prompt: input.prompt,
      model: input.model ?? 'flash',
      tags: input.tags ?? ['agy-remote'],
    });
    if (!res.ok || !res.conversation) {
      throw new Error(res.error || 'ConversationService/CreateConversation failed');
    }
    return {
      conversation: res.conversation,
      live: true,
    };
  }
}
