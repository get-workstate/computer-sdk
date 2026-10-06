import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import type { Computer, MouseButton, PageInfo, Screenshot } from "@workstate/sdk";

export const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

async function readDevToolsEndpoint(profileDir: string): Promise<string | null> {
  // Chrome writes "<port>\n<browser path>" once the DevTools HTTP server is listening.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const raw = await readFile(path.join(profileDir, "DevToolsActivePort"), "utf8");
      const [port, browserPath] = raw.trim().split(/\r?\n/);
      if (port && browserPath) return `ws://127.0.0.1:${port}${browserPath}`;
    } catch {
      // Not written yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

export class PlaywrightComputer implements Computer {
  private context: BrowserContext | null = null;
  private browser: Browser | null = null;
  private pageRef: Page | null = null;
  readonly viewport: { width: number; height: number };
  cdpUrl: string | null = null;

  private constructor(viewport?: { width: number; height: number }) {
    this.viewport = viewport ?? DEFAULT_VIEWPORT;
  }

  /** Launch a persistent Chromium profile on this machine. */
  static async launch(options: {
    profileDir: string;
    viewport?: { width: number; height: number };
    headless: boolean;
  }): Promise<PlaywrightComputer> {
    const computer = new PlaywrightComputer(options.viewport);
    const { chromium } = await import("playwright");
    const launchOptions = {
      headless: options.headless,
      viewport: computer.viewport,
      acceptDownloads: true,
      args: ["--disable-dev-shm-usage", "--remote-debugging-port=0", "--remote-allow-origins=*"],
    };
    try {
      computer.context = await chromium.launchPersistentContext(options.profileDir, launchOptions);
    } catch (error) {
      try {
        computer.context = await chromium.launchPersistentContext(options.profileDir, {
          ...launchOptions,
          channel: "chrome",
        });
      } catch {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Could not launch Chromium for this environment. Install it with \`pnpm exec playwright install chromium\`. ${detail}`,
        );
      }
    }
    computer.adoptContext(computer.context);
    await computer.ensurePage();
    computer.cdpUrl = await readDevToolsEndpoint(options.profileDir);
    return computer;
  }

  /** Attach to a browser that already runs somewhere else, over the Chrome DevTools Protocol. */
  static async connect(options: { cdpUrl: string; viewport?: { width: number; height: number } }): Promise<PlaywrightComputer> {
    const computer = new PlaywrightComputer(options.viewport);
    const { chromium } = await import("playwright");
    try {
      computer.browser = await chromium.connectOverCDP(options.cdpUrl, { timeout: 30_000 });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not connect to the remote browser over CDP. ${detail}`);
    }
    const context = computer.browser.contexts()[0] ?? (await computer.browser.newContext({ viewport: computer.viewport }));
    computer.context = context;
    computer.adoptContext(context);
    const page = await computer.ensurePage();
    await page.setViewportSize(computer.viewport).catch(() => undefined);
    computer.cdpUrl = options.cdpUrl;
    return computer;
  }

  private adoptContext(context: BrowserContext): void {
    context.setDefaultTimeout(15_000);
    context.setDefaultNavigationTimeout(30_000);
    this.pageRef = context.pages()[0] ?? null;
    context.on("page", (page) => {
      this.pageRef = page;
    });
  }

  get currentPage(): Page {
    if (!this.pageRef) throw new Error("Browser is not running");
    return this.pageRef;
  }

  private async ensurePage(): Promise<Page> {
    if (this.pageRef) return this.pageRef;
    if (!this.context) throw new Error("Browser is not running");
    this.pageRef = await this.context.newPage();
    return this.pageRef;
  }

  async open(url: string): Promise<PageInfo> {
    const page = await this.ensurePage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    return this.page();
  }

  async screenshot(): Promise<Screenshot> {
    return this.frame();
  }

  async frame(): Promise<Screenshot> {
    const page = await this.ensurePage();
    const buffer = await page.screenshot({ type: "jpeg", quality: 60 });
    return {
      mimeType: "image/jpeg",
      data: buffer.toString("base64"),
      width: this.viewport.width,
      height: this.viewport.height,
    };
  }

  async click(x: number, y: number, button: MouseButton = "left"): Promise<void> {
    await this.currentPage.mouse.click(x, y, { button });
  }

  async doubleClick(x: number, y: number): Promise<void> {
    await this.currentPage.mouse.dblclick(x, y);
  }

  async move(x: number, y: number): Promise<void> {
    await this.currentPage.mouse.move(x, y);
  }

  async type(text: string): Promise<void> {
    await this.currentPage.keyboard.type(text);
  }

  async key(key: string): Promise<void> {
    await this.currentPage.keyboard.press(key);
  }

  async scroll(dx: number, dy: number): Promise<void> {
    await this.currentPage.mouse.wheel(dx, dy);
  }

  async wait(ms: number): Promise<void> {
    await this.currentPage.waitForTimeout(ms);
  }

  async back(): Promise<void> {
    await this.currentPage.goBack({ waitUntil: "domcontentloaded" }).catch(() => undefined);
  }

  async page(): Promise<PageInfo> {
    const page = await this.ensurePage();
    return {
      url: page.url(),
      title: await page.title(),
    };
  }

  async text(): Promise<string> {
    return this.currentPage.locator("body").innerText().catch(() => "");
  }

  async extract(selector: string): Promise<string[]> {
    return this.currentPage.$$eval(selector, (elements) =>
      elements
        .map((element) => {
          if (element instanceof HTMLAnchorElement && element.href) return element.href;
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            if (element.type === "password") return element.value || "[password]";
            return element.value || "";
          }
          return (element.textContent ?? "").replace(/\s+/g, " ").trim();
        })
        .filter((value) => value.length > 0),
    );
  }

  async fill(selector: string, text: string): Promise<void> {
    await this.currentPage.locator(selector).first().fill(text);
  }

  async close(): Promise<void> {
    if (this.browser) {
      // Disconnecting never ends the hosted session; the provider does that.
      await this.browser.close().catch(() => undefined);
    } else {
      await this.context?.close().catch(() => undefined);
    }
    this.browser = null;
    this.context = null;
    this.pageRef = null;
  }
}
