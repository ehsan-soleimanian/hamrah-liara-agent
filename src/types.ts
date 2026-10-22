export type IncidentStatus =
  | "DETECTED"
  | "INVESTIGATING"
  | "PLAN_READY"
  | "AWAITING_APPROVAL"
  | "EXECUTING"
  | "VERIFYING"
  | "RESOLVED"
  | "ESCALATED"
  | "REJECTED";
export type ActionKind =
  | "restart_app"
  | "deploy_release"
  | "restore_backup"
  | "create_backup"
  | "enable_redis"
  | "enable_email";
export interface Evidence {
  label: string;
  value: string;
  source: string;
  at: string;
}
export interface TimelineStep {
  status: IncidentStatus;
  at: string;
  note: string;
}
export interface Incident {
  id: string;
  appId: string;
  title: string;
  summary: string;
  status: IncidentStatus;
  createdAt: string;
  updatedAt: string;
  evidence: Evidence[];
  timeline: TimelineStep[];
  diagnosis?: string;
  confidence?: string;
  actionId?: string;
  verification?: string;
  source: "demo" | "live";
}
export interface Action {
  id: string;
  kind: ActionKind;
  target: string;
  title: string;
  description: string;
  impact: string;
  cost: string;
  status:
    | "pending"
    | "executing"
    | "completed"
    | "failed"
    | "rejected"
    | "expired"
    | "cancelled";
  createdAt: string;
  expiresAt: string;
  incidentId?: string;
  params: Record<string, string>;
  fingerprint: string;
  error?: string;
  steps?: {
    label: string;
    at: string;
    status: "running" | "done" | "failed";
  }[];
}
export interface Service {
  id: string;
  name: string;
  platform: string;
  type: "app" | "database" | "storage" | "redis" | "email";
  status: "healthy" | "warning" | "down" | "unknown";
  detail: string;
  url?: string;
  cpu?: number;
  memory?: number;
  plan: string;
}
export interface Probe {
  scope?: string;
  id: string;
  at: string;
  healthy: boolean;
  healthOk: boolean;
  businessOk: boolean;
  latency: number;
  statusCode: number;
  error?: string;
}
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  at: string;
  provider: "cursor" | "demo" | "system";
}
export interface AuditEvent {
  id: string;
  at: string;
  type: string;
  title: string;
  detail: string;
  actor: string;
  prevHash: string;
  hash: string;
}
export interface Backup {
  bytes?: number;
  id: string;
  name: string;
  at: string;
  size: string;
  status: string;
  source: "demo" | "live";
  checksum?: string;
  orderCount?: number;
  verifiedAt?: string;
  scope?: string;
  purpose?: string;
}
export interface RestorePreview {
  backupId: string;
  backupCount: number;
  currentCount: number;
  removedCount: number;
  changedCount: number;
  currentHash: string;
  checksum: string;
  at: string;
  expiresAt: string;
}
export interface CareState {
  websiteUrl?: string;
  health: "healthy" | "unhealthy" | "unknown" | "stale" | "paused";
  lastCheck?: string;
  websiteOk?: boolean;
  ordersOk?: boolean;
  policy: { enabled: boolean; everyHours: number; approvedAt?: string };
  nextBackupAt?: string;
  backupError?: string;
  lastBackup?: Backup;
  restoreAvailable: boolean;
}
export interface Release {
  id: string;
  version: string;
  title: string;
  at: string;
  status: string;
  source: "demo" | "live";
}
export interface Settings {
  monitoring: boolean;
  notify: boolean;
  businessName: string;
}
export interface Snapshot {
  care?: CareState;
  mode: "demo" | "live";
  managedAppId: string;
  agentProvider: "cursor" | "demo" | "unconfigured";
  services: Service[];
  incidents: Incident[];
  actions: Action[];
  probes: Probe[];
  messages: Message[];
  audit: AuditEvent[];
  backups: Backup[];
  releases: Release[];
  settings: Settings;
  connections: {
    liara: boolean;
    cursor: boolean;
    writable: boolean;
    teamId?: string;
  };
  monitor: {
    running: boolean;
    lastCheck?: string;
    intervalMs: number;
    failures: number;
  };
  capabilities: {
    key: string;
    label: string;
    available: boolean;
    reason?: string;
  }[];
  notices: string[];
  provisionJobs?: import("./provision-types").ProvisionJob[];
}
