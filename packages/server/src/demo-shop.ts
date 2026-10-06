import { Hono } from "hono";

export const DEMO_EMAIL = "demo@workstate.dev";
export const DEMO_PASSWORD = "workstate";

const INVOICES: Record<string, string> = {
  "INV-1042": `INVOICE INV-1042
Northwind Supply
Bill to: Acme Robotics
Date: 2026-09-12

Description: Workstation fleet support
Amount: $128.00

Status: Paid
`,
  "INV-1033": `INVOICE INV-1033
Northwind Supply
Bill to: Acme Robotics
Date: 2026-08-02

Description: Spare dock kit
Amount: $42.00

Status: Paid
`,
};

function authed(cookieHeader: string | undefined): boolean {
  return (cookieHeader ?? "").split(";").some((part) => part.trim() === "ws_demo=ok");
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Georgia, "Iowan Old Style", serif; background: #e7eef2; color: #10212b; }
    header { background: #163246; color: #f4f7f8; padding: 18px 28px; }
    header strong { font-size: 20px; letter-spacing: 0.01em; }
    header span { display: block; margin-top: 4px; color: #b7c9d4; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13px; }
    main { max-width: 760px; margin: 28px auto; padding: 0 20px 48px; }
    .card { background: white; border: 1px solid #d5e0e6; border-radius: 16px; padding: 22px; }
    h1 { font-size: 28px; margin: 0 0 8px; }
    p { line-height: 1.45; }
    label { display: block; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13px; font-weight: 650; margin: 14px 0 6px; }
    input { width: 100%; height: 44px; border: 1px solid #b7c6cf; border-radius: 10px; padding: 0 12px; font-size: 16px; }
    button { margin-top: 16px; height: 44px; padding: 0 18px; border: 0; border-radius: 999px; background: #0f6e6a; color: white; font-size: 15px; cursor: pointer; }
    .hint { background: #f3f7f4; border-radius: 10px; padding: 10px 12px; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13px; }
    .error { color: #8d1d1d; font-family: ui-sans-serif, system-ui, sans-serif; }
    .order { display: flex; justify-content: space-between; gap: 16px; padding: 14px 0; border-top: 1px solid #e4ebef; font-family: ui-sans-serif, system-ui, sans-serif; }
    a { color: #0f6e6a; }
  </style>
</head>
<body>
  <header>
    <strong>Northwind Supply</strong>
    <span>Billing portal for Acme Robotics</span>
  </header>
  <main>${body}</main>
</body>
</html>`;
}

function loginPage(error?: string): string {
  return page(
    "Sign in · Northwind Supply",
    `<section class="card">
      <h1>Sign in</h1>
      <p>Invoices for the workstation fleet live behind this door.</p>
      ${error ? `<p class="error">${error}</p>` : ""}
      <p class="hint">Demo access: <strong>${DEMO_EMAIL}</strong> / <strong>${DEMO_PASSWORD}</strong></p>
      <form method="post" action="/demo/shop/login">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="username" value="${DEMO_EMAIL}" />
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" />
        <button type="submit">Sign in</button>
      </form>
    </section>`,
  );
}

function ordersPage(): string {
  return page(
    "Orders · Northwind Supply",
    `<section class="card">
      <h1>Orders</h1>
      <p>The latest invoice is ready to download.</p>
      <article data-latest-order>
        <div class="order">
          <div>
            <strong>Latest order</strong>
            <div>Order <span data-order-id>INV-1042</span></div>
            <div>Total <span data-order-total>$128.00</span></div>
          </div>
          <div><a data-invoice href="/demo/shop/invoices/INV-1042">Download invoice</a></div>
        </div>
      </article>
      <div class="order">
        <div>
          <strong>Previous</strong>
          <div>INV-1033 · spare dock kit</div>
        </div>
        <div>$42.00</div>
      </div>
    </section>`,
  );
}

export function demoShopApp(): Hono {
  const app = new Hono({ strict: false });

  app.get("/shop", (c) => {
    if (authed(c.req.header("cookie"))) return c.redirect("/demo/shop/orders");
    return c.html(loginPage());
  });

  app.get("/shop/orders", (c) => {
    if (!authed(c.req.header("cookie"))) return c.redirect("/demo/shop");
    return c.html(ordersPage());
  });

  app.post("/shop/login", async (c) => {
    const body = await c.req.parseBody();
    const email = String(body.email ?? "");
    const password = String(body.password ?? "");
    if (email !== DEMO_EMAIL || password !== DEMO_PASSWORD) {
      return c.html(loginPage("Those credentials don't match the demo shop."), 401);
    }
    c.header("set-cookie", "ws_demo=ok; Path=/; HttpOnly; SameSite=Lax");
    return c.redirect("/demo/shop/orders");
  });

  app.get("/shop/invoices/:id", (c) => {
    if (!authed(c.req.header("cookie"))) return c.redirect("/demo/shop");
    const invoice = INVOICES[c.req.param("id")];
    if (!invoice) return c.text("No invoice with that id.\n", 404);
    return c.text(invoice);
  });

  return app;
}
