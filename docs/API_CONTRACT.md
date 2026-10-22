# قرارداد اتصال به لیارا

بر مبنای [PaaS OpenAPI](https://github.com/liara-cloud/openapi/blob/main/spec/paas.yaml) و [DBaaS OpenAPI](https://github.com/liara-cloud/openapi/blob/main/spec/dbaas.yaml)، بررسی‌شده در ۲۲ اکتبر ۲۰۲۶.

Base URL ثابت: `https://api.liara.ir`؛ احراز هویت: `Authorization: Bearer <LIARA_API_TOKEN>`.

| کاربرد         | روش و مسیر                                         | وضعیت در MVP                                         |
| -------------- | -------------------------------------------------- | ---------------------------------------------------- |
| فهرست برنامه   | `GET /v1/projects`                                 | پیاده‌سازی؛ شناسهٔ قابل استفاده `project_id`         |
| لاگ برنامه     | `GET /v1/projects/{name}/logs?since=...`           | پیاده‌سازی؛ since به ISO timestamp تبدیل می‌شود      |
| منابع          | `GET /v1/projects/{name}/metrics/summary`          | ابزار خواندنی Cursor                                 |
| ری‌استارت      | `POST /v1/projects/{name}/actions/restart`         | پس از تأیید و allowlist                              |
| دریافت نسخه‌ها | `GET /v1/projects/{name}/releases?page=1&count=20` | نمایش و بررسی currentRelease                         |
| بارگذاری سورس  | `POST /v2/projects/{name}/sources`                 | multipart با فیلد file حاوی tar.gz                   |
| ساخت انتشار    | `POST /v2/projects/{name}/releases`                | body: sourceID, port و type از گزارش پروژهٔ تأییدشده |
| فهرست پشتیبان  | `GET /v1/databases/{id}/backups`                   | نمایش نام، زمان و حجم                                |
| تهیهٔ پشتیبان  | `POST /v1/databases/{id}/backups`                  | تأیید کاربر؛ پذیرش asynchronous اعلام می‌شود         |

`LIARA_TEAM_ID` اختیاری، از طریق `x-team-id` ارسال می‌شود. اگر حساب تیم شما قرارداد header متفاوتی داشته باشد، باید با پاسخ واقعی حساب تأیید شود؛ اتصال تیم بدون کلید تست نشده است.

به پاسخ موفق یا JSON معتبر اعتماد کور نمی‌شود: فهرست برنامه باید projects داشته باشد؛ ارسال سورس باید sourceID و انتشار باید releaseID برگرداند. پاسخ‌های ۴۰۱، ۴۰۳، ۴۰۴، ۴۲۹ یا ۵۰۰ به پیام خطا تبدیل می‌شوند و با دادهٔ demo جایگزین نمی‌شوند. خطاهای کامل بعد از حذف مقادیر حساس محدود می‌شوند. timeout هر درخواست لیارا ۲۰ ثانیه است؛ retry کور روی mutation نداریم.

مسیرهای وجوددار در مستندات، لزوماً ابزار اجرایی MVP نیستند: ساخت برنامه، تغییر پلن و `update-envs` به دلیل نیاز به طراحی قرارداد هزینه و حفظ تنظیمات موجود هنوز بسته‌اند. هیچ endpoint حدسی برای پرداخت، restore، تغییر کد یا خرید یک‌کلیکی استفاده نمی‌شود.

## API داخلی محصول

| مسیر                             | عملکرد                             |
| -------------------------------- | ---------------------------------- |
| `GET /api/state`                 | snapshot وضعیت بدون کلیدها         |
| `GET /api/events`                | SSE با snapshot و heartbeat        |
| `POST /api/check`                | probe تازه بدون تغییر زیرساخت      |
| `POST /api/refresh`              | دریافت دوبارهٔ اطلاعات API         |
| `POST /api/chat`                 | پیام با حافظهٔ پایدار              |
| `POST /api/actions`              | ساخت درخواست تأیید                 |
| `POST /api/actions/:id/decision` | تأیید یا رد با fingerprint         |
| `POST /api/demo/fault`           | فقط demo: pool / persistent / none |
| `PATCH /api/settings`            | نام، پایش، نمایش اعلان             |
| `POST /api/setup/context`        | ثبت نوع کسب‌وکار در حافظه          |
| `GET /api/logs`                  | لاگ محدود و redacted               |
| `GET /api/memory/export`         | گفتگوها و تصمیم‌های قابل مشاهده    |
| `GET /api/audit/export`          | تاریخچه و صحت زنجیرهٔ هش           |

تمام mutationها نیازمند `X-Hamrah-Client: dashboard` هستند. نوع محتوا JSON است به‌جز ZIP. در صورت تنظیم گذرواژه، تمام مسیرها از Basic Auth استفاده می‌کنند.

## دریافت و تحلیل پروژه

- `GET /api/projects/active`: گزارش پروژهٔ اخیر از حافظه، بدون محتوای فایل‌ها یا مقادیر env.
- `POST /api/projects/github`: JSON شامل `url` و در صورت نیاز `ref`, `root`, `traffic` (`low` یا `high`). فقط HTTPS دامنهٔ دقیق github.com؛ resolve به commit و دریافت ZIP از API GitHub/مقصد محدود codeload.github.com. `GITHUB_TOKEN` اختیاری سمت سرور.
- `POST /api/projects/zip?name=project.zip&root=&traffic=low`: بدنهٔ خام `application/zip` تا ۲۰MB. JSON parser این بدنه را مصرف نمی‌کند.
- پاسخ: گزارش شامل id، hash، stack، platform، port، services، envNames، evidence، blockers و warnings. هیچ کد دریافتی در میزبان اجرا نمی‌شود.
- `POST /api/actions`: برای انتشار پروژه `kind=deploy_release`, `target`, `projectId`, `dependenciesReady=true`. هش و تنظیمات انتشار سمت سرور از گزارش گرفته می‌شوند؛ کاربر نمی‌تواند مسیر فایل یا هش دلخواه برای انتشار بدهد.
- تصمیم از همان endpoint قبلی با fingerprint، انقضا و جلوگیری از اجرای دوباره ثبت می‌شود. بستهٔ tar.gz از فایل‌های پاک‌سازی‌شده با نام‌های مشخص ساخته می‌شود؛ هر تغییر محتوای سورس باعث شکست بررسی هش می‌شود. ZIP و گزارش محدودیت‌های روشن دارند؛ ساخت/خرید سرویس جداگانه خودکار نیست.
