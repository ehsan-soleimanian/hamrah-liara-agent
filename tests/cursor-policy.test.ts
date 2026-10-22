import { test } from "node:test";
import assert from "node:assert/strict";
import { scopedTools } from "../server/cursor.ts";
import type { SDKCustomTool } from "@cursor/sdk";
test("project review cannot invoke mutations or approval requests even if repository content asks", () => {
  const execute = async () => ({
    content: [{ type: "text" as const, text: "ok" }],
  });
  const tools: Record<string, SDKCustomTool> = {
    get_project_analysis: {
      description: "facts",
      annotations: { readOnlyHint: true },
      execute,
    },
    request_action: { description: "creates an approval", execute },
    unsafe_tool: {
      description: "write",
      annotations: { readOnlyHint: false },
      execute,
    },
  };
  assert.deepEqual(Object.keys(scopedTools(tools, true)), [
    "get_project_analysis",
  ]);
  assert.equal(scopedTools(tools, false), tools);
  assert.ok(Object.hasOwn(tools, "request_action"));
});
