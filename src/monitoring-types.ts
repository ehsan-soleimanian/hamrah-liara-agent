export type CpuUnit = "unknown" | "percent" | "cores" | "nanocores";
export type MemoryUnit = "unknown" | "percent" | "bytes";
export interface MonitorPolicy {
  cpuPercent: number;
  memoryPercent: number;
  latencyMs: number;
  consecutive: number;
  cpuUnit: CpuUnit;
  memoryUnit: MemoryUnit;
}
export interface ResourceSample {
  id: string;
  scope: string;
  policyHash?: string;
  at: string;
  source: "demo" | "live";
  cpuPercent?: number;
  memoryPercent?: number;
  latencyMs?: number;
  metricsError?: string;
  healthy: boolean;
}
export interface Hypothesis {
  cause: string;
  confidence: "high" | "medium" | "low";
  evidence: string[];
  next: string;
}
export interface MonitoringState {
  policy: MonitorPolicy;
  samples: ResourceSample[];
  p95Ms?: number;
  stale: boolean;
}
