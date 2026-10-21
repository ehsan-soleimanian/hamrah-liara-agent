import type { Incident, IncidentStatus } from "../src/types.ts";
const allowed: Record<IncidentStatus, IncidentStatus[]> = {
  DETECTED: ["INVESTIGATING", "ESCALATED"],
  INVESTIGATING: ["PLAN_READY", "ESCALATED"],
  PLAN_READY: ["AWAITING_APPROVAL", "ESCALATED"],
  AWAITING_APPROVAL: ["EXECUTING", "VERIFYING", "REJECTED", "ESCALATED"],
  EXECUTING: ["VERIFYING", "ESCALATED"],
  VERIFYING: ["RESOLVED", "ESCALATED"],
  RESOLVED: [],
  ESCALATED: ["VERIFYING"],
  REJECTED: ["VERIFYING"],
};
export function transition(
  incident: Incident,
  next: IncidentStatus,
  note: string,
): Incident {
  if (!allowed[incident.status].includes(next))
    throw new Error(`Invalid transition ${incident.status} → ${next}`);
  const at = new Date().toISOString();
  return {
    ...incident,
    status: next,
    updatedAt: at,
    timeline: [...incident.timeline, { status: next, at, note }],
  };
}
