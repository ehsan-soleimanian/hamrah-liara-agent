import { z } from "zod";
import { digest } from "./security.ts";
export const orderSnapshot = z
  .object({
    orders: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            product: z.string().max(200),
            at: z.string().datetime(),
          })
          .strict(),
      )
      .max(10000),
    at: z.string().datetime(),
  })
  .strict();
export type OrderSnapshot = z.infer<typeof orderSnapshot>;
export const ordersHash = (orders: OrderSnapshot["orders"]) =>
  digest([...orders].sort((a, b) => a.id.localeCompare(b.id)));
