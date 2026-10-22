export interface DnsRecord {
  type: "CNAME" | "TXT" | "ALIAS";
  name: string;
  content: string;
}
export interface DnsChange {
  record: DnsRecord;
  action: "create" | "keep" | "replace";
  before: {
    id: string;
    type: string;
    name: string;
    content: string;
    proxied?: boolean;
  }[];
}
export interface DomainJob {
  id: string;
  jobId: string;
  appName: string;
  name: string;
  mode: "demo" | "live";
  provider: "liara" | "manual" | "cloudflare";
  status:
    | "approval"
    | "attaching"
    | "dns_approval"
    | "applying_dns"
    | "waiting_dns"
    | "waiting_ns"
    | "waiting_ssl"
    | "verifying"
    | "active"
    | "attention"
    | "cancelled";
  createdAt: string;
  updatedAt: string;
  scope: string;
  expiresAt: string;
  fingerprint: string;
  domainId?: string;
  records: DnsRecord[];
  changes: DnsChange[];
  zone?: { id: string; name: string; nameservers: string[]; status: string };
  approvedUntil?: string;
  sslRequestedAt?: string;
  dnsAppliedAt?: string;
  registrarConfirmedAt?: string;
  lastCheckedAt?: string;
  nextCheckAt?: string;
  checks: {
    dns: boolean;
    tls: boolean;
    https: boolean;
    redirect: boolean;
    certificateExpiresAt?: string;
  };
  message: string;
  events: { at: string; text: string }[];
}
