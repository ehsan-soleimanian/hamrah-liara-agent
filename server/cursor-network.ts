import https from "node:https";
import { Socket } from "node:net";
import { SocksProxyAgent } from "socks-proxy-agent";
import { configureCursorSdk } from "@cursor/sdk";

const directAgent = https.globalAgent;
let installed: SocksProxyAgent | undefined;
let activeUrl = "";
export function isCursorHost(host: string) {
  const name = host.toLowerCase().replace(/\.$/, "");
  return name === "cursor.com" || name.endsWith(".cursor.com") || name === "cursor.sh" || name.endsWith(".cursor.sh");
}
export function validateCursorProxy(value: string) {
  if (!value) return;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("آدرس پروکسی Cursor معتبر نیست."); }
  if (!["socks5:", "socks5h:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.port || url.username || url.password || url.pathname !== "" || url.search || url.hash)
    throw new Error("پروکسی Cursor باید SOCKS5 محلی با پورت مشخص باشد، مانند socks5h://127.0.0.1:1080.");
}
export function configureCursorNetwork(proxyUrl: string) {
  validateCursorProxy(proxyUrl);
  if (activeUrl === proxyUrl) return;
  installed?.destroy();
  installed = undefined;
  activeUrl = proxyUrl;
  if (!proxyUrl) {
    https.globalAgent = directAgent;
    configureCursorSdk({ local: { useHttp1ForAgent: null } });
    return;
  }
  class CursorRoutingAgent extends SocksProxyAgent {
    async connect(req: Parameters<SocksProxyAgent["connect"]>[0], opts: Parameters<SocksProxyAgent["connect"]>[1]) {
      if (isCursorHost(String(opts.host))) return super.connect(req, opts);
      // Keep every non-Cursor HTTPS request on the original TLS path.
      const socket = directAgent.createConnection(opts);
      if (!(socket instanceof Socket)) throw new Error("Direct HTTPS socket was not created");
      return socket;
    }
  }
  installed = new CursorRoutingAgent(proxyUrl, { timeout: 20000, keepAlive: true });
  https.globalAgent = installed as unknown as https.Agent;
  // Supported public SDK setting: SSE over HTTPS/1.1 uses the scoped Node agent.
  configureCursorSdk({ local: { useHttp1ForAgent: true } });
}

export const cursorProxyFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.protocol !== "https:" || !isCursorHost(url.hostname)) throw new Error("Unexpected Cursor origin");
  const body = request.body ? Buffer.from(await request.arrayBuffer()) : undefined;
  return new Promise<Response>((resolve, reject) => {
    const outgoing = https.request(url, {
      method: request.method, headers: Object.fromEntries(request.headers), signal: request.signal,
    }, response => {
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 1024 * 1024) outgoing.destroy(new Error("Cursor response too large"));
        else chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(response.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
        const status = response.statusCode || 502;
        resolve(new Response([204,205,304].includes(status) ? null : Buffer.concat(chunks), { status, headers }));
      });
    });
    outgoing.on("error", reject);
    outgoing.end(body);
  });
};
