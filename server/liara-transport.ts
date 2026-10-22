import https from "node:https";
import { lookup, Resolver } from "node:dns/promises";

// Liara's authoritative DNS can be unreachable from international resolvers.
// This fallback sends only the public hostname to the documented Iranian resolver.
// TLS still validates api.liara.ir; no hosts file, OS DNS or certificate bypass.
let cached: { address: string; until: number } | undefined;
async function address() {
  if (cached && cached.until > Date.now()) return cached.address;
  try {
    return (await lookup("api.liara.ir", { family: 4 })).address;
  } catch (error) {
    if (
      !["EAI_AGAIN", "ENOTFOUND"].includes(
        (error as NodeJS.ErrnoException).code || "",
      )
    )
      throw error;
    const resolver = new Resolver({ timeout: 3000, tries: 1 });
    resolver.setServers(["178.22.122.100", "185.51.200.2"]);
    const records = await resolver.resolve4("api.liara.ir", { ttl: true });
    const record = records[0];
    if (!record) throw error;
    cached = {
      address: record.address,
      until: Date.now() + Math.max(1, Math.min(60, record.ttl)) * 1000,
    };
    return record.address;
  }
}

export const liaraFetch: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin !== "https://api.liara.ir")
    throw new Error("Unexpected Liara origin");
  try {
    return await fetch(input, init);
  } catch (error) {
    // Only an explicit lookup failure qualifies: no TCP connection or HTTP mutation
    // was sent. Timeouts, resets and uncertain write outcomes never use fallback.
    const code = (error as Error & { cause?: { code?: string } }).cause?.code;
    if (!["EAI_AGAIN", "ENOTFOUND"].includes(code || "")) throw error;
  }
  const request = new Request(input, init);
  // Resolve before sending any HTTP bytes, including for writes. No mutation is replayed.
  const resolved = await address();
  const bytes = request.body
    ? Buffer.from(await request.arrayBuffer())
    : undefined;
  const headers = Object.fromEntries(request.headers.entries());
  if (bytes) headers["content-length"] = String(bytes.length);
  return new Promise<Response>((resolve, reject) => {
    const outgoing = https.request(
      url,
      {
        method: request.method,
        headers,
        signal: request.signal,
        servername: "api.liara.ir",
        rejectUnauthorized: true,
        lookup: (_hostname, options, callback) => {
          if (typeof options === "object" && options.all)
            callback(null, [{ address: resolved, family: 4 }]);
          else callback(null, resolved, 4);
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > 5 * 1024 * 1024) {
            outgoing.destroy(new Error("Liara response too large"));
          } else chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(response.headers))
            if (value !== undefined)
              responseHeaders.set(
                key,
                Array.isArray(value) ? value.join(", ") : value,
              );
          const status = response.statusCode || 502;
          resolve(
            new Response(
              [204, 205, 304].includes(status) ? null : Buffer.concat(chunks),
              { status, headers: responseHeaders },
            ),
          );
        });
      },
    );
    outgoing.on("error", reject);
    outgoing.end(bytes);
  });
};
