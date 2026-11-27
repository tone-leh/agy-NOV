export type ChannelKind =
  | 'telegram'
  | 'feishu'
  | 'dingtalk'
  | 'wecom'
  | 'slack'
  | 'discord'
  | 'webhook';

export interface ChannelConfig {
  id: string;
  kind: ChannelKind;
  label: string;
  enabled: boolean;
  webhookUrl?: string;
  secret?: string;
  botToken?: string;
  chatId?: string;
}

export interface SafeChannelView {
  id: string;
  kind: ChannelKind;
  label: string;
  enabled: boolean;
  configured: boolean;
}

export interface RemoteConfig {
  gatewayEnabled: boolean;
  host: string;
  port: number;
  pairingToken: string;
  pairingPin: string;
  pairingPinExpiresAt?: string;
  publicBaseUrl?: string;
  remoteApprovalEnabled: boolean;
  approvalTimeoutSec: number;
  notifyOnStop: boolean;
  riskPatterns: string[];
  channels: ChannelConfig[];
}

export interface RuntimeInfo {
  port: number;
  host: string;
  url: string;
  pid: number;
  startedAt: string;
}

export interface ApprovalRequest {
  id: string;
  conversationId: string;
  toolName: string;
  summary: string;
  matchedRule: string;
  createdAt: string;
  expiresAt: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  decidedBy?: string;
  decidedAt?: string;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  kind: 'approval_requested' | 'approval_decided' | 'stop_alert' | 'task_dispatched' | 'channel_ping';
  title: string;
  detail: string;
  actor: string;
}

export interface AntigravityConversation {
  id: string;
  title: string;
  summary: string;
  runState: 'RUN_STATE_IDLE' | 'RUN_STATE_RUNNING' | 'RUN_STATE_CANCELLING' | string;
  updateTime: string;
  tags: string[];
  pinned: boolean;
  starred: boolean;
  archived: boolean;
}

export interface PublicGatewayStatus {
  running: boolean;
  url: string;
  lanUrl: string;
  mobilePath: string;
  mobileUrl: string;
  connectedClients: number;
  pendingApprovals: number;
  remoteApprovalEnabled: boolean;
  notifyOnStop: boolean;
}

export interface GatewayStatus extends PublicGatewayStatus {
  pairingUrl: string;
  pairingPin: string;
  pairingPinExpiresAt: string;
}
