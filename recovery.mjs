import { createHash } from "node:crypto";
export function hashOrders(orders) {
  return createHash("sha256")
    .update(
      JSON.stringify([...orders].sort((a, b) => a.id.localeCompare(b.id))),
    )
    .digest("hex");
}
function parse(payload) {
  if (
    !Array.isArray(payload.orders) ||
    payload.orders.length > 10000 ||
    !Number.isFinite(Date.parse(payload.at))
  )
    throw new Error("invalid_snapshot");
  const ids = new Set();
  const orders = payload.orders.map((o) => {
    if (
      !/^[a-f0-9-]{36}$/i.test(o.id) ||
      typeof o.product !== "string" ||
      o.product.length > 200 ||
      !Number.isFinite(Date.parse(o.at)) ||
      ids.has(o.id)
    )
      throw new Error("invalid_order");
    ids.add(o.id);
    return { id: o.id, product: o.product, at: new Date(o.at).toISOString() };
  });
  return orders;
}
async function rows(client) {
  const result = await client.query(
    "SELECT id, product, created_at FROM demo_orders ORDER BY id",
  );
  return result.rows.map((o) => ({
    id: o.id,
    product: o.product,
    at: new Date(o.created_at).toISOString(),
  }));
}
export async function recovery(pool, operation, payload = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (operation === "backup") {
      const orders = await rows(client);
      await client.query("COMMIT");
      return { orders, at: new Date().toISOString() };
    }
    const orders = parse(payload);
    if (operation === "restore-preview") {
      await client.query(
        "CREATE TEMP TABLE hamrah_restore_test (LIKE demo_orders INCLUDING ALL) ON COMMIT DROP",
      );
      for (const o of orders)
        await client.query(
          "INSERT INTO hamrah_restore_test(id,product,created_at) VALUES($1,$2,$3)",
          [o.id, o.product, o.at],
        );
      const read = await client.query(
        "SELECT id,product,created_at FROM hamrah_restore_test ORDER BY id",
      );
      const verified = read.rows.map((o) => ({
        id: o.id,
        product: o.product,
        at: new Date(o.created_at).toISOString(),
      }));
      if (hashOrders(verified) !== hashOrders(orders))
        throw new Error("snapshot_verification_failed");
      await client.query("ROLLBACK");
      return {
        ok: true,
        count: verified.length,
        checksum: hashOrders(verified),
      };
    }
    if (
      operation !== "restore" ||
      typeof payload.expectedCurrentHash !== "string"
    )
      throw new Error("invalid_operation");
    // Lock across compare and replacement: concurrent checkout writes cannot slip past approval.
    await client.query("LOCK TABLE demo_orders IN EXCLUSIVE MODE");
    if (hashOrders(await rows(client)) !== payload.expectedCurrentHash) {
      const error = new Error("orders_changed");
      error.status = 409;
      throw error;
    }
    await client.query("DELETE FROM demo_orders");
    for (const o of orders)
      await client.query(
        "INSERT INTO demo_orders(id,product,created_at) VALUES($1,$2,$3)",
        [o.id, o.product, o.at],
      );
    if (hashOrders(await rows(client)) !== hashOrders(orders))
      throw new Error("restore_verification_failed");
    await client.query("COMMIT");
    return { ok: true, count: orders.length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
