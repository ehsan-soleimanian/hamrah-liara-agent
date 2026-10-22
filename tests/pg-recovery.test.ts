import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
const modulePath = pathToFileURL(path.resolve("demo/site/recovery.mjs")).href;
const { recovery, hashOrders } = await import(modulePath);
const one = {
  id: "12345678-1234-1234-1234-123456789012",
  product: "spring",
  at: "2026-10-22T08:00:00.000Z",
};
// A transaction-aware provider fixture checks the SQL contract. Actual PostgreSQL cloud
// execution is a separate live integration test, not claimed by this fixture.
function fixture() {
  let orders = [one],
    temp: typeof orders = [],
    saved = structuredClone(orders),
    released = 0;
  const calls: string[] = [];
  const client = {
    async query(sql: string, args?: string[]) {
      calls.push(sql);
      if (sql === "BEGIN") saved = structuredClone(orders);
      if (sql === "ROLLBACK") orders = structuredClone(saved);
      if (sql === "DELETE FROM demo_orders") orders = [];
      if (sql.startsWith("INSERT INTO")) {
        const row = { id: args![0], product: args![1], at: args![2] };
        if (sql.includes("hamrah_restore_test")) temp.push(row);
        else orders.push(row);
      }
      if (sql.startsWith("SELECT"))
        return {
          rows: (sql.includes("hamrah_restore_test") ? temp : orders).map(
            (o) => ({
              id: o.id,
              product: o.product,
              created_at: new Date(o.at),
            }),
          ),
        };
      return { rows: [] };
    },
    release() {
      released++;
    },
  };
  return {
    pool: { connect: async () => client },
    calls,
    get orders() {
      return orders;
    },
    get released() {
      return released;
    },
  };
}
test("owned PostgreSQL backup and isolated dry-run use read-back verification without deleting orders", async () => {
  const s = fixture();
  const snapshot = await recovery(s.pool, "backup");
  assert.deepEqual(snapshot.orders, [one]);
  const preview = await recovery(s.pool, "restore-preview", snapshot);
  assert.equal(preview.checksum, hashOrders([one]));
  assert.equal(preview.count, 1);
  assert.deepEqual(s.orders, [one]);
  assert.ok(s.calls.includes("ROLLBACK"));
  assert.ok(!s.calls.includes("DELETE FROM demo_orders"));
  assert.equal(s.released, 2);
});
test("PostgreSQL restore locks and compares current data before replacing, then verifies before commit", async () => {
  const s = fixture();
  const replacement = { ...one, product: "new spring" };
  await recovery(s.pool, "restore", {
    orders: [replacement],
    at: one.at,
    expectedCurrentHash: hashOrders([one]),
  });
  assert.deepEqual(s.orders, [replacement]);
  const lock = s.calls.indexOf("LOCK TABLE demo_orders IN EXCLUSIVE MODE"),
    del = s.calls.indexOf("DELETE FROM demo_orders");
  assert.ok(lock >= 0 && del > lock);
  assert.equal(s.calls.at(-1), "COMMIT");
  assert.equal(s.released, 1);
});
test("stale PostgreSQL approval and malformed snapshot roll back without deleting data", async () => {
  const s = fixture();
  await assert.rejects(
    () =>
      recovery(s.pool, "restore", {
        orders: [],
        at: one.at,
        expectedCurrentHash: "old",
      }),
    { message: "orders_changed", status: 409 },
  );
  assert.deepEqual(s.orders, [one]);
  assert.ok(!s.calls.includes("DELETE FROM demo_orders"));
  assert.equal(s.calls.at(-1), "ROLLBACK");
  await assert.rejects(
    () =>
      recovery(s.pool, "restore-preview", { orders: [one, one], at: one.at }),
    /invalid_order/,
  );
  assert.equal(s.released, 2);
  assert.deepEqual(s.orders, [one]);
});
