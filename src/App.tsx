import {
  useState,
  useEffect,
  useRef,
  type ReactNode,
  type FormEvent,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import LiaraAccount from "./LiaraAccount";
import {
  Activity,
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpLeft,
  ArrowUpRight,
  ArrowRight,
  AudioLines,
  Bell,
  BookOpen,
  Box,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock,
  Cloud,
  Cpu,
  Database,
  Download,
  ExternalLink,
  FileText,
  Flower2,
  Gauge,
  GitBranch,
  Globe,
  HardDrive,
  HeartPulse,
  History,
  Info,
  Layers,
  LayoutDashboard,
  LifeBuoy,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Mail,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Network,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Send,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  Terminal,
  TrendingUp,
  TriangleAlert,
  Wallet,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import type {
  Action,
  ActionKind,
  AuditEvent,
  Incident,
  IncidentStatus,
  Service,
  Snapshot,
} from "./types";
import { api, cn, date, fa, time } from "./lib";
import SetupPage from "./SetupPage";
type Page =
  | "setup"
  | "overview"
  | "services"
  | "incidents"
  | "deployments"
  | "backups"
  | "growth"
  | "memory"
  | "settings"
  | "chat";
const pages: { id: Page; label: string; icon: LucideIcon }[] = [
  { id: "overview", label: "پیشخوان", icon: LayoutDashboard },
  { id: "setup", label: "راه‌اندازی آسان", icon: Rocket },
  { id: "services", label: "سرویس‌های من", icon: Layers },
  { id: "incidents", label: "سلامت و رخدادها", icon: HeartPulse },
  { id: "deployments", label: "انتشارها", icon: Rocket },
  { id: "backups", label: "نسخه‌های پشتیبان", icon: HardDrive },
  { id: "growth", label: "فرصت‌های رشد", icon: Sparkles },
  { id: "memory", label: "حافظه و فعالیت‌ها", icon: History },
];
const statusLabels: Record<IncidentStatus, string> = {
  DETECTED: "کشف اختلال",
  INVESTIGATING: "در حال بررسی",
  PLAN_READY: "راهکار آماده",
  AWAITING_APPROVAL: "منتظر تأیید شما",
  EXECUTING: "در حال اجرا",
  VERIFYING: "بررسی نتیجه",
  RESOLVED: "برطرف شد",
  ESCALATED: "نیاز به بررسی بیشتر",
  REJECTED: "اجرا نشد",
};
const serviceIcons: Record<Service["type"], LucideIcon> = {
  app: Globe,
  database: Database,
  storage: HardDrive,
  redis: Zap,
  email: Mail,
};
function Logo({ small = false }: { small?: boolean }) {
  return (
    <div className={cn("brand", small && "brand-small")}>
      <img src="/favicon.svg" alt="" />
      <div>
        <strong>
          همراه<span>•</span>
        </strong>
        {!small && <small>مدیر فنی هوشمند شما</small>}
      </div>
    </div>
  );
}
function Button({
  children,
  icon: Icon,
  onClick,
  variant = "secondary",
  disabled = false,
  className = "",
  type = "button",
}: {
  children?: ReactNode;
  icon?: LucideIcon;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={cn("button", variant, className)}
      onClick={onClick}
    >
      {Icon && <Icon size={17} aria-hidden="true" />}
      {children}
    </button>
  );
}
function Badge({
  children,
  tone = "green",
}: {
  children: ReactNode;
  tone?: "green" | "amber" | "red" | "gray";
}) {
  return (
    <span className={cn("badge", tone)}>
      <span className="status-dot" />
      {children}
    </span>
  );
}
function SectionHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
function Empty({
  icon: Icon = CircleCheck,
  title,
  text,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={27} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content dir="rtl" className={cn("modal", wide && "modal-wide")}>
          <div className="modal-header">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>
                {description || "جزئیات و شواهد مرتبط با این بخش"}
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="بستن">
              <X size={20} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default function App() {
  const [state, setState] = useState<Snapshot | null>(null);
  const [page, setPage] = useState<Page>(
    (location.hash.slice(1) === "main-content"
      ? "overview"
      : location.hash.slice(1) || "overview") as Page,
  );
  const [online, setOnline] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState("");
  const [sidebar, setSidebar] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [incident, setIncident] = useState<Incident | null>(null);
  const [service, setService] = useState<Service | null>(null);
  const [approval, setApproval] = useState<Action | null>(null);
  const [restoreText, setRestoreText] = useState("");
  const [logs, setLogs] = useState("");
  useEffect(() => {
    const sync = () =>
      setPage(
        (location.hash.slice(1) === "main-content"
          ? "overview"
          : location.hash.slice(1) || "overview") as Page,
      );
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  useEffect(() => {
    let alive = true;
    fetch("/api/state")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((s) => {
        if (alive) setState(s);
      })
      .catch(() => {
        if (alive) setOnline(false);
      });
    const events = new EventSource("/api/events");
    events.onmessage = (e) => {
      if (alive) {
        setState(JSON.parse(e.data));
        setOnline(true);
      }
    };
    events.onerror = () => {
      if (alive) setOnline(false);
    };
    return () => {
      alive = false;
      events.close();
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  function navigate(p: Page) {
    location.hash = p;
    setSidebar(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  async function run(key: string, task: () => Promise<unknown>, message = "") {
    setBusy(key);
    setError("");
    try {
      await task();
      if (message) setToast(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function propose(
    kind: ActionKind,
    backupId?: string,
    projectId?: string,
    dependenciesReady?: boolean,
  ) {
    if (!state) return;
    if (kind === "deploy_release" && !projectId) {
      navigate("setup");
      return;
    }
    await run("propose", async () => {
      const a = await api<Action>("/actions", {
        kind,
        target: state.managedAppId,
        ...(backupId ? { backupId } : {}),
        ...(projectId ? { projectId, dependenciesReady } : {}),
      });
      setApproval(a);
      setRestoreText("");
    });
  }
  async function showService(s: Service) {
    setService(s);
    setLogs("در حال دریافت لاگ…");
    try {
      const r = await fetch("/api/logs");
      const d = await r.json();
      setLogs(JSON.stringify(d, null, 2));
    } catch {
      setLogs("دریافت لاگ ممکن نشد.");
    }
  }
  if (!state)
    return (
      <div className="loading-screen">
        <Logo />
        <div className="loading-bar" />
        <p>
          {online
            ? "همراه در حال آماده‌شدن است…"
            : "ارتباط با سرور برقرار نشد. سرویس را با npm run dev اجرا کنید."}
        </p>
        <Button onClick={() => location.reload()} icon={RefreshCw}>
          تلاش دوباره
        </Button>
      </div>
    );
  const pending = state.actions.filter(
    (a) => a.status === "pending" && Date.parse(a.expiresAt) > Date.now(),
  );
  const active = state.incidents.filter(
    (i) => !["RESOLVED", "REJECTED"].includes(i.status),
  );
  const healthy = state.probes.at(-1)?.healthy;
  const currentIncident = incident
    ? state.incidents.find((i) => i.id === incident.id) || incident
    : null;
  const currentApproval = approval
    ? state.actions.find((a) => a.id === approval.id) || approval
    : null;
  const title =
    pages.find((p) => p.id === page)?.label ||
    (
      { settings: "تنظیمات همراه", chat: "گفتگو با همراه" } as Record<
        string,
        string
      >
    )[page] ||
    "پیشخوان";
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        رفتن به محتوای اصلی
      </a>
      <Dialog.Root open={sidebar} onOpenChange={setSidebar}>
        <Dialog.Portal>
          <Dialog.Overlay className="modal-overlay" />
          <Dialog.Content dir="rtl" className="mobile-nav-dialog">
            <div className="mobile-nav-top">
              <Dialog.Title>
                <Logo small />
              </Dialog.Title>
              <Dialog.Close className="icon-button" aria-label="بستن منو">
                <X size={20} />
              </Dialog.Close>
            </div>
            <Dialog.Description className="mobile-nav-description">
              فضای کاری {state.settings.businessName}
            </Dialog.Description>
            <nav aria-label="منوی موبایل">
              {pages.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  className={cn("nav-item", page === id && "active")}
                  onClick={() => navigate(id)}
                >
                  <Icon size={20} />
                  {label}
                </button>
              ))}
            </nav>
            <button className="nav-item" onClick={() => navigate("settings")}>
              <Settings size={20} />
              تنظیمات و اتصال‌ها
            </button>
            <button
              className="button primary"
              onClick={() => {
                setSidebar(false);
                setChatOpen(true);
              }}
            >
              <MessageCircle size={18} />
              گفتگو با همراه
            </button>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <aside className="sidebar">
        <a
          className="brand-link"
          href="#overview"
          onClick={() => setSidebar(false)}
          aria-label="همراه، پیشخوان"
        >
          <Logo />
        </a>
        <button
          className="workspace-switch"
          onClick={() => navigate("settings")}
        >
          <span className="business-avatar">
            <Flower2 size={22} />
          </span>
          <span>
            <strong>{state.settings.businessName}</strong>
            <small>
              {state.connections.teamId ? "فضای کاری تیمی" : "فضای کاری شخصی"}
            </small>
          </span>
          <ChevronDown size={15} />
        </button>
        <div className="nav-caption">فضای کسب‌وکار</div>
        <nav aria-label="ناوبری اصلی">
          {pages.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => navigate(id)}
              aria-current={page === id ? "page" : undefined}
              className={cn("nav-item", page === id && "active")}
            >
              <Icon size={19} aria-hidden="true" />
              <span>{label}</span>
              {id === "incidents" && active.length > 0 && (
                <span className="nav-counter">{fa(active.length)}</span>
              )}
              {id === "growth" && <span className="new-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="agent-mini">
            <div className="agent-mini-head">
              <span className="agent-symbol">
                <AudioLines size={21} />
              </span>
              <span>
                <strong>
                  همراه {state.monitor.running ? "بیدار است" : "در استراحت است"}
                </strong>
                <small>
                  {state.monitor.running
                    ? "مراقب کسب‌وکار شما هستم"
                    : "پایش خودکار متوقف است"}
                </small>
              </span>
              <span
                className={cn("status-dot", !state.monitor.running && "muted")}
              />
            </div>
            <button onClick={() => setChatOpen(true)}>
              گفتگو با همراه
              <ArrowUpLeft size={17} />
            </button>
          </div>
          <button
            className={cn("nav-item", page === "settings" && "active")}
            onClick={() => navigate("settings")}
          >
            <Settings size={19} />
            تنظیمات و اتصال‌ها
          </button>
          <button className="nav-item" onClick={() => setHelpOpen(true)}>
            <LifeBuoy size={19} />
            راهنمای همراه
            <ArrowUpLeft className="push-end" size={15} />
          </button>
          <div className="sidebar-footer">
            <span className="tiny-cloud">
              <Cloud size={17} />
            </span>
            <span>ساخته‌شده برای لیارا</span>
            <small>v1.0</small>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-right">
            <button
              className="icon-button mobile-menu"
              aria-label="باز کردن منو"
              onClick={() => setSidebar(true)}
            >
              <Menu size={22} />
            </button>
            <span className="breadcrumb">
              فضای کاری {state.settings.businessName}
            </span>
            <ChevronLeft size={13} />
            <strong>{title}</strong>
          </div>
          <div className="topbar-left">
            <span className="topbar-date">
              {new Intl.DateTimeFormat("fa-IR", {
                weekday: "long",
                day: "numeric",
                month: "long",
                timeZone: "Asia/Tehran",
              }).format(new Date())}
            </span>
            <button
              className={cn("mode-pill", state.mode === "live" && "live")}
              onClick={() => navigate("settings")}
            >
              <span className="status-dot" />
              {state.mode === "demo" ? "محیط نمایشی" : "اتصال واقعی"}
              <ChevronDown size={12} />
            </button>
            <span className="topbar-divider" />
            <button
              className="icon-button notification-button"
              aria-label={`اعلان‌ها، ${active.length} رخداد فعال`}
              onClick={() => setNotificationOpen(true)}
            >
              <Bell size={19} />
              {active.length > 0 && <i />}
            </button>
            <button
              className="profile-avatar"
              aria-label="تنظیمات حساب"
              onClick={() => navigate("settings")}
            >
              گ
            </button>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          {!online && (
            <div className="notice-banner error">
              <Network size={18} />
              <span>
                ارتباط زنده قطع شده؛ اطلاعات نمایش‌داده‌شده ممکن است قدیمی باشد.
                تلاش برای اتصال مجدد…
              </span>
            </div>
          )}
          {error && (
            <div className="notice-banner error" role="alert">
              <TriangleAlert size={18} />
              <span>{error}</span>
              <button
                className="icon-button"
                onClick={() => setError("")}
                aria-label="بستن پیام خطا"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {state.notices.map((n, i) => (
            <div className="notice-banner" key={i}>
              <Info size={18} />
              <span>{n}</span>
            </div>
          ))}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {page === "overview"
                  ? "یک قدم جلوتر، همیشه همراه شما"
                  : state.settings.businessName + " / " + title}
              </div>
              <h1>
                {page === "overview" ? "با خیال راحت، رشد کنید" : title}
                <span className="heading-dot">.</span>
              </h1>
              <p>
                {page === "overview"
                  ? "همراه حواسش به زیرساخت هست؛ شما به ایده‌های بزرگ‌تر برسید."
                  : page === "incidents"
                    ? "از اولین نشانه تا تأیید رفع مشکل، همه‌چیز قابل پیگیری است."
                    : page === "services"
                      ? "تمام زیرساخت کسب‌وکارتان، ساده و یک‌جا."
                      : page === "backups"
                        ? "یک راه برگشت مطمئن برای اطلاعات مهم شما."
                        : page === "growth"
                          ? "پیشنهادهایی برای قدم بعدی کسب‌وکار شما."
                          : page === "deployments"
                            ? "از ایده تا انتشار؛ با یک مسیر روشن و قابل پیگیری."
                            : page === "memory"
                              ? "همراه یادش می‌ماند چه گفتیم، چه کردیم و به چه نتیجه‌ای رسیدیم."
                              : page === "settings"
                                ? "شما تعیین می‌کنید همراه به چه چیزهایی دسترسی داشته باشد."
                                : "ساده بگویید چه می‌خواهید؛ همراه مسیرش را پیدا می‌کند."}
              </p>
            </div>
            {page === "overview" ? (
              <Button
                icon={ArrowUpLeft}
                onClick={() =>
                  window.open(
                    state.mode === "demo"
                      ? "http://127.0.0.1:3002"
                      : state.services.find((s) => s.url)?.url ||
                          "https://console.liara.ir",
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
              >
                مشاهدهٔ وب‌سایت
              </Button>
            ) : page === "services" ? (
              <Button
                icon={RefreshCw}
                disabled={!!busy}
                onClick={() =>
                  run(
                    "refresh",
                    () => api("/refresh"),
                    "اطلاعات سرویس‌ها به‌روز شد.",
                  )
                }
              >
                به‌روزرسانی سرویس‌ها
              </Button>
            ) : null}
          </div>
          {page === "overview" && (
            <>
              <section
                className={cn(
                  "hero-card",
                  active.length > 0 && "hero-attention",
                )}
              >
                <img className="hero-art" src="/guardian.webp" alt="" />
                <div className="hero-shade" />
                <div className="hero-copy">
                  <Badge
                    tone={active.length ? "amber" : healthy ? "green" : "gray"}
                  >
                    {active.length
                      ? "یک موضوع نیاز به توجه شما دارد"
                      : healthy
                        ? "همه‌چیز تحت مراقبت است"
                        : "همراه در حال بررسی است"}
                  </Badge>
                  <h2>
                    {active.length ? (
                      <>
                        با هم، از پسِ
                        <br />
                        این مشکل برمی‌آییم.
                      </>
                    ) : (
                      <>
                        کسب‌وکار شما،
                        <br />
                        در دست‌های امن.
                      </>
                    )}
                  </h2>
                  <p>
                    {active.length
                      ? pending.length
                        ? "مشکل را پیدا کرده‌ام. راهکار و شواهد آماده‌اند؛ تصمیم نهایی با شماست."
                        : "این رخداد هنوز باز است. نتیجهٔ بررسی و مسیر بعدی را ببینید؛ همراه پیگیر نتیجه می‌ماند."
                      : "من وضعیت سایت را بررسی می‌کنم، مشکلات را پیدا می‌کنم و تا مطمئن نشوم حل شده‌اند، پیگیر می‌مانم."}
                  </p>
                  <div className="hero-actions">
                    <Button
                      variant="primary"
                      icon={active.length ? ShieldCheck : MessageCircle}
                      onClick={() =>
                        active.length
                          ? setIncident(active[0])
                          : setChatOpen(true)
                      }
                    >
                      {active.length
                        ? pending.length
                          ? "بررسی پیشنهاد همراه"
                          : "پیگیری رخداد"
                        : "گفتگو با همراه"}
                      <ArrowUpLeft size={16} />
                    </Button>
                    <button
                      className="text-button"
                      onClick={() => setDemoOpen(true)}
                    >
                      <Play size={14} />
                      {state.mode === "demo"
                        ? "یک اختلال را آزمایش کنید"
                        : "همراه چطور کار می‌کند؟"}
                    </button>
                  </div>
                  <div className="hero-footnote">
                    <ShieldCheck size={14} />
                    هر تغییر مهم، فقط با تأیید شما
                  </div>
                </div>
                <div className="hero-image-caption">
                  <span className="orbit-dot" />
                  <span>یک همراهِ همیشه بیدار</span>
                  <small>PROACTIVE · ACCOUNTABLE</small>
                </div>
              </section>
              <Stats state={state} pending={pending.length} />
              {pending.length > 0 && (
                <div className="approval-strip">
                  <span className="icon-tile amber">
                    <ShieldCheck size={20} />
                  </span>
                  <div>
                    <strong>یک تصمیم کوچک، برای یک خیال راحت</strong>
                    <p>
                      {pending[0].title} · {pending[0].cost}
                    </p>
                  </div>
                  <Button
                    onClick={() => {
                      setApproval(pending[0]);
                      setRestoreText("");
                    }}
                    variant="primary"
                  >
                    بررسی و تأیید
                    <ArrowLeft size={16} />
                  </Button>
                </div>
              )}
              <div className="dashboard-grid">
                <HealthChart
                  state={state}
                  onCheck={() =>
                    run("check", () => api("/check"), "بررسی تازه انجام شد.")
                  }
                  busy={busy === "check"}
                />
                <ActivityCard
                  state={state}
                  onAll={() => navigate("memory")}
                  onChat={() => setChatOpen(true)}
                />
              </div>
              <section className="services-section">
                <SectionHeading
                  title="زیرساخت شما، در یک نگاه"
                  subtitle="هر چیزی که کسب‌وکارتان را سرپا نگه می‌دارد"
                  action={
                    <button
                      className="text-button muted-text"
                      onClick={() => navigate("services")}
                    >
                      همهٔ سرویس‌ها
                      <ArrowLeft size={15} />
                    </button>
                  }
                />
                <div className="service-grid">
                  {state.services.slice(0, 3).map((s) => (
                    <ServiceCard
                      key={s.id}
                      service={s}
                      onClick={() => void showService(s)}
                    />
                  ))}
                  {state.services.length === 0 && (
                    <Empty
                      icon={Cloud}
                      title="سرویسی دریافت نشده"
                      text="اتصال لیارا را در تنظیمات بررسی کنید."
                      action={
                        <Button onClick={() => navigate("settings")}>
                          بررسی اتصال
                        </Button>
                      }
                    />
                  )}
                </div>
              </section>
              <div className="growth-teaser">
                <div className="growth-spark">
                  <Sparkles size={22} />
                </div>
                <div>
                  <strong>برای قدم بعدی‌تان، چند ایده دارم.</strong>
                  <p>از سریع‌تر شدن فروشگاه تا ارتباط بهتر با مشتری‌ها</p>
                </div>
                <button
                  className="text-button"
                  onClick={() => navigate("growth")}
                >
                  کشف فرصت‌ها
                  <ArrowLeft size={17} />
                </button>
                <span className="subtle-orbit" />
              </div>
            </>
          )}
          {page === "setup" && <SetupPage state={state} />}{" "}
          {page === "services" && (
            <>
              <div className="info-line">
                <ShieldCheck size={17} />
                همراه پیش از تغییر هر سرویس، از شما تأیید می‌گیرد.
                {state.mode === "demo" && (
                  <span>منابع CPU و RAM در این محیط نمونه‌اند.</span>
                )}
              </div>
              <div className="service-grid expanded">
                {state.services.map((s) => (
                  <ServiceCard
                    key={s.id}
                    service={s}
                    onClick={() => void showService(s)}
                  />
                ))}
              </div>
              {state.services.length === 0 && (
                <Empty
                  icon={Cloud}
                  title="هنوز سرویسی متصل نشده"
                  text="کلید لیارا را تنظیم کنید و اطلاعات را به‌روزرسانی کنید."
                  action={
                    <Button onClick={() => navigate("settings")}>
                      تنظیم اتصال
                    </Button>
                  }
                />
              )}
              <div className="panel service-bottom">
                <Cloud size={40} />
                <div>
                  <h3>زیرساخت بیشتر، پیچیدگی کمتر.</h3>
                  <p>
                    پیشنهادهای متناسب با کسب‌وکارتان را ببینید و با آگاهی تصمیم
                    بگیرید.
                  </p>
                </div>
                <Button icon={Sparkles} onClick={() => navigate("growth")}>
                  کشف سرویس‌های پیشنهادی
                </Button>
              </div>
            </>
          )}
          {page === "incidents" && (
            <>
              <div className="page-toolbar">
                <div className="inline-stats">
                  <Badge tone={active.length ? "amber" : "green"}>
                    {fa(active.length)} رخداد نیازمند توجه
                  </Badge>
                  <span>
                    {fa(
                      state.incidents.filter((i) => i.status === "RESOLVED")
                        .length,
                    )}{" "}
                    مشکل با تأیید نتیجه برطرف شده
                  </span>
                </div>
                <Button
                  icon={HeartPulse}
                  disabled={!!busy}
                  onClick={() =>
                    run("check", () => api("/check"), "بررسی سلامت انجام شد.")
                  }
                >
                  بررسی همین حالا
                </Button>
              </div>
              {state.incidents.length === 0 ? (
                <div className="panel">
                  <Empty
                    icon={ShieldCheck}
                    title="خیالتان راحت، رخداد فعالی ندارید."
                    text="اگر مشکلی پیدا کنم، شواهد و راهکارش را همین‌جا ثبت می‌کنم."
                    action={
                      state.mode === "demo" ? (
                        <Button icon={Play} onClick={() => setDemoOpen(true)}>
                          آزمایش یک اختلال
                        </Button>
                      ) : undefined
                    }
                  />
                </div>
              ) : (
                <div className="incident-list">
                  {state.incidents.map((i) => (
                    <button
                      key={i.id}
                      className="panel incident-row"
                      onClick={() => setIncident(i)}
                    >
                      <span
                        className={cn(
                          "icon-tile",
                          i.status === "RESOLVED" ? "green" : "amber",
                        )}
                      >
                        {i.status === "RESOLVED" ? (
                          <CircleCheck size={23} />
                        ) : (
                          <HeartPulse size={23} />
                        )}
                      </span>
                      <div className="incident-row-body">
                        <h3>{i.title}</h3>
                        <p>
                          {i.status === "RESOLVED"
                            ? i.timeline.at(-1)?.note
                            : i.diagnosis || i.summary}
                        </p>
                        <small>
                          {date(i.createdAt)}، {time(i.createdAt)} ·{" "}
                          {i.source === "demo" ? "فروشگاه آزمایشی" : "لیارا"}
                        </small>
                      </div>
                      <Badge
                        tone={
                          i.status === "RESOLVED"
                            ? "green"
                            : i.status === "ESCALATED"
                              ? "red"
                              : "amber"
                        }
                      >
                        {statusLabels[i.status]}
                      </Badge>
                      <ChevronLeft size={18} />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {page === "deployments" && (
            <>
              <div className="panel deploy-intro">
                <span className="icon-tile large green">
                  <Rocket size={30} />
                </span>
                <div>
                  <h2>آمادهٔ انتشار ایدهٔ بعدی؟</h2>
                  <p>
                    {state.mode === "demo"
                      ? "مسیر انتشار و تأیید را در محیط نمایشی تجربه کنید."
                      : "سورس آمادهٔ گل‌بازار روی برنامهٔ انتخاب‌شدهٔ لیارا منتشر می‌شود. این کار نسخهٔ فعلی را جایگزین می‌کند."}
                  </p>
                </div>
                <Button
                  variant="primary"
                  icon={Plus}
                  disabled={!!busy || !state.connections.writable}
                  onClick={() => void propose("deploy_release")}
                >
                  انتشار نسخهٔ نمونه
                </Button>
              </div>
              <div className="panel">
                <SectionHeading
                  title="تاریخچهٔ انتشارها"
                  subtitle={
                    state.mode === "demo"
                      ? "انتشارهای نمایشی؛ فروشگاه محلی مستقل اجرا می‌شود."
                      : "وضعیت نسخه‌ها مستقیماً از API لیارا دریافت می‌شود."
                  }
                />
                <div className="release-list">
                  {state.releases.map((r, i) => (
                    <div className="release-row" key={r.id}>
                      <span className="release-line">
                        <GitBranch size={19} />
                      </span>
                      <div>
                        <h3>
                          {r.title}
                          <code>{r.version}</code>
                        </h3>
                        <p>
                          {date(r.at)} · {time(r.at)} ·{" "}
                          {r.source === "demo" ? "نمایشی" : "Liara API"}
                        </p>
                      </div>
                      <Badge tone={r.status === "ready" ? "green" : "gray"}>
                        {r.status === "ready" ? "منتشر شده" : r.status}
                      </Badge>
                      {i === 0 && (
                        <span className="current-label">آخرین نسخه</span>
                      )}
                    </div>
                  ))}
                  {!state.releases.length && (
                    <Empty
                      icon={GitBranch}
                      title="هنوز انتشاری ندارید"
                      text="پس از اتصال برنامه، تاریخچهٔ انتشارهای لیارا اینجا نمایش داده می‌شود."
                    />
                  )}
                </div>
              </div>
            </>
          )}
          {page === "backups" && (
            <>
              <div className="backup-overview">
                <div className="panel backup-promise">
                  <div className="backup-art">
                    <HardDrive size={58} />
                    <span>
                      <ShieldCheck size={25} />
                    </span>
                  </div>
                  <div>
                    <Badge>یک راه برگشت داشته باشید</Badge>
                    <h2>
                      اطلاعاتتان ارزشمند است.
                      <br />
                      با خیال راحت نگهش دارید.
                    </h2>
                    <p>
                      {state.mode === "demo"
                        ? "پشتیبان‌های محلی از سفارش‌های واقعی فروشگاه آزمایشی تهیه می‌شوند."
                        : "پشتیبان‌ها از دیتابیس تنظیم‌شده در لیارا دریافت می‌شوند؛ بازیابی ابری در این نسخه دستی است."}
                    </p>
                    <Button
                      icon={Plus}
                      variant="primary"
                      disabled={!!busy || !state.connections.writable}
                      onClick={() => void propose("create_backup")}
                    >
                      تهیهٔ نسخهٔ پشتیبان
                    </Button>
                  </div>
                </div>
                <div className="panel backup-stat">
                  <ShieldCheck size={27} />
                  <span>{fa(state.backups.length)}</span>
                  <h3>نسخهٔ قابل مشاهده</h3>
                  <p>
                    پیش از هر بازیابی محلی،
                    <br />
                    یک نسخهٔ ایمنی می‌گیرم.
                  </p>
                </div>
              </div>
              <div className="panel">
                <SectionHeading
                  title="نسخه‌های پشتیبان"
                  subtitle="یک نسخه را بررسی کنید، سپس دربارهٔ بازیابی تصمیم بگیرید."
                />
                {state.backups.length ? (
                  <div className="data-table">
                    <table>
                      <thead>
                        <tr>
                          <th>نسخه</th>
                          <th>زمان تهیه</th>
                          <th>حجم</th>
                          <th>وضعیت</th>
                          <th>عملیات</th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.backups.map((b) => (
                          <tr key={b.id}>
                            <td>
                              <div className="table-name">
                                <Database size={18} />
                                {b.name}
                              </div>
                            </td>
                            <td>
                              {date(b.at)}، {time(b.at)}
                            </td>
                            <td className="numeric">{b.size}</td>
                            <td>
                              <Badge>آماده</Badge>
                            </td>
                            <td>
                              <Button
                                icon={History}
                                disabled={!!busy || b.source === "live"}
                                onClick={() =>
                                  void propose("restore_backup", b.id)
                                }
                              >
                                بازیابی
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    icon={HardDrive}
                    title="اولین راه برگشت را بسازید"
                    text="با تهیهٔ یک نسخهٔ پشتیبان، اطلاعات مهم فروشگاهتان را حفظ کنید."
                  />
                )}
              </div>
            </>
          )}
          {page === "growth" && (
            <>
              <div className="info-line">
                <Info size={18} />
                پیشنهادها نیاز به بررسی دارند. در این MVP خرید، پرداخت و اصلاح
                خودکار کد متصل نیست.
              </div>
              <div className="growth-grid">
                {[
                  {
                    kind: "enable_redis" as ActionKind,
                    icon: Zap,
                    label: "تجربه‌ای سریع‌تر",
                    title: "مشتری‌ها منتظر نمانند.",
                    description:
                      "اگر داده‌های تکراری زیادی دارید، کش می‌تواند بار دیتابیس و زمان پاسخ را کمتر کند. ابتدا باید الگوی واقعی درخواست‌ها بررسی شود.",
                    bullets: [
                      "دسترسی سریع‌تر به داده‌های پرتکرار",
                      "کاهش درخواست‌های تکراری دیتابیس",
                    ],
                    tag: "Redis / Cache",
                    tone: "mint",
                  },
                  {
                    kind: "enable_email" as ActionKind,
                    icon: Mail,
                    label: "ارتباط حرفه‌ای‌تر",
                    title: "هر سفارش، شروع یک ارتباط.",
                    description:
                      "با ایمیل کسب‌وکار می‌توانید تأیید سفارش و پیام‌های پیگیری بفرستید. دامنه، تنظیمات ارسال و رضایت مخاطب هم باید بررسی شوند.",
                    bullets: [
                      "ایمیل با نام دامنهٔ کسب‌وکار",
                      "اطلاع‌رسانی دربارهٔ سفارش‌ها",
                    ],
                    tag: "Business Email",
                    tone: "silver",
                  },
                ].map(
                  ({
                    kind,
                    icon: Icon,
                    label,
                    title,
                    description,
                    bullets,
                    tag,
                    tone,
                  }) => (
                    <article className="panel growth-card" key={kind}>
                      <div className={cn("growth-card-art", tone)}>
                        <div className="art-grid" />
                        <span className="glass-cube">
                          <Icon size={54} />
                        </span>
                        <span className="float-chip">
                          <ShieldCheck size={15} />
                          با تصمیم شما
                        </span>
                        <code>{tag}</code>
                      </div>
                      <div className="growth-card-copy">
                        <span className="eyebrow">{label}</span>
                        <h2>{title}</h2>
                        <p>{description}</p>
                        <ul>
                          {bullets.map((b) => (
                            <li key={b}>
                              <Check size={15} />
                              {b}
                            </li>
                          ))}
                        </ul>
                        <div className="growth-card-bottom">
                          <span>
                            نمایش مسیر فعال‌سازی<small>بدون پرداخت واقعی</small>
                          </span>
                          <Button
                            icon={ArrowUpLeft}
                            disabled={!!busy || state.mode !== "demo"}
                            onClick={() => void propose(kind)}
                          >
                            آزمایش در دمو
                          </Button>
                        </div>
                      </div>
                    </article>
                  ),
                )}
              </div>
              <div className="panel growth-ask">
                <Sparkles size={25} />
                <h3>نمی‌دانید کدام سرویس را نیاز دارید؟</h3>
                <p>
                  از کسب‌وکارتان بگویید. همراه کمک می‌کند قدم بعدی را آگاهانه
                  انتخاب کنید.
                </p>
                <Button onClick={() => setChatOpen(true)} icon={MessageCircle}>
                  با هم بررسی کنیم
                </Button>
              </div>
            </>
          )}
          {page === "memory" && <MemoryPage state={state} />}
          {page === "settings" && (
            <SettingsPage state={state} busy={busy} run={run} />
          )}
          {page === "chat" && (
            <div className="panel full-chat">
              <Chat state={state} />
            </div>
          )}
          {!pages.some((p) => p.id === page) &&
            !["settings", "chat"].includes(page) && (
              <Empty
                title="این صفحه پیدا نشد"
                text="به پیشخوان برگردید و از منو ادامه دهید."
                action={
                  <Button onClick={() => navigate("overview")}>
                    بازگشت به پیشخوان
                  </Button>
                }
              />
            )}
          <footer className="main-footer">
            <div>
              <span className={cn("status-dot", !online && "muted")} />
              {online ? "ارتباط زنده برقرار است" : "اتصال قطع است"}
              <span className="footer-separator">/</span>
              {state.monitor.lastCheck
                ? `آخرین بررسی ${time(state.monitor.lastCheck)}`
                : "در انتظار اولین بررسی"}
            </div>
            <span>شما بسازید، همراه مراقب است.</span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CircleCheck size={19} />
          {toast}
          <button
            className="icon-button"
            onClick={() => setToast("")}
            aria-label="بستن پیام"
          >
            <X size={16} />
          </button>
        </div>
      )}
      <Modal
        open={helpOpen}
        onOpenChange={setHelpOpen}
        title="از اینجا شروع کنید"
        description="همراه پیچیدگی فنی را به چند تصمیم روشن تبدیل می‌کند."
      >
        <div className="help-steps">
          {[
            {
              title: "ببینید کسب‌وکارتان چه حال دارد",
              text: "پیشخوان وضعیت سایت و مسیر سفارش را در یک نگاه نشان می‌دهد.",
              icon: HeartPulse,
            },
            {
              title: "مشکل را با شواهد بررسی کنید",
              text: "همراه با پایش مستقل اختلال را پیدا می‌کند؛ لاگ‌ها و علت احتمالی در هر رخداد ذخیره می‌شوند.",
              icon: Search,
            },
            {
              title: "با آگاهی تأیید کنید",
              text: "اثر و هزینهٔ هر تغییر مهم را پیش از تأیید می‌بینید. درخواست بعد از ۱۵ دقیقه منقضی می‌شود.",
              icon: ShieldCheck,
            },
            {
              title: "نتیجه را دنبال کنید",
              text: "اجرای موفق دستور کافی نیست. سایت و مسیر اصلی کسب‌وکار باید دوباره بررسی شوند.",
              icon: CheckCheck,
            },
          ].map(({ title, text, icon: Icon }) => (
            <div key={title}>
              <span className="icon-tile green">
                <Icon size={21} />
              </span>
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="info-line">
          <BookOpen size={17} />
          <a href="https://docs.liara.ir/" target="_blank" rel="noreferrer">
            مستندات رسمی لیارا
          </a>
        </div>
      </Modal>
      <Modal
        open={demoOpen}
        onOpenChange={setDemoOpen}
        title="همراه را در عمل ببینید"
        description="یک اختلال کنترل‌شده، روی فروشگاه محلی و آزمایشی"
      >
        <div className="demo-flow">
          <span>
            <HeartPulse />
            کشف
          </span>
          <ChevronLeft />
          <span>
            <Search />
            تشخیص
          </span>
          <ChevronLeft />
          <span>
            <ShieldCheck />
            تأیید
          </span>
          <ChevronLeft />
          <span>
            <CheckCheck />
            بررسی
          </span>
        </div>
        <p className="modal-paragraph">
          اتصال‌های دیتابیس فروشگاه آزمایشی را مشغول می‌کنیم تا ثبت سفارش خطا
          بدهد. همراه پس از {fa(3)} بررسی ناموفق، مشکل را کشف می‌کند و برای
          راه‌اندازی مجدد از شما تأیید می‌گیرد. سپس سلامت سایت و امکان ثبت سفارش
          را می‌آزماید.
        </p>
        <div className="notice-banner">
          <Info size={18} />
          <span>
            فقط محیط دمو تغییر می‌کند. هیچ سرویس ابری یا پرداخت واقعی درگیر
            نیست.
          </span>
        </div>
        <div className="demo-actions">
          <Button
            variant="primary"
            icon={Play}
            disabled={!!busy || state.mode !== "demo"}
            onClick={() =>
              run(
                "fault",
                async () => {
                  await api("/demo/fault", { kind: "pool" });
                  setDemoOpen(false);
                  navigate("incidents");
                },
                "اختلال ایجاد شد. همراه مستقل از گفتگو آن را شناسایی می‌کند.",
              )
            }
          >
            شروع آزمایش اختلال
          </Button>
          <Button
            icon={RefreshCw}
            disabled={!!busy || state.mode !== "demo"}
            onClick={() =>
              run(
                "reset",
                () => api("/demo/fault", { kind: "none" }),
                "فروشگاه آزمایشی سالم شد.",
              )
            }
          >
            بازگرداندن به حالت سالم
          </Button>
        </div>
        <details className="advanced">
          <summary>آزمایش مسیر ناموفق</summary>
          <p>
            در این سناریو، راه‌اندازی مجدد مشکل را حل نمی‌کند. همراه باید شکست
            را گزارش کند و رخداد را برطرف‌شده اعلام نکند.
          </p>
          <Button
            variant="danger"
            disabled={!!busy || state.mode !== "demo"}
            onClick={() =>
              run("persistent", async () => {
                await api("/demo/fault", { kind: "persistent" });
                setDemoOpen(false);
                navigate("incidents");
              })
            }
          >
            ایجاد خرابی پایدار در دمو
          </Button>
        </details>
      </Modal>
      <Modal
        open={notificationOpen}
        onOpenChange={setNotificationOpen}
        title="چه خبر از کسب‌وکار؟"
        description="آخرین تصمیم‌ها، رخدادها و نتایج"
      >
        <div className="notification-list">
          {state.audit
            .filter(
              (a) =>
                state.settings.notify ||
                !["setup", "settings"].includes(a.type),
            )
            .slice(0, 12)
            .map((a) => (
              <div key={a.id}>
                <span
                  className={cn(
                    "icon-tile small",
                    a.type === "failed" ? "amber" : "green",
                  )}
                >
                  {a.type === "failed" ? (
                    <TriangleAlert size={17} />
                  ) : (
                    <Activity size={17} />
                  )}
                </span>
                <div>
                  <strong>{a.title}</strong>
                  <small>
                    {date(a.at)} · {time(a.at)}
                  </small>
                </div>
              </div>
            ))}
        </div>
        {!state.settings.notify && (
          <p className="muted-text">
            نمایش اعلان‌های عادی غیرفعال است؛ نتایج عملیات همچنان ثبت می‌شوند.
          </p>
        )}
      </Modal>
      <Modal
        open={!!service}
        onOpenChange={(v) => !v && setService(null)}
        title={service?.name || "سرویس"}
        description="اطلاعات قابل مشاهده و لاگ‌های برنامه"
        wide
      >
        <div className="service-detail">
          <div className="detail-kv">
            <span>بستر</span>
            <code>{service?.platform}</code>
          </div>
          <div className="detail-kv">
            <span>پلن</span>
            <strong>{service?.plan}</strong>
          </div>
          <div className="detail-kv">
            <span>وضعیت</span>
            <span>{service?.detail}</span>
          </div>
        </div>
        {service?.type === "app" ? (
          <>
            <h3 className="subheading">
              لاگ‌های برنامه <span>مقادیر حساس پنهان شده‌اند</span>
            </h3>
            <pre className="log-view" dir="ltr">
              {logs}
            </pre>
            <div className="modal-actions">
              <Button
                icon={RefreshCw}
                onClick={() => void propose("restart_app")}
                disabled={!!busy || !state.connections.writable}
              >
                درخواست راه‌اندازی مجدد
              </Button>
              <Button
                icon={ExternalLink}
                onClick={() =>
                  window.open(
                    service?.url || "http://127.0.0.1:3002",
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
              >
                مشاهدهٔ سایت
              </Button>
            </div>
          </>
        ) : (
          <div className="info-line">
            <Info size={18} />
            {state.mode === "demo"
              ? "این کارت بخشی از نمای آزمایشی زیرساخت است. لاگ دریافت‌شده مربوط به برنامهٔ گل‌بازار است."
              : "برای جزئیات این سرویس از پنل لیارا استفاده کنید."}
          </div>
        )}
      </Modal>
      <Modal
        open={!!currentIncident}
        onOpenChange={(v) => !v && setIncident(null)}
        title={currentIncident?.title || "رخداد"}
        description={
          currentIncident
            ? `${date(currentIncident.createdAt)} · ${time(currentIncident.createdAt)} · ${statusLabels[currentIncident.status]}`
            : ""
        }
        wide
      >
        {currentIncident && (
          <>
            <div className="incident-diagnosis">
              <span className="icon-tile amber">
                <Search size={22} />
              </span>
              <div>
                <h3>
                  {currentIncident.status === "RESOLVED"
                    ? "تحلیل ثبت‌شده در زمان اختلال"
                    : "چه اتفاقی افتاده؟"}
                </h3>
                <p>{currentIncident.diagnosis || currentIncident.summary}</p>
                {currentIncident.confidence && (
                  <small>{currentIncident.confidence}</small>
                )}
              </div>
            </div>
            {currentIncident.status === "ESCALATED" && (
              <button
                className="button secondary"
                disabled={!!busy}
                onClick={() =>
                  run(
                    "investigate",
                    () => api(`/incidents/${currentIncident.id}/investigate`),
                    "شواهد و تحلیل دوباره بررسی شد",
                  )
                }
              >
                جمع‌آوری دوبارهٔ شواهد و تحلیل
              </button>
            )}
            <div className="timeline">
              {currentIncident.timeline.map((step, i) => (
                <div className="timeline-item" key={`${step.status}-${i}`}>
                  <span
                    className={cn(
                      "timeline-marker",
                      i === currentIncident.timeline.length - 1 && "current",
                    )}
                  >
                    {i < currentIncident.timeline.length - 1 ? (
                      <Check size={13} />
                    ) : (
                      <span />
                    )}
                  </span>
                  <div>
                    <strong>{statusLabels[step.status]}</strong>
                    <p>{step.note}</p>
                  </div>
                  <time>{time(step.at)}</time>
                </div>
              ))}
            </div>
            {currentIncident.verification && (
              <div className="notice-banner success">
                <CheckCheck size={20} />
                {currentIncident.verification}
              </div>
            )}
            <details className="evidence">
              <summary>
                <FileText size={16} />
                مشاهدهٔ شواهد ({fa(currentIncident.evidence.length)})
                <ChevronDown size={16} />
              </summary>
              {currentIncident.evidence.map((e, i) => (
                <div className="evidence-item" key={i}>
                  <strong>{e.label}</strong>
                  <small>
                    {e.source} · {time(e.at)}
                  </small>
                  <pre>{e.value}</pre>
                </div>
              ))}
            </details>
            {["ESCALATED", "REJECTED", "AWAITING_APPROVAL"].includes(
              currentIncident.status,
            ) && (
              <div className="modal-actions">
                <Button
                  icon={RefreshCw}
                  disabled={!!busy}
                  onClick={() =>
                    run(
                      "recheck",
                      () => api(`/incidents/${currentIncident.id}/recheck`),
                      "بررسی مجدد ثبت شد.",
                    )
                  }
                >
                  اصلاح کردم؛ دوباره بررسی کن
                </Button>
              </div>
            )}
            {currentIncident.actionId &&
              state.actions.find((a) => a.id === currentIncident.actionId)
                ?.status === "pending" && (
                <div className="modal-actions">
                  <Button
                    variant="primary"
                    icon={ShieldCheck}
                    onClick={() => {
                      setApproval(
                        state.actions.find(
                          (a) => a.id === currentIncident.actionId,
                        )!,
                      );
                      setRestoreText("");
                    }}
                  >
                    بررسی و تأیید راهکار
                  </Button>
                </div>
              )}
          </>
        )}
      </Modal>
      <AlertDialog.Root
        open={!!currentApproval}
        onOpenChange={(v) => {
          if (!v && !busy) setApproval(null);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="modal-overlay approval-overlay" />
          <AlertDialog.Content dir="rtl" className="modal approval-modal">
            <span className="approval-hero-icon">
              <ShieldCheck size={31} />
            </span>
            <AlertDialog.Title>{currentApproval?.title}</AlertDialog.Title>
            <AlertDialog.Description>
              {currentApproval?.description}
            </AlertDialog.Description>
            {currentApproval && (
              <>
                <div className="approval-facts">
                  <div>
                    <Server size={18} />
                    <span>سرویس هدف</span>
                    <strong>{currentApproval.target}</strong>
                  </div>
                  <div>
                    <TriangleAlert size={18} />
                    <span>اثر احتمالی</span>
                    <strong>{currentApproval.impact}</strong>
                  </div>
                  <div>
                    <Wallet size={18} />
                    <span>هزینه</span>
                    <strong>{currentApproval.cost}</strong>
                  </div>
                  <div>
                    <Clock size={18} />
                    <span>مهلت تأیید</span>
                    <strong>{time(currentApproval.expiresAt)}</strong>
                  </div>
                </div>
                {state.mode === "demo" && (
                  <div className="demo-approval-note">
                    <Info size={16} />
                    این عملیات فقط در محیط آزمایشی اجرا می‌شود.
                  </div>
                )}
                {currentApproval.kind === "restore_backup" && (
                  <label className="field">
                    <span>
                      برای تأیید حذف اطلاعات جدیدتر، «بازگردانی» را بنویسید.
                    </span>
                    <input
                      value={restoreText}
                      onChange={(e) => setRestoreText(e.target.value)}
                      autoComplete="off"
                    />
                  </label>
                )}
                <div className="approval-buttons">
                  <Button
                    variant="primary"
                    icon={busy === "approve" ? LoaderCircle : Check}
                    disabled={
                      !!busy ||
                      currentApproval.status !== "pending" ||
                      Date.parse(currentApproval.expiresAt) < Date.now() ||
                      (currentApproval.kind === "restore_backup" &&
                        restoreText !== "بازگردانی")
                    }
                    onClick={() =>
                      run(
                        "approve",
                        async () => {
                          await api(`/actions/${currentApproval.id}/decision`, {
                            approve: true,
                            fingerprint: currentApproval.fingerprint,
                          });
                          setApproval(null);
                          setService(null);
                        },
                        "نتیجهٔ عملیات در فعالیت‌ها ثبت شد.",
                      )
                    }
                  >
                    {busy === "approve"
                      ? "در حال اجرا و بررسی نتیجه…"
                      : "تأیید می‌کنم، انجام بده"}
                  </Button>
                  <Button
                    disabled={!!busy || currentApproval.status !== "pending"}
                    onClick={() =>
                      run(
                        "reject",
                        async () => {
                          await api(`/actions/${currentApproval.id}/decision`, {
                            approve: false,
                            fingerprint: currentApproval.fingerprint,
                          });
                          setApproval(null);
                        },
                        "پیشنهاد اجرا نشد.",
                      )
                    }
                  >
                    اجرا نکن
                  </Button>
                  <AlertDialog.Cancel className="text-button" disabled={!!busy}>
                    بعداً تصمیم می‌گیرم
                  </AlertDialog.Cancel>
                </div>
                {error && (
                  <p className="inline-error" role="alert">
                    {error}
                  </p>
                )}
                {currentApproval.status === "failed" && (
                  <p className="inline-error" role="alert">
                    {currentApproval.error}
                  </p>
                )}
                <p className="approval-trust">
                  <LockKeyhole size={13} />
                  تأیید فقط برای همین عملیات است و در تاریخچه ذخیره می‌شود.
                </p>
              </>
            )}
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
      <Dialog.Root open={chatOpen} onOpenChange={setChatOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="chat-overlay" />
          <Dialog.Content dir="rtl" className="chat-drawer">
            <div className="chat-drawer-header">
              <span className="agent-symbol">
                <AudioLines size={23} />
              </span>
              <div>
                <Dialog.Title>همراه شما هستم</Dialog.Title>
                <Dialog.Description>
                  {state.agentProvider === "cursor"
                    ? "با حافظهٔ پایدار Cursor"
                    : "پاسخ‌های نمایشی · حافظهٔ پایدار"}
                </Dialog.Description>
              </div>
              <Dialog.Close className="icon-button" aria-label="بستن گفتگو">
                <X size={20} />
              </Dialog.Close>
            </div>
            <Chat state={state} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function Stats({ state, pending }: { state: Snapshot; pending: number }) {
  const good = state.probes.filter((p) => p.healthy).length;
  const total = state.probes.length;
  const last = state.probes.at(-1);
  const stats = [
    {
      label: "سلامت سایت",
      value: total ? fa((good / total) * 100) : "—",
      unit: total ? "٪" : "",
      icon: HeartPulse,
      caption: `در ${fa(total)} بررسی اخیر`,
      tone: "green",
    },
    {
      label: "زمان پاسخ",
      value: last ? fa(last.latency) : "—",
      unit: "ms",
      icon: Gauge,
      caption: last?.healthy ? "آخرین بررسی موفق" : "آخرین بررسی سایت",
      tone: "green",
    },
    {
      label: "سرویس‌های متصل",
      value: fa(state.services.length),
      unit: "سرویس",
      icon: Layers,
      caption:
        state.mode === "demo" ? "۱ محلی + ۲ کارت نمونه" : "دریافت‌شده از لیارا",
      tone: "green",
    },
    {
      label: "منتظر تصمیم شما",
      value: fa(pending),
      unit: "درخواست",
      icon: ShieldCheck,
      caption: pending ? "شما کنترل را در دست دارید" : "فعلاً تصمیمی لازم نیست",
      tone: pending ? "amber" : "green",
    },
  ];
  return (
    <div className="stats-grid">
      {stats.map(({ label, value, unit, icon: Icon, caption, tone }, i) => (
        <article className="stat-card" key={label}>
          <div className="stat-top">
            <span>{label}</span>
            <Icon size={18} />
          </div>
          <div className="stat-value">
            <strong>{value}</strong>
            <span>{unit}</span>
            {i === 1 && (
              <span className="mini-spark">
                <svg viewBox="0 0 85 26" fill="none">
                  <path
                    d="M1 22 10 17 20 20 30 10 40 15 48 8 58 11 67 5 75 9 84 2"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                </svg>
              </span>
            )}
          </div>
          <div className={cn("stat-caption", tone)}>
            {i === 0 ? (
              <span className="status-dot" />
            ) : i === 3 ? (
              <LockKeyhole size={12} />
            ) : (
              <span className="caption-line" />
            )}
            {caption}
          </div>
        </article>
      ))}
    </div>
  );
}
function HealthChart({
  state,
  onCheck,
  busy,
}: {
  state: Snapshot;
  onCheck: () => void;
  busy: boolean;
}) {
  const [range, setRange] = useState<"recent" | "hour">("recent");
  const probes =
    range === "hour"
      ? state.probes.filter((p) => Date.parse(p.at) > Date.now() - 3600000)
      : state.probes.slice(-24);
  const data = probes.map((p, i) => ({
    name: time(p.at),
    latency: p.latency,
    healthy: p.healthy,
    seq: i,
  }));
  return (
    <section className="panel health-panel">
      <div className="panel-heading">
        <div className="panel-title">
          <span className="small-section-icon">
            <Activity size={18} />
          </span>
          <h2>نبض کسب‌وکار شما</h2>
        </div>
        <div className="segment-control">
          <button
            className={cn(range === "recent" && "selected")}
            onClick={() => setRange("recent")}
          >
            بررسی‌های اخیر
          </button>
          <button
            className={cn(range === "hour" && "selected")}
            onClick={() => setRange("hour")}
          >
            یک ساعت
          </button>
        </div>
      </div>
      <div className="chart-summary">
        <span>
          <i className="status-dot" />
          زمان پاسخ سایت
        </span>
        <span className="chart-unit">میلی‌ثانیه</span>
      </div>
      <div
        className="chart-box"
        dir="ltr"
        role="img"
        aria-label={`نمودار زمان پاسخ، ${fa(data.length)} بررسی. آخرین زمان ${fa(probes.at(-1)?.latency || 0)} میلی‌ثانیه.`}
      >
        {data.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{ top: 12, right: 10, left: -25, bottom: 0 }}
            >
              <defs>
                <linearGradient id="jadeArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#5fd3a5" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="#5fd3a5" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                stroke="#ffffff09"
                strokeDasharray="3 5"
                vertical={false}
              />
              <XAxis
                dataKey="name"
                stroke="#727d77"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10 }}
                minTickGap={45}
              />
              <YAxis
                stroke="#727d77"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10 }}
                tickCount={4}
                domain={[0, "auto"]}
              />
              <Tooltip
                contentStyle={{
                  background: "#202823",
                  border: "1px solid #35473c",
                  borderRadius: 10,
                  color: "#d9e7df",
                  fontFamily: "Vazirmatn Variable",
                }}
                formatter={(v) => [`${fa(Number(v))} ms`, "زمان پاسخ"]}
                labelStyle={{ color: "#9ba89f" }}
              />
              <Area
                type="monotone"
                dataKey="latency"
                stroke="#72d9ad"
                fill="url(#jadeArea)"
                strokeWidth={2}
                isAnimationActive={false}
                activeDot={{ r: 4, stroke: "#12281c", strokeWidth: 3 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="chart-waiting">
            <Activity size={25} />
            <span>با چند بررسی، نبض سایت اینجا شکل می‌گیرد.</span>
          </div>
        )}
      </div>
      <div className="health-checks">
        <span>
          <CircleCheck
            size={14}
            className={
              state.probes.at(-1)?.healthOk ? "text-jade" : "text-muted"
            }
          />
          پاسخ‌گویی سایت
        </span>
        <span>
          <CircleCheck
            size={14}
            className={
              state.probes.at(-1)?.businessOk ? "text-jade" : "text-muted"
            }
          />
          مسیر ثبت سفارش
        </span>
        <button className="text-button" disabled={busy} onClick={onCheck}>
          <RefreshCw size={13} className={busy ? "spin" : ""} />
          بررسی تازه
        </button>
      </div>
    </section>
  );
}
function ActivityCard({
  state,
  onAll,
  onChat,
}: {
  state: Snapshot;
  onAll: () => void;
  onChat: () => void;
}) {
  const events = state.audit.slice(0, 3);
  return (
    <section className="panel activity-panel">
      <div className="panel-heading">
        <div className="panel-title">
          <span className="small-section-icon">
            <AudioLines size={18} />
          </span>
          <h2>همراه چه می‌کند؟</h2>
        </div>
        <span className="live-label">
          <i className="status-dot" />
          زنده
        </span>
      </div>
      <div className="activity-note">
        <span className="agent-small">
          <Sparkles size={15} />
        </span>
        <p>
          {state.probes.at(-1)?.healthy
            ? "آخرین بار سایت و مسیر سفارش را بررسی کردم؛ هر دو سالم‌اند."
            : "وضعیت کسب‌وکارتان را زیر نظر دارم. نتیجهٔ بررسی‌ها همین‌جا ثبت می‌شود."}
        </p>
      </div>
      <div className="activity-list">
        {events.map((e, i) => (
          <div key={e.id} className="activity-item">
            <span className={cn("activity-dot", e.type === "failed" && "warn")}>
              {e.type === "verified" ? <Check size={11} /> : <span />}
            </span>
            <div>
              <strong>{e.title}</strong>
              <small>
                {time(e.at)}
                {i === 0 && " · آخرین فعالیت"}
              </small>
            </div>
          </div>
        ))}
      </div>
      <div className="activity-footer">
        <button className="text-button muted-text" onClick={onAll}>
          همهٔ فعالیت‌ها
          <ArrowLeft size={14} />
        </button>
        <button
          className="icon-button"
          aria-label="گفتگو دربارهٔ فعالیت‌ها"
          onClick={onChat}
        >
          <MessageCircle size={16} />
        </button>
      </div>
    </section>
  );
}
function ServiceCard({
  service: s,
  onClick,
}: {
  service: Service;
  onClick: () => void;
}) {
  const Icon = serviceIcons[s.type];
  return (
    <button className="panel service-card" onClick={onClick}>
      <div className="service-card-head">
        <span className="service-icon">
          <Icon size={23} />
        </span>
        <div>
          <h3>{s.name}</h3>
          <span>{s.platform}</span>
        </div>
        <ChevronLeft className="service-arrow" size={17} />
      </div>
      <div className="service-status">
        <Badge
          tone={
            s.status === "healthy"
              ? "green"
              : s.status === "unknown"
                ? "gray"
                : s.status === "warning"
                  ? "amber"
                  : "red"
          }
        >
          {s.status === "healthy"
            ? "سالم"
            : s.status === "unknown"
              ? "بررسی نشده"
              : s.status === "warning"
                ? "نیاز به بررسی"
                : "اختلال"}
        </Badge>
        <span>{s.plan}</span>
      </div>
      <p>{s.detail}</p>
      <div className="service-card-footer">
        {s.cpu !== undefined ? (
          <>
            <div>
              <span>CPU</span>
              <div className="resource-track">
                <i style={{ width: `${s.cpu}%` }} />
              </div>
              <small>{fa(s.cpu)}٪</small>
            </div>
            <div>
              <span>RAM</span>
              <div className="resource-track">
                <i style={{ width: `${s.memory}%` }} />
              </div>
              <small>{fa(s.memory || 0)}٪</small>
            </div>
          </>
        ) : (
          <span className="service-detail-link">
            مشاهدهٔ جزئیات
            <ArrowUpLeft size={14} />
          </span>
        )}
      </div>
    </button>
  );
}
function MemoryPage({ state }: { state: Snapshot }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const events = state.audit.filter(
    (e) =>
      (filter === "all" ||
        (filter === "actions" &&
          [
            "approved",
            "verified",
            "failed",
            "rejected",
            "approval_requested",
          ].includes(e.type)) ||
        (filter === "incidents" &&
          ["incident", "detection"].includes(e.type))) &&
      `${e.title} ${e.detail}`.includes(query),
  );
  return (
    <>
      <div className="memory-stats">
        <div className="panel">
          <MessageCircle size={22} />
          <strong>{fa(state.messages.length)}</strong>
          <span>پیام در حافظه</span>
        </div>
        <div className="panel">
          <Activity size={22} />
          <strong>{fa(state.audit.length)}</strong>
          <span>رویداد قابل پیگیری</span>
        </div>
        <div className="panel">
          <ShieldCheck size={22} />
          <strong>SQLite</strong>
          <span>حافظهٔ پایدار روی دستگاه</span>
        </div>
      </div>
      <div className="panel memory-panel">
        <SectionHeading
          title="هیچ تصمیمی گم نمی‌شود"
          subtitle="تأییدها، اقدامات، شکست‌ها و نتیجه‌ها؛ همراه با زمان و عامل اجرا"
          action={
            <a className="button secondary" href="/api/memory/export" download>
              <Download size={16} />
              خروجی حافظه
            </a>
          }
        />
        <div className="memory-toolbar">
          <div className="segment-control">
            <button
              onClick={() => setFilter("all")}
              className={cn(filter === "all" && "selected")}
            >
              همه
            </button>
            <button
              onClick={() => setFilter("actions")}
              className={cn(filter === "actions" && "selected")}
            >
              تصمیم‌ها
            </button>
            <button
              onClick={() => setFilter("incidents")}
              className={cn(filter === "incidents" && "selected")}
            >
              رخدادها
            </button>
          </div>
          <label className="search-field">
            <Search size={16} />
            <input
              aria-label="جستجو در تاریخچه"
              placeholder="جستجو در حافظه…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        <div className="audit-list">
          {events.map((e) => (
            <details key={e.id} className="audit-event">
              <summary>
                <span
                  className={cn(
                    "icon-tile small",
                    e.type === "failed" ? "amber" : "green",
                  )}
                >
                  {e.type === "failed" ? (
                    <TriangleAlert size={16} />
                  ) : e.actor === "user" ? (
                    <ShieldCheck size={16} />
                  ) : (
                    <Activity size={16} />
                  )}
                </span>
                <div>
                  <strong>{e.title}</strong>
                  <small>
                    {e.actor === "user" ? "با تصمیم شما" : "توسط همراه"} ·{" "}
                    {date(e.at)}، {time(e.at)}
                  </small>
                </div>
                <ChevronDown size={15} />
              </summary>
              <pre dir="ltr">{e.detail}</pre>
              <code className="audit-hash" dir="ltr">
                SHA-256: {e.hash}
              </code>
            </details>
          ))}
          {events.length === 0 && (
            <Empty
              icon={Search}
              title="فعالیتی پیدا نشد"
              text="عبارت یا فیلتر جستجو را تغییر دهید."
            />
          )}
        </div>
        <div className="memory-bottom">
          <LockKeyhole size={14} />
          زنجیرهٔ هش برای تشخیص تغییر تاریخچه
          <a href="/api/audit/export" download>
            دریافت گزارش صحت
            <Download size={13} />
          </a>
        </div>
      </div>
    </>
  );
}
function ConnectionTestControl({
  provider,
  token,
  configured,
  busy,
  run,
}: {
  provider: "liara" | "cursor";
  token: string;
  configured: boolean;
  busy: string;
  run: (
    key: string,
    task: () => Promise<unknown>,
    message?: string,
  ) => Promise<void>;
}) {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  const label = provider === "liara" ? "لیارا" : "Cursor";
  const taskKey = `test-${provider}`;
  useEffect(() => {
    setResult(null);
  }, [token, configured]);
  async function test() {
    if (busy) return;
    setResult(null);
    await run(taskKey, async () => {
      try {
        const checked = await api<{
          message: string;
          checkedAt: string;
          source: "saved" | "entered";
        }>(
          `/settings/${provider}/test`,
          token.trim() ? { token: token.trim() } : {},
        );
        setResult({
          ok: true,
          message: `${checked.message} (${checked.source === "saved" ? "کلید ذخیره‌شده" : "کلید واردشده"}، ساعت ${time(checked.checkedAt)})`,
        });
      } catch (error) {
        setResult({ ok: false, message: (error as Error).message });
        throw error;
      }
    });
  }
  return (
    <>
      <Button
        icon={busy === taskKey ? LoaderCircle : Activity}
        disabled={!!busy || (!configured && !token.trim())}
        onClick={() => void test()}
      >
        {busy === taskKey ? "در حال تست اتصال…" : `تست اتصال ${label}`}
      </Button>
      <p
        id={`${provider}-test-result`}
        className={cn(
          "connection-test-result",
          result && (result.ok ? "liara-key-status" : "liara-key-error"),
        )}
        role="status"
        aria-atomic="true"
      >
        {busy === taskKey ? `در حال بررسی اتصال به ${label}…` : result?.message}
      </p>
    </>
  );
}
function CursorKeyForm({
  configured,
  busy,
  run,
  demo,
}: {
  configured: boolean;
  busy: string;
  run: (
    key: string,
    task: () => Promise<unknown>,
    message?: string,
  ) => Promise<void>;
  demo: boolean;
}) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const validate = (value: string) =>
    !value.trim()
      ? "کلید Cursor را وارد کنید."
      : !/^[\x21-\x7e]{1,4096}$/.test(value.trim())
        ? "کلید را بدون فاصله و با حروف و اعداد انگلیسی وارد کنید."
        : "";
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const validation = validate(key);
    setError(validation);
    setSaved(false);
    if (validation) {
      input.current?.focus();
      return;
    }
    await run("cursor-key", async () => {
      try {
        await api("/settings/cursor", { token: key.trim() });
        setKey("");
        setSaved(true);
      } catch (error) {
        setError((error as Error).message);
        input.current?.focus();
        throw error;
      }
    });
  }
  return (
    <form
      className="liara-key-form"
      onSubmit={submit}
      aria-busy={busy === "cursor-key"}
      noValidate
    >
      <label className="field" htmlFor="cursor-api-key">
        <span>{configured ? "جایگزینی کلید Cursor" : "کلید API Cursor"}</span>
        <input
          ref={input}
          id="cursor-api-key"
          type="password"
          dir="ltr"
          autoComplete="new-password"
          spellCheck={false}
          autoCapitalize="none"
          maxLength={4096}
          required
          value={key}
          disabled={!!busy}
          placeholder={
            configured
              ? "کلید جدید Cursor را وارد کنید"
              : "کلید Cursor را اینجا بچسبانید"
          }
          aria-invalid={!!error}
          aria-describedby={`cursor-key-help${error ? " cursor-key-error" : ""}`}
          onBlur={() => {
            if (key) setError(validate(key));
          }}
          onChange={(e) => {
            setKey(e.target.value);
            setError("");
            setSaved(false);
          }}
        />
      </label>
      <p id="cursor-key-help">
        کلید به‌صورت رمزگذاری‌شده روی همین سرور ذخیره می‌شود، دوباره نمایش داده
        نمی‌شود و از درخواست بعدی بدون راه‌اندازی مجدد استفاده خواهد شد.
      </p>
      {error && (
        <p id="cursor-key-error" className="liara-key-error" role="alert">
          {error}
        </p>
      )}
      <div className="secret-key-actions">
        <Button
          type="submit"
          variant="primary"
          icon={busy === "cursor-key" ? LoaderCircle : LockKeyhole}
          disabled={!!busy}
        >
          {busy === "cursor-key" ? "در حال ذخیره…" : "ذخیرهٔ کلید Cursor"}
        </Button>
        <ConnectionTestControl
          provider="cursor"
          token={key}
          configured={configured}
          busy={busy}
          run={run}
        />
      </div>
      <p>
        کادر خالی باشد، کلید ذخیره‌شده تست می‌شود؛ تست اتصال، کلید جدید را ذخیره
        نمی‌کند و مدل را اجرا نمی‌کند.
      </p>
      <p role="status" className="liara-key-status">
        {saved
          ? "کلید Cursor ذخیره شد. برای بررسی اعتبار آن، تست اتصال را بزنید."
          : ""}
      </p>
      {demo && (
        <p>
          گفتگو در حالت نمایشی با پاسخ‌های نمونه انجام می‌شود؛ برای تحلیل واقعی،
          حالت «واقعی» را انتخاب کنید.
        </p>
      )}
    </form>
  );
}
function SettingsPage({
  state,
  busy,
  run,
}: {
  state: Snapshot;
  busy: string;
  run: (
    key: string,
    task: () => Promise<unknown>,
    message?: string,
  ) => Promise<void>;
}) {
  const [name, setName] = useState(state.settings.businessName);
  const [liaraToken, setLiaraToken] = useState("");
  const [tokenError, setTokenError] = useState("");
  const [tokenSaved, setTokenSaved] = useState(false);
  const [selectedMode, setSelectedMode] = useState(state.mode);
  const [modeError, setModeError] = useState("");
  const [modeSaved, setModeSaved] = useState("");
  useEffect(() => {
    setSelectedMode(state.mode);
  }, [state.mode]);
  const tokenInput = useRef<HTMLInputElement>(null);
  const validateToken = (value: string) => {
    const token = value.trim();
    return !token
      ? "کلید لیارا را وارد کنید."
      : !/^[\x21-\x7e]{1,8192}$/.test(token)
        ? "کلید را بدون فاصله و با حروف و اعداد انگلیسی وارد کنید."
        : "";
  };
  async function submitLiaraToken(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const error = validateToken(liaraToken);
    setTokenError(error);
    setTokenSaved(false);
    if (error) {
      tokenInput.current?.focus();
      return;
    }
    await run("liara-token", async () => {
      try {
        await api("/settings/liara", { token: liaraToken.trim() });
        setLiaraToken("");
        setTokenSaved(true);
      } catch (error) {
        setTokenError((error as Error).message);
        tokenInput.current?.focus();
        throw error;
      }
    });
  }
  async function submitMode(e: FormEvent) {
    e.preventDefault();
    if (busy || selectedMode === state.mode) return;
    setModeError("");
    setModeSaved("");
    if (selectedMode === "live" && !state.connections.liara) {
      setModeError("ابتدا کلید لیارا را در کادر پایین وارد و ذخیره کنید.");
      tokenInput.current?.focus();
      return;
    }
    await run("mode", async () => {
      try {
        const result = await api<{ mode: Snapshot["mode"] }>("/connection", {
          mode: selectedMode,
        });
        setModeSaved(
          result.mode === "live"
            ? "حالت واقعی فعال و ذخیره شد."
            : "حالت نمایشی فعال و ذخیره شد.",
        );
      } catch (error) {
        setModeError((error as Error).message);
        throw error;
      }
    });
  }
  return (
    <div className="settings-layout">
      <div className="panel settings-panel">
        <SectionHeading
          title="اتصال‌های همراه"
          subtitle="کلیدهای لیارا و Cursor را همین‌جا ذخیره کنید؛ مقادیر ذخیره‌شده دوباره نمایش داده نمی‌شوند."
        />
        <LiaraAccount
          teamId={state.connections.teamId}
          enabled={state.mode === "live" && state.connections.liara}
        />
        <form
          className="liara-key-form mode-form"
          onSubmit={submitMode}
          aria-busy={busy === "mode"}
        >
          <fieldset disabled={!!busy} aria-describedby="mode-help mode-current">
            <legend>حالت اجرای همراه</legend>
            <div className="mode-options">
              {(
                [
                  {
                    value: "demo",
                    label: "نمایشی (دمو)",
                    description: "آزمایش با داده‌های نمونه",
                  },
                  {
                    value: "live",
                    label: "واقعی",
                    description: "اتصال به حساب لیارا",
                  },
                ] as const
              ).map(({ value, label, description }) => (
                <label
                  key={value}
                  className={cn(
                    "mode-option",
                    selectedMode === value && "selected",
                  )}
                >
                  <input
                    type="radio"
                    name="app-mode"
                    value={value}
                    checked={selectedMode === value}
                    onChange={() => {
                      setSelectedMode(value);
                      setModeError("");
                      setModeSaved("");
                    }}
                  />
                  <span>
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <p id="mode-current">
            حالت فعلی: {state.mode === "live" ? "واقعی" : "نمایشی"}
          </p>
          <p id="mode-help">
            برای حالت واقعی از کلید ذخیره‌شدهٔ لیارا استفاده می‌شود. حالت
            انتخابی بدون راه‌اندازی مجدد اعمال می‌شود و پس از بستن برنامه باقی
            می‌ماند. تاریخچهٔ هر حالت جداست.
          </p>
          {modeError && (
            <p className="liara-key-error" role="alert">
              {modeError}
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            icon={busy === "mode" ? LoaderCircle : RefreshCw}
            disabled={!!busy || selectedMode === state.mode}
          >
            {busy === "mode"
              ? selectedMode === "live"
                ? "در حال بررسی اتصال…"
                : "در حال تغییر حالت…"
              : "ذخیرهٔ حالت"}
          </Button>
          <p className="liara-key-status" role="status">
            {modeSaved}
          </p>
        </form>
        {[
          {
            label: "زیرساخت لیارا",
            icon: Cloud,
            configured: state.connections.liara,
            key: "LIARA_API_TOKEN",
            text: "دریافت سرویس‌ها، لاگ‌ها و اجرای عملیات تأییدشده",
          },
          {
            label: "ایجنت محلی Cursor",
            icon: AudioLines,
            configured: state.connections.cursor,
            key: "CURSOR_API_KEY",
            text: "تحلیل، فراخوانی ابزارها و ادامهٔ گفتگو با حافظهٔ پایدار",
          },
        ].map(({ label, icon: Icon, configured, key, text }) => (
          <div className="connection-row" key={key}>
            <span className="icon-tile green">
              <Icon size={22} />
            </span>
            <div>
              <h3>{label}</h3>
              <p>{text}</p>
              <code>{key}</code>
            </div>
            <Badge tone={configured ? "green" : "gray"}>
              {configured ? "کلید تنظیم شده" : "منتظر کلید"}
            </Badge>
          </div>
        ))}
        <form
          className="liara-key-form"
          onSubmit={submitLiaraToken}
          aria-busy={busy === "liara-token"}
          noValidate
        >
          <label className="field" htmlFor="liara-api-token">
            <span>
              {state.connections.liara
                ? "جایگزینی کلید لیارا"
                : "کلید API لیارا"}
            </span>
            <input
              ref={tokenInput}
              id="liara-api-token"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              spellCheck={false}
              autoCapitalize="none"
              maxLength={8192}
              required
              value={liaraToken}
              disabled={!!busy}
              placeholder={
                state.connections.liara
                  ? "کلید جدید را وارد کنید"
                  : "کلید لیارا را اینجا بچسبانید"
              }
              aria-invalid={!!tokenError}
              aria-describedby={`liara-key-help${tokenError ? " liara-key-error" : ""}`}
              onBlur={() => {
                if (liaraToken) setTokenError(validateToken(liaraToken));
              }}
              onChange={(e) => {
                setLiaraToken(e.target.value);
                setTokenError("");
                setTokenSaved(false);
              }}
            />
          </label>
          <p id="liara-key-help">
            کلید به‌صورت رمزگذاری‌شده روی همین سرور ذخیره می‌شود و بدون
            راه‌اندازی مجدد قابل استفاده است.
          </p>
          {tokenError && (
            <p id="liara-key-error" className="liara-key-error" role="alert">
              {tokenError}
            </p>
          )}
          <div className="secret-key-actions">
            <Button
              type="submit"
              variant="primary"
              icon={busy === "liara-token" ? LoaderCircle : LockKeyhole}
              disabled={!!busy}
            >
              {busy === "liara-token" ? "در حال ذخیره…" : "ذخیرهٔ کلید لیارا"}
            </Button>
            <ConnectionTestControl
              provider="liara"
              token={liaraToken}
              configured={state.connections.liara}
              busy={busy}
              run={run}
            />
          </div>
          <p>
            کادر خالی باشد، کلید ذخیره‌شده تست می‌شود؛ تست اتصال، کلید جدید را
            ذخیره نمی‌کند.
          </p>
          <p role="status" className="liara-key-status">
            {tokenSaved
              ? "کلید لیارا ذخیره شد. برای بررسی اعتبار آن، تست اتصال را بزنید."
              : ""}
          </p>
          {state.mode === "demo" && (
            <p>
              حالت نمایشی فعال است؛ ذخیرهٔ کلید، حالت برنامه را تغییر نمی‌دهد.
            </p>
          )}
        </form>
        <CursorKeyForm
          configured={state.connections.cursor}
          busy={busy}
          run={run}
          demo={state.mode === "demo"}
        />
        <div className="env-guide">
          <strong>
            <Terminal size={16} />
            راه‌اندازی اتصال واقعی
          </strong>
          <ol>
            <li>کلید لیارا را در کادر بالا وارد و ذخیره کنید.</li>
            <li>
              «واقعی» را در بخش حالت اجرای همراه انتخاب کنید و «ذخیرهٔ حالت» را
              بزنید؛ اتصال حساب پیش از تغییر حالت بررسی می‌شود.
            </li>
            <li>
              از «راه‌اندازی آسان» برای تنظیم برنامه و زیرساخت کسب‌وکارتان
              استفاده کنید.
            </li>
            <li>
              کلید Cursor را در کادر بالا وارد و ذخیره کنید؛ نیازی به تغییر فایل
              تنظیمات یا راه‌اندازی مجدد نیست.
            </li>
          </ol>
          <p>
            برای Cursor به Node.js نسخهٔ ۲۲٫۱۳ یا بالاتر و دسترسی شبکه به سرویس
            Cursor نیاز دارید.
          </p>
        </div>
        <Button
          disabled={!!busy}
          icon={RefreshCw}
          onClick={() =>
            run(
              "connect",
              () => api("/refresh"),
              "اطلاعات اتصال دوباره دریافت شد؛ وضعیت و خطاهای احتمالی را در صفحه ببینید.",
            )
          }
        >
          دریافت دوبارهٔ اطلاعات
        </Button>
      </div>
      <div className="panel settings-panel">
        <SectionHeading
          title="همراه چقدر اختیار دارد؟"
          subtitle="عملیات خواندنی مستقل؛ تغییرات حساس با تصمیم شما"
        />
        <div className="permission-row">
          <span className="icon-tile small green">
            <Search size={17} />
          </span>
          <div>
            <strong>بررسی سلامت و جمع‌آوری شواهد</strong>
            <p>بدون تأیید، در هر نوبت پایش</p>
          </div>
          <Badge>خودکار</Badge>
        </div>
        <div className="permission-row">
          <span className="icon-tile small amber">
            <ShieldCheck size={17} />
          </span>
          <div>
            <strong>ری‌استارت، انتشار و پشتیبان‌گیری</strong>
            <p>تأیید مشخص با مهلت ۱۵ دقیقه‌ای</p>
          </div>
          <Badge tone="amber">با تأیید</Badge>
        </div>
        <div className="permission-row">
          <span className="icon-tile small gray">
            <LockKeyhole size={17} />
          </span>
          <div>
            <strong>شارژ بانکی و ویرایش آزاد کد</strong>
            <p>در این نسخه دسترسی ندارد</p>
          </div>
          <Badge tone="gray">بسته</Badge>
        </div>
        <div className="settings-toggles">
          <Toggle
            checked={state.settings.monitoring}
            label="مراقبت خودکار"
            description={`بررسی هر ${fa(state.monitor.intervalMs / 1000)} ثانیه، مستقل از گفتگو`}
            disabled={!!busy}
            onChange={() =>
              run("monitor", () =>
                api(
                  "/settings",
                  { monitoring: !state.settings.monitoring },
                  "PATCH",
                ),
              )
            }
          />
          <Toggle
            checked={state.settings.notify}
            label="اعلان‌های عادی"
            description="نمایش رخدادهای عادی در پنل اعلان‌ها"
            disabled={!!busy}
            onChange={() =>
              run("notify", () =>
                api("/settings", { notify: !state.settings.notify }, "PATCH"),
              )
            }
          />
        </div>
      </div>
      <div className="panel settings-panel">
        <SectionHeading
          title="کسب‌وکار شما"
          subtitle="همراه را برای فضای کاری خودتان تنظیم کنید."
        />
        <form
          className="business-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              "name",
              () => api("/settings", { businessName: name }, "PATCH"),
              "نام کسب‌وکار ذخیره شد.",
            );
          }}
        >
          <label className="field">
            <span>نام کسب‌وکار</span>
            <input
              value={name}
              maxLength={60}
              required
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <Button type="submit" variant="primary" disabled={!!busy}>
            ذخیرهٔ تغییرات
          </Button>
        </form>
      </div>
      <div className="panel settings-panel">
        <SectionHeading
          title="قابلیت‌های در دسترس"
          subtitle="هر محدودیت را پیش از تصمیم‌گیری ببینید."
        />
        <div className="capabilities">
          {state.capabilities.map((c) => (
            <div key={c.key}>
              {c.available ? (
                <CircleCheck size={17} className="text-jade" />
              ) : (
                <LockKeyhole size={17} className="text-muted" />
              )}
              <span>
                <strong>{c.label}</strong>
                {!c.available && c.reason && <p>{c.reason}</p>}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
function Toggle({
  checked,
  label,
  description,
  onChange,
  disabled,
}: {
  checked: boolean;
  label: string;
  description: string;
  onChange: () => void;
  disabled: boolean;
}) {
  return (
    <div className="toggle-row">
      <div>
        <strong>{label}</strong>
        <p>{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={onChange}
        className={cn("toggle", checked && "on")}
      >
        <span />
      </button>
    </div>
  );
}
function Chat({ state }: { state: Snapshot }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "instant", block: "nearest" });
  }, [state.messages.length]);
  async function submit(e?: FormEvent, value?: string) {
    e?.preventDefault();
    const message = (value || text).trim();
    if (!message || sending) return;
    setSending(true);
    setError("");
    setText("");
    try {
      await api("/chat", { message });
    } catch (e) {
      setError((e as Error).message);
      setText(message);
    } finally {
      setSending(false);
    }
  }
  return (
    <div className="chat-body">
      <div className="chat-context">
        <span className="status-dot" />
        {state.settings.businessName}
        <span>حافظهٔ گفتگو فعال است</span>
        <Database size={13} />
      </div>
      <div className="chat-messages">
        {state.messages.map((m) => (
          <div className={cn("chat-message", m.role)} key={m.id}>
            {m.role === "assistant" && (
              <span className="message-avatar">
                <AudioLines size={18} />
              </span>
            )}
            <div>
              <div className="message-bubble">{m.content}</div>
              <small>
                {m.role === "assistant"
                  ? m.provider === "cursor"
                    ? "همراه · Cursor"
                    : m.provider === "demo"
                      ? "همراه · پاسخ نمایشی"
                      : "همراه"
                  : "شما"}{" "}
                · {time(m.at)}
              </small>
            </div>
          </div>
        ))}
        {sending && (
          <div className="chat-thinking" role="status">
            <LoaderCircle className="spin" size={16} />
            همراه در حال بررسی است…
          </div>
        )}
        <div ref={end} />
      </div>
      <div className="chat-composer-area">
        {state.messages.length < 5 && (
          <div className="chat-suggestions">
            {[
              "فروشگاهم چه حالیه؟",
              "چه چیزهایی یادت می‌مونه؟",
              "کی به کش نیاز دارم؟",
            ].map((s) => (
              <button
                key={s}
                disabled={sending}
                onClick={() => void submit(undefined, s)}
              >
                {s}
                <ArrowUpLeft size={12} />
              </button>
            ))}
          </div>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <form className="chat-composer" onSubmit={(e) => void submit(e)}>
          <textarea
            aria-label="پیام شما به همراه"
            placeholder="هر چیزی که ذهنتان را مشغول کرده…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={4000}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <button
            type="submit"
            aria-label="ارسال پیام"
            disabled={sending || !text.trim()}
          >
            {sending ? (
              <LoaderCircle size={19} className="spin" />
            ) : (
              <ArrowUpLeft size={21} />
            )}
          </button>
        </form>
        <p className="chat-caption">
          <LockKeyhole size={11} />
          گفتگو و تصمیم‌ها ذخیره می‌شوند ·{" "}
          {state.mode === "demo"
            ? "بدون اتصال به مدل هوش مصنوعی"
            : "مدل ممکن است اشتباه کند؛ شواهد را بررسی کنید."}
        </p>
      </div>
    </div>
  );
}
