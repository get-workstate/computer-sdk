import type { BrowserContext, Page } from "playwright";
import type { Computer, MouseButton, PageInfo, Screenshot } from "@workstate/sdk";

export const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

export class PlaywrightComputer implements Computer {
  private context: BrowserContext | null = null;
  private pageRef: Page | null = null;
  readonly viewport: { width: number; height: number };

  private constructor(viewport?: { width: number; height: number }) {
    this.viewport = viewport ?? DEFAULT_VIEWPORT;
  }

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
      args: ["--disable-dev-shm-usage"],
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
    computer.context.setDefaultTimeout(15_000);
    computer.context.setDefaultNavigationTimeout(30_000);
    computer.pageRef = computer.context.pages()[0] ?? (await computer.context.newPage());
    computer.context.on("page", (page) => {
      computer.pageRef = page;
    });
    return computer;
  }

  get currentPage(): Page {
    if (!this.pageRef) throw new Error("Browser is not running");
    return this.pageRef;
  }

  async open(url: string): Promise<PageInfo> {
    await this.currentPage.goto(url, { waitUntil: "domcontentloaded" });
    return this.page();
  }

  async screenshot(): Promise<Screenshot> {
    return this.frame();
  }

  async frame(): Promise<Screenshot> {
    const buffer = await this.currentPage.screenshot({ type: "jpeg", quality: 60 });
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
    return {
      url: this.currentPage.url(),
      title: await this.currentPage.title(),
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

  async close(): Promise<void> {
    await this.context?.close();
    this.context = null;
    this.pageRef = null;
  }
}
