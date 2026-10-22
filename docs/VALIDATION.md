# گزارش بررسی — ۲۲ اکتبر ۲۰۲۶

## آخرین آزمون سرتاسری مراقبت با Liara و Cursor واقعی

**۸۷ از ۸۷ تست موفق، صفر شکست؛ ساخت TypeScript و Vite موفق.** [گزارش HTML به‌روز](reports/care/report.html) و [شواهد واقعی](reports/care/live/evidence.json).

در اجرای تازه از ۱۸:۵۸ تا ۱۹:۳۹ UTC، برنامه و PostgreSQL خصوصی ساخته شدند؛ سفارش واقعی آزمایشی ثبت شد. سه شکست مستقل رخداد ساختند. Cursor واقعی ابتدا بدون شواهد کافی اقدام نساخت؛ با ابزار سورس محدود و کنترل هش، تشخیص را کامل کرد. تأیید دستکاری‌شده رد و ری‌استارت پس از تأیید صحیح اجرا شد؛ سفارش باقی ماند و دو بررسی موفق رخداد را بستند. نسخهٔ دوم روی همان برنامه منتشر شد؛ بکاپ و دو بازیابی سفارش‌ها را به ترتیب ۲←۱←۲ کردند. شناسه‌های سفارش‌ها و نشان نسخهٔ دوم مستقل از پاسخ مدل بررسی شدند.

برنامه و دیتابیس تست حذف شدند. بررسی دوم API در **۱۹:۴۰:۵۹ UTC** فهرست خالی برنامه و دیتابیس را تأیید کرد؛ پایش و زمان‌بندی همراه خاموش‌اند. فقط شبکهٔ خالی از قبل موجود دست‌نخورده باقی ماند. موجودی مشاهده‌شده ۱٬۹۹۷٬۷۰۸٫۴ تومان بود؛ اختلاف با پیش از این اجرا ۱٬۱۴۵٫۸ تومان است و تسویهٔ با تأخیر ممکن است. این نوبت دامنهٔ شخصی، پرداخت و آزمون بار طولانی را پوشش نمی‌دهد. بازیابی، مخصوص سفارش‌های نمونه و پشتیبان رمز‌شده روی دستگاه اجرای همراه است.

مطالب پایین سوابق اجراهای پیشین‌اند؛ موجودی، تعداد تست‌ها و منابعِ همان زمان را توصیف می‌کنند.

## آزمون واقعی گل‌بازار روی لیارا

گزارش تفصیلی این نوبت در [گزارش HTML](reports/live-test/report.html) و [شواهد JSON](reports/live-test/evidence.json) است. برنامه و PostgreSQL خصوصی واقعاً در تیم لیارا ایجاد شدند و سورس بررسی‌شده توسط Cursor به نسخهٔ READY رسید. سلامت، تراکنش نوشتن/خواندن/rollback، سفارش پایدار، کشف خودکار سه شکست و تأیید بهبود پس از رفع اختلال بررسی شدند. در میانهٔ کار DNS مرجع لیارا پاسخ نداد؛ وضعیت ری‌استارت و پاک‌سازی را فقط از گزارش تازه بخوانید، نه نتیجه‌های بررسی قدیمی پایین.

آخرین اجرای کامل این نوبت: **۵۶ تست موفق، صفر شکست**. آزمون‌های HTTP به‌صورت سری اجرا شدند تا فشار حافظهٔ میزبان روی زمان راه‌اندازی child تأثیر نگذارد. حساب تیمی از پارامتر رسمی `teamID` استفاده می‌کند؛ هدر `x-team-id` معتبر نبود. آپلود gzip با MIME صحیح و لاگ‌های جدید v2 بررسی و اصلاح شدند.

ری‌استارت واقعی با action تأییدشده اجرا شد؛ زمان شروع پردازه تغییر کرد و سفارش قبلی در PostgreSQL باقی ماند. برنامه و دیتابیس پس از تست حذف و نبودشان در فهرست API تأیید شد. موجودی مالی snapshot پس از حذف ۱٬۹۹۸٬۸۵۴٫۲ تومان بود (اختلاف حدود ۱٬۱۴۶ تومان با اعتبار اولیه). دو شبکهٔ خصوصی خالی در حساب شخصی/تیم باقی‌اند؛ مسیر حذف آن‌ها در API بررسی‌شده یافت نشد. هیچ منبع برنامه یا دیتابیس در تیم باقی نماند.

در میانهٔ تست، Google و Cloudflare برای `api.liara.ir` پاسخ SERVFAIL دادند. resolver ایرانی توانست نام را حل کند؛ transport محدود به API لیارا فقط در خطای قطعی lookup از این fallback استفاده می‌کند. هیچ گواهی‌ای نادیده گرفته نمی‌شود، DNS سیستم تغییر نمی‌کند و timeout/reset با نتیجهٔ نامشخص برای mutation تکرار نمی‌شود.

## سوابق بررسی پیش از اتصال واقعی

## موارد بررسی‌شده

- نصب وابستگی‌ها و import بستهٔ رسمی Cursor SDK روی Node.js 22.14 ویندوز.
- TypeScript در حالت strict.
- build واقعی Vite؛ کد نمودارها در chunk جدا و بدون هشدار اندازهٔ chunk.
- آزمون‌های خودکار منطق ایجنت، پشتیبان، حافظه، API adapter و مرز HTTP.
- مسیر UI: خرابی فروشگاه، تشخیص مستقل، بررسی شواهد، تأیید، ری‌استارت، verification و بسته‌شدن رخداد.
- مسیر UI: ثبت سفارش موفق و خطای واقعی ثبت سفارش در خرابی.
- مسیر UI: پشتیبان‌گیری با تأیید از موبایل، گفتگو و ثبت پیام در حافظه، انتشار نمایشی و تاریخچهٔ آن، راه‌اندازی آسان.
- بررسی رابط در عرض‌های ۳۹۰، ۷۶۸ و ۱۴۴۰ پیکسل. عرض document در اندازه‌های بررسی‌شده از viewport بیشتر نبود.
- منوی موبایل و پنجره‌های تأیید با primitiveهای Radix و مدیریت فوکوس.
- حالت کاهش حرکت، فونت محلی، focus-visible، عنوان و برچسب کنترل‌ها و نداشتن zoom lock.
- کنسول مرورگر در بررسی انجام‌شده خطای JavaScript یا هشدار ثبت‌شده نداشت.
- تصویر شاخص از حدود ۲٫۲۵ MB به WebP حدود ۱۶۲ KB تبدیل شده است.

## آزمون‌ها

آخرین اجرای کامل: **۴۷ آزمون موفق، صفر شکست**. `npm run build` و TypeScript strict نیز موفق بودند.

آزمون‌های خودکار مسیر سلامت، کشف مستقل، dedup رخداد، قفل تأیید تکراری، fingerprint، verification موفق و ناموفق، اصلاح بیرونی، پشتیبان/بازیابی، انقضا و رد، حافظه و عملیات نیمه‌تمام، audit، redaction، قرارداد HTTP لیارا، state transition، بسته‌بودن قابلیت‌های پشتیبانی‌نشده، JSON بررسی کسب‌وکار، Basic Auth، Origin/client header، ورودی نامعتبر و عدم افشای کلیدها را پوشش می‌دهند؛ همچنین تحلیل ZIP واقعی، حذف اسرار، تشخیص وابستگی، رد مسیر ناامن/ZIP بزرگ، انتخاب زیرپروژه، جلوگیری از انتشار سورس تغییرکرده، اجرای یک‌باره و بررسی مسیر انتشار زنده با adapter شبیه‌سازی‌شده.

برای جریان ساخت جدید، کاتالوگ واقعی‌نما با قرارداد CLI، جمع قیمت منابع و امکانات، تغییر قیمت بعد از پیشنهاد، تغییر سورس، انقضا، دستکاری پیشنهاد، تأیید تکراری و تعویض حساب تست شده‌اند. مسیر موفق شامل ساخت برنامه و دیتابیس خصوصی، حفظ env موجود، URL-encoding رمز، بارگذاری بسته و فعال‌شدن همان release و دو بررسی موفق است. قطع/خطای میانهٔ عملیات منابع قبلی را حفظ می‌کند و ساخت یا حذف تکراری ندارد. نبود endpoint کسب‌وکار وضعیت needs_verification می‌سازد. تست Vault، ciphertext ماندگار و تشخیص دستکاری GCM، ذخیره/تعویض کلید، SSE هنگام تعویض حالت، جداسازی حافظهٔ demo/live، عدم افشای کلیدها، مسدودکردن Host خارجی در حالت loopback و endpointهای ثابت تست اتصال نیز وجود دارند.

در مرورگر، دریافت مخزن عمومی `mdn/beginner-html-site-styled` به commit مشخص، تشخیص سایت استاتیک و دریافت ZIP نمونهٔ Node.js با PostgreSQL و Redis انجام شد. ورودی ZIP، نمایش نام envها، الزام چک‌لیست تنظیمات، مودال تأیید و نتیجهٔ صحیح «پیش‌نمایش؛ بدون اجرای ابری» بررسی شدند. نمای ۳۹۰ پیکسلی اسکرول افقی نداشت و خطای console دیده نشد. تصاویر این جریان در `docs/screenshots/10-project-analysis.png` و `11-project-analysis-mobile.png` ذخیره شدند.

جریان جدید نیز در مرورگر از فرم ساخت برنامه/PostgreSQL/Redis تا اتصال خودکار متغیرها، صفحهٔ هزینه و تأیید و نتیجهٔ ماندگار اجرا شد. نسخهٔ یکپارچه روی پورت ۳۰۰۱ بررسی شد؛ پورت ۵۱۷۳ دستگاه با سرویس پروژهٔ دیگری تداخل داشت. نمای ۳۹۰ پیکسلی فرم و صفحهٔ تأیید اسکرول افقی نداشت و کنسول خطا نداشت. تصاویر `12-provision-mobile.png`، `13-provision-approval.png` و `14-provision-result.png` در پوشهٔ screenshots ذخیره شدند. قیمت و ساخت منابع این مرور کاملاً دمو بود؛ صورتحساب واقعی ایجاد نشد.

خروجی نهایی `npm test` و `npm run build` پیش از تحویل بررسی می‌شود. تست‌ها با کلید یا حساب واقعی کار نمی‌کنند و منابع ابری نمی‌سازند.

## مرزهای بررسی

- ساخت منابع پولی و استقرار زنده با حساب کاربر در این بررسی اجرا نشد؛ تست این مسیر با provider شبیه‌سازی‌شده انجام شد. نتیجهٔ تست خواندنی اتصال، جای تست ساخت/انتشار واقعی نیست.
- Docker CLI نصب بود اما daemon در حال اجرا نبود؛ تصویر container ساخته/اجرا نشده است. اجرای معمول Node به‌طور واقعی بررسی شده است.
- بررسی موبایل با viewport مرورگر انجام شده، نه دستگاه فیزیکی.
- ادعای انطباق کامل WCAG یا ممیزی امنیت مستقل وجود ندارد.
- ویدئوی خروجی، مرور تصویری بی‌صدا از تصاویر واقعی همین اجرای محلی است.

### Cleanup recheck — 2026-10-22 14:30–14:31 UTC

- Re-read personal account and Liara team inventories: zero apps, zero databases in both scopes.
- Both test networks have projectCount=0 and databaseCount=0. Guarded DELETE /v1/networks/{id} returned HTTP 404 in both scopes; subsequent GET confirms they remain. No supported network deletion capability was found in official docs, CLI or the public console bundle.
- Team balance remains 1,998,854.2 Toman, unchanged since 13:55:48 UTC (about 35 minutes). This is an observation, not a final billing settlement or a guarantee about network pricing.
- No storage, email, Redis or VM service was created during the test. Unrelated teams were not modified.
- Sanitized inventory and deletion receipts are included in docs/reports/live-test/evidence.json under cleanupRecheck.

### Liara DNS workflow — 2026-10-22

- Full current suite: 72 passed, 0 failed with test-concurrency=1. Includes 16 domain tests (two-stage approval, real NS gating, Liara DNS payloads, apex ALIAS coexistence with NS/SOA/MX/TXT, encrypted optional Cloudflare credentials, drift, crash recovery, uncertain SSL writes, stale TLS checks, expired permissions and demo registrar handoff).
- Initial parallel suite on the memory-constrained host failed startup hooks (39 pass / 25 fail); the sequential suite passed. This was not suppressed or counted as success.
- Production build passed. Responsive browser workflow tested on isolated demo data; no custom-domain live mutation or SSL issuance claimed.
- Real Liara DNS GET /zones returned HTTP 200, zero zones in selected team. No zone or paid resource was created for this implementation.
- Detailed scope and API provenance: DOMAINS.md. Domain report: reports/domains/report.html.
