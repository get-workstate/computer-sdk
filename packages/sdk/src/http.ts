export class WorkstateError extends Error {
  code: string;
  status?: number;

  constructor(message: string, options: { code: string; status?: number; cause?: unknown }) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "WorkstateError";
    this.code = options.code;
    this.status = options.status;
  }
}

interface ErrorBody {
  error?: string;
  code?: string;
}

export class HttpClient {
  constructor(readonly baseUrl: string) {}

  get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  del<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.baseUrl + path, {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (cause) {
      throw new WorkstateError(`Cannot reach Workstate at ${this.baseUrl}`, {
        code: "server_unreachable",
        cause,
      });
    }

    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        data = { error: text };
      }
    }

    if (!response.ok) {
      const payload = (data ?? {}) as ErrorBody;
      throw new WorkstateError(payload.error || response.statusText || "Request failed", {
        code: payload.code ?? "http_error",
        status: response.status,
      });
    }

    return data as T;
  }
}
