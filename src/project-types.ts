export interface ProjectReport {
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
