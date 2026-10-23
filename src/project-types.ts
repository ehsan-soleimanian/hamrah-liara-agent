import type { CloudPlan, DatabaseType } from "./provision-types";
export interface InfrastructurePackage {
  id: string;
  title: string;
  reason: string;
  app: CloudPlan;
  databases: {
    type: DatabaseType;
    plan: CloudPlan;
    version: string;
    reason: string;
  }[];
  monthly: number;
  hourlyEstimate: number;
  evidence: string[];
}
export interface ProjectAdvice {
  status: "pending" | "analyzing" | "ready" | "failed";
  provider: "cursor";
  projectHash: string;
  stage?: "connecting" | "source" | "catalog" | "validating";
  at: string;
  account?: string;
  error?: { code: string; message: string };
  summary?: string;
  assumptions?: string[];
  recommendedId?: string;
  packages?: InfrastructurePackage[];
  agentId?: string;
  runId?: string;
  model?: string;
  catalogAt?: string;
  catalogMode?: "demo" | "live";
}
export interface ProjectReport {
  traffic?: "low" | "high";
  advice?: ProjectAdvice;
  checks?: { healthPath: string; businessPath: string };
  id: string;
  name: string;
  source: "zip" | "github";
  repository?: string;
  revision?: string;
  createdAt: string;
  hash: string;
  fileCount: number;
  root: string;
  candidates: string[];
  stack: string;
  platform: string;
  port: number;
  build: string;
  start: string;
  runtime: string;
  evidence: { file: string; finding: string }[];
  services: { name: string; reason: string; required: boolean }[];
  envNames: string[];
  warnings: string[];
  blockers: string[];
  resources: string;
  agentReview?: string;
}
