import { domainToASCII } from "node:url";
import { isIP } from "node:net";
import { Resolver } from "node:dns/promises";
import https from "node:https";
import http from "node:http";
import type { TLSSocket } from "node:tls";
import ipaddr from "ipaddr.js";

export function normalizeDomain(value: string): string {
  const raw = value.trim().replace(/\.$/, "");
  if (/[\\/:@?#*\s]/.test(raw))
    throw Error("فقط نام دامنه را وارد کنید؛ بدون https، مسیر یا ستاره.");
  const name = domainToASCII(raw).toLowerCase();
  if (
    !name ||
    name.length > 253 ||
    isIP(name) ||
    !name.includes(".") ||
    !name
      .split(".")
      .every(
        (x) => x.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(x),
      ) ||
    /(?:^|\.)(localhost|local|internal|test|invalid|example)$/.test(name)
  )
    throw Error("نام دامنهٔ عمومی معتبر نیست.");
  return name;
}
export function publicAddress(address: string) {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}
export async function domainProbe(name: string) {
  name = normalizeDomain(name);
  const resolver = new Resolver({ timeout: 2500, tries: 1 });
  const addresses = (
    await Promise.allSettled([resolver.resolve4(name), resolver.resolve6(name)])
  ).flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (!addresses.length || addresses.some((x) => !publicAddress(x)))
    throw Error("دامنه هنوز به IP عمومی قابل بررسی متصل نیست.");
  // Pin the validated address for the entire request; DNS rebinding and redirects cannot reach LAN.
  const address = addresses[0];
  const lookup = (_host: string, options: unknown, cb: Function) => {
    const family = isIP(address);
    if (
      typeof options === "object" &&
      options !== null &&
      "all" in options &&
      options.all
    )
      cb(null, [{ address, family }]);
    else cb(null, address, family);
  };
  const secure = await new Promise<{ status: number; expiry?: string }>(
    (resolve, reject) => {
      const req = https.get(
        {
          hostname: name,
          servername: name,
          path: "/",
          lookup: lookup as never,
          rejectUnauthorized: true,
          agent: false,
          timeout: 8000,
          headers: { "User-Agent": "Hamrah-Domain-Check/1.0" },
        },
        (response) => {
          const cert = (response.socket as TLSSocket).getPeerCertificate();
          const expiry = cert.valid_to
            ? new Date(cert.valid_to).toISOString()
            : undefined;
          resolve({ status: response.statusCode || 0, expiry });
          response.destroy();
        },
      );
      req.on("timeout", () => req.destroy(Error("بررسی HTTPS زمان‌بر شد.")));
      req.on("error", () =>
        reject(Error("گواهی معتبر یا دسترسی HTTPS هنوز تأیید نشد.")),
      );
    },
  );
  const redirect = await new Promise<boolean>((resolve) => {
    const req = http.get(
      {
        hostname: name,
        path: "/",
        lookup: lookup as never,
        agent: false,
        timeout: 5000,
      },
      (response) => {
        let valid = false;
        try {
          const to = new URL(response.headers.location || "", "http://" + name);
          valid =
            [301, 302, 307, 308].includes(response.statusCode || 0) &&
            to.protocol === "https:" &&
            to.hostname === name &&
            !to.port;
        } catch {}
        resolve(valid);
        response.destroy();
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
  });
  return {
    tls: !!secure.expiry,
    https: secure.status >= 200 && secure.status < 300,
    redirect,
    certificateExpiresAt: secure.expiry,
  };
}
