// The launcher supplies local demo startup; API-only deployments manage it externally.
export const modeRuntime: {
  prepare: (mode: "demo" | "live") => Promise<void>;
} = { prepare: async () => {} };
