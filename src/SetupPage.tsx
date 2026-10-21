import { useState } from "react";
import {
  ArrowLeft,
  Check,
  Cloud,
  Code2,
  Flower2,
  Globe,
  Info,
  Layers,
  Link2,
  LoaderCircle,
  Rocket,
  ShoppingBag,
  ShieldCheck,
  Store,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import type { Snapshot } from "./types";
import { api, cn, fa } from "./lib";
export default function SetupPage({
  state,
  onDeploy,
}: {
  state: Snapshot;
  onDeploy: () => void;
}) {
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState("shop");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const kinds: {
    id: string;
    icon: LucideIcon;
    label: string;
    detail: string;
  }[] = [
    {
      id: "shop",
      icon: ShoppingBag,
      label: "فروشگاه اینترنتی",
      detail: "محصول، مشتری و سفارش",
    },
    {
      id: "company",
      icon: Globe,
      label: "سایت معرفی کسب‌وکار",
      detail: "یک حضور حرفه‌ای در وب",
    },
    {
      id: "app",
      icon: Layers,
      label: "وب‌اپلیکیشن",
      detail: "یک محصول با امکانات اختصاصی",
    },
  ];
  async function next() {
    setError("");
    setSaving(true);
    try {
      await api("/setup/context", { projectType: kind });
      setStep(1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="setup-layout">
      <div className="panel setup-main">
        <div className="wizard-steps">
          {["کسب‌وکار شما", "پیشنهاد همراه", "شروع انتشار"].map((label, i) => (
            <div key={label} className={cn(i <= step && "done")}>
              <span>{i < step ? <Check size={14} /> : fa(i + 1)}</span>
              <strong>{label}</strong>
              {i < 2 && <i />}
            </div>
          ))}
        </div>
        {step === 0 && (
          <div className="wizard-content">
            <span className="eyebrow">اول، کمی از شما بدانم</span>
            <h2>چه چیزی می‌خواهید بسازید؟</h2>
            <p>
              لازم نیست از سرور و منابع بدانید. از نیاز کسب‌وکارتان شروع
              می‌کنیم.
            </p>
            <div className="project-choices">
              {kinds.map(({ id, icon: Icon, label, detail }) => (
                <button
                  key={id}
                  className={cn("project-choice", kind === id && "selected")}
                  onClick={() => setKind(id)}
                  aria-pressed={kind === id}
                >
                  <span className="icon-tile green">
                    <Icon size={23} />
                  </span>
                  <div>
                    <strong>{label}</strong>
                    <small>{detail}</small>
                  </div>
                  <span className="radio-dot">{kind === id && <span />}</span>
                </button>
              ))}
            </div>
            <button
              className="button primary"
              onClick={() => void next()}
              disabled={saving}
            >
              {saving ? <LoaderCircle size={16} /> : <ArrowLeft size={16} />}
              پیشنهاد همراه را ببینید
            </button>
            {error && <p className="inline-error">{error}</p>}
          </div>
        )}
        {step === 1 && (
          <div className="wizard-content">
            <span className="eyebrow">یک شروع کوچک، با جای رشد</span>
            <h2>با ساده‌ترین زیرساخت شروع کنید.</h2>
            <p>
              پیشنهاد اولیه برای {kinds.find((k) => k.id === kind)?.label}{" "}
              کم‌ترافیک است؛ انتخاب نهایی منابع به اجرای واقعی و اندازه‌گیری
              مصرف بستگی دارد.
            </p>
            <div className="recommended-stack">
              <div>
                <span className="icon-tile green">
                  <Globe size={22} />
                </span>
                <div>
                  <strong>برنامهٔ وب</strong>
                  <p>سورس نمونهٔ گل‌بازار، با Docker آمادهٔ انتشار است.</p>
                </div>
                <span className="badge green">ضروری</span>
              </div>
              <div>
                <span className="icon-tile green">
                  <Store size={22} />
                </span>
                <div>
                  <strong>پایگاه داده</strong>
                  <p>
                    برای فروشگاه واقعی، ذخیره‌سازی پایدار و پشتیبان لازم است؛
                    نمونهٔ ابری فعلی حافظهٔ موقت دارد.
                  </p>
                </div>
                <span className="badge amber">پیش از استفادهٔ واقعی</span>
              </div>
              <div>
                <span className="icon-tile gray">
                  <Cloud size={22} />
                </span>
                <div>
                  <strong>کش و سرویس‌های بیشتر</strong>
                  <p>
                    پس از مشاهدهٔ نیاز واقعی اضافه شوند؛ فعلاً لازم نیست هزینهٔ
                    تازه‌ای بسازید.
                  </p>
                </div>
                <span className="badge gray">بعداً</span>
              </div>
            </div>
            <div className="notice-banner">
              <Info size={17} />
              <span>
                پلن و قیمت ساختگی پیشنهاد نمی‌کنیم. انتشار این MVP روی برنامهٔ
                موجود در حساب شما انجام می‌شود؛ ساخت و خرید برنامهٔ جدید از پنل
                لیارا انجام می‌شود.
              </span>
            </div>
            <div className="wizard-buttons">
              <button className="button primary" onClick={() => setStep(2)}>
                ادامه به انتشار
                <ArrowLeft size={16} />
              </button>
              <button className="text-button" onClick={() => setStep(0)}>
                برگشت
              </button>
            </div>
          </div>
        )}
        {step === 2 && (
          <div className="wizard-content">
            <span className="eyebrow">یک قدم تا دیدن نتیجه</span>
            <h2>ایده‌تان را آنلاین کنید.</h2>
            <p>
              پیش از اجرا، مقصد و اثر انتشار را ببینید. پس از تأیید، همراه نتیجه
              را بررسی می‌کند.
            </p>
            <div className="deploy-target">
              <span className="icon-tile large green">
                <Rocket size={31} />
              </span>
              <div>
                <strong>
                  {state.managedAppId || "برنامه هنوز انتخاب نشده"}
                </strong>
                <p>
                  {state.mode === "demo"
                    ? "مسیر انتشار نمایشی · فروشگاه واقعی محلی"
                    : "اتصال واقعی لیارا · جایگزینی نسخهٔ فعلی"}
                </p>
              </div>
              <span className="badge gray">
                {state.mode === "demo" ? "دمو" : "Liara"}
              </span>
            </div>
            <div className="setup-checklist">
              <span>
                <Check size={16} />
                سورس نمونهٔ آماده
              </span>
              <span>
                <ShieldCheck size={16} />
                تأیید پیش از انتشار
              </span>
              <span>
                <Check size={16} />
                بررسی سلامت و مسیر سفارش
              </span>
            </div>
            <button
              className="button primary"
              disabled={!state.connections.writable}
              onClick={onDeploy}
            >
              <Rocket size={17} />
              بررسی و تأیید انتشار
            </button>
            {!state.connections.writable && (
              <p className="inline-error">
                شناسهٔ برنامه و مجوز تغییر را در تنظیمات .env وارد کنید.
              </p>
            )}
            <button
              className="text-button wizard-back"
              onClick={() => setStep(1)}
            >
              برگشت به پیشنهاد
            </button>
          </div>
        )}
      </div>
      <aside className="setup-aside">
        <div className="panel">
          <span className="agent-symbol">
            <Flower2 size={23} />
          </span>
          <h3>قرار نیست متخصص زیرساخت باشید.</h3>
          <p>
            کافی‌ست بگویید چه می‌خواهید بسازید. همراه جزئیات و محدودیت‌ها را
            توضیح می‌دهد و تصمیم‌های مهم را به شما می‌سپارد.
          </p>
          <div className="setup-assurance">
            <ShieldCheck size={17} />
            شما همیشه کنترل را دارید.
          </div>
        </div>
        <div className="panel domain-guide">
          <Link2 size={22} />
          <h3>دامنه هم دارید؟</h3>
          <p>
            برای اتصال دامنه، رکورد DNS لازم را در پنل ثبت‌کننده تنظیم کنید.
            ورود و تغییر در ایرنیک در این MVP دستی است.
          </p>
          <a
            className="text-button"
            href="https://docs.liara.ir/paas/domains/add-domain/"
            target="_blank"
            rel="noreferrer"
          >
            راهنمای رسمی اتصال دامنه
            <ArrowLeft size={13} />
          </a>
        </div>
      </aside>
    </div>
  );
}
