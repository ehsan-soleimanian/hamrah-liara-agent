export type DatabaseType = "postgres" | "mysql" | "mongodb" | "redis";
export interface CloudPlan {
  id: string;
  planId: string;
  bundleId: string;
  label: string;
  cpu: number;
  ram: number;
  disk: number;
  hourly: number;
  bundleMonthly: number;
  monthly: number;
  supports: string[];
}
export interface CloudCatalog {
  mode: "demo" | "live";
  fetchedAt: string;
  source: string;
  currency: "تومان";
  appPlans: CloudPlan[];
  databasePlans: CloudPlan[];
  versions: Record<string, string[]>;
  networks: { id: string; name: string }[];
  connected: boolean;
}
export interface DatabaseSelection {
  type: DatabaseType;
  name: string;
  plan: string;
  version: string;
  bindings: Record<string, string>;
}
export interface ProvisionInput {
  projectId: string;
  appName: string;
  appPlan: string;
  networkId: string;
  databases: DatabaseSelection[];
  env: Record<string, string>;
  healthPath: string;
  businessPath: string;
}
export interface ProvisionJob {
  id: string;
  projectId: string;
  appName: string;
  sourceHash: string;
  mode: "demo" | "live";
  status:
    | "pending"
    | "running"
    | "completed"
    | "needs_verification"
    | "failed"
    | "rejected"
    | "expired";
  fingerprint: string;
  createdAt: string;
  expiresAt: string;
  monthly: number;
  currency: string;
  items: { label: string; monthly: number; plan: string }[];
  envNames: string[];
  steps: {
    key: string;
    label: string;
    status: "waiting" | "running" | "done" | "failed";
    detail?: string;
  }[];
  resources: { kind: string; id: string; name: string }[];
  url?: string;
  releaseId?: string;
  error?: string;
  errorCode?:
    | "payment_required"
    | "provider_error"
    | "verification_failed"
    | "source_rejected";
  continuationOf?: string;
  retiredAt?: string;
  nextStep?: string;
  verification?: string;
}
