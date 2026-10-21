import http from "node:http";
const orders = [];
http
  .createServer((req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (req.url === "/health") {
      res.end(JSON.stringify({ ok: true, service: "golbazar" }));
      return;
    }
    if (req.url === "/api/checkout/check") {
      res.end(
        JSON.stringify({
          ok: true,
          check: "demo-in-memory-order",
          persistent: false,
        }),
      );
      return;
    }
    if (req.url === "/api/orders" && req.method === "POST") {
      const order = { id: crypto.randomUUID(), at: new Date().toISOString() };
      orders.push(order);
      res.end(JSON.stringify(order));
      return;
    }
    if (req.url === "/") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        '<!doctype html><html lang="fa" dir="rtl"><meta name="viewport" content="width=device-width,initial-scale=1"><title>گل‌بازار | همراه</title><style>body{background:#eef3eb;color:#214b38;font:20px Tahoma;max-width:700px;margin:100px auto;padding:32px}h1{font-size:55px}button{background:#23563e;color:white;border:0;border-radius:12px;padding:18px;font:inherit}</style><small>فروشگاه نمونهٔ همراه · حافظه موقت</small><h1>برای هر حس، یک گل.</h1><p>سورس این فروشگاه با تأیید شما روی لیارا منتشر شده است.</p><p>این نمونه اطلاعات سفارش‌ها را پایدار ذخیره نمی‌کند.</p><button onclick="fetch(\'/api/orders\',{method:\'POST\'}).then(r=>r.json()).then(d=>document.getElementById(\'result\').textContent=\'سفارش آزمایشی ثبت شد: \'+d.id)">ثبت سفارش آزمایشی</button><p id="result" role="status"></p></html>',
      );
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not_found" }));
  })
  .listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
    console.log("Golbazar is ready"),
  );
