import { CliError, errorCodeForStatus } from './errors.ts';

export type Query = Record<string, string | number | undefined>;

export interface RestRequest {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    query?: Query;
    body?: unknown;
}

const USER_AGENT = 'perspective-cli';

export interface RestClientOptions {
    /** Retries after HTTP 429. The request was not processed, so retrying is safe for writes too. */
    maxRetries?: number;
    sleep?: (ms: number) => Promise<void>;
    /** Per attempt, including reading the body. */
    timeoutMs?: number;
}

const MAX_RETRY_WAIT_MS = 60_000;

/** Waits as long as Retry-After (or RateLimit-Reset) says, else 2^attempt seconds; never more than a minute. */
export function retryDelayMs(res: Response, attempt: number): number {
    const header = res.headers.get('retry-after') ?? res.headers.get('ratelimit-reset');
    const seconds = header !== null && header.trim() !== '' ? Number(header) : NaN;
    const ms = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 2 ** attempt * 1000;
    return Math.min(ms, MAX_RETRY_WAIT_MS);
}

/** Client for the External API under /v1. Returns the parsed JSON body as-is ({data} / {data, meta}). */
export class RestClient {
    readonly baseUrl: string;
    private readonly apiKey: string;
    private readonly fetchImpl: typeof fetch;
    private readonly maxRetries: number;
    private readonly sleep: (ms: number) => Promise<void>;
    private readonly timeoutMs: number;

    constructor(baseUrl: string, apiKey: string, fetchImpl: typeof fetch = fetch, options: RestClientOptions = {}) {
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
        this.fetchImpl = fetchImpl;
        this.maxRetries = options.maxRetries ?? 3;
        this.timeoutMs = options.timeoutMs ?? 30_000;
        this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    }

    url(path: string, query: Query = {}): string {
        const url = new URL(`/v1${path}`, this.baseUrl);
        for (const [key, value] of Object.entries(query)) {
            if (value !== undefined) url.searchParams.set(key, String(value));
        }
        return url.toString();
    }

    /** What `request` would send, without sending it (for --dry-run). The API key is left out. */
    describe({ method = 'GET', path, query, body }: RestRequest): Record<string, unknown> {
        return { method, url: this.url(path, query), ...(body !== undefined && { body }) };
    }

    async request<T = unknown>({ method = 'GET', path, query, body }: RestRequest): Promise<T> {
        let res: Response;
        let text: string;
        for (let attempt = 0; ; attempt++) {
            const signal = AbortSignal.timeout(this.timeoutMs);
            try {
                res = await this.fetchImpl(this.url(path, query), {
                    method,
                    headers: {
                        'x-perspective-api-key': this.apiKey,
                        accept: 'application/json',
                        'user-agent': USER_AGENT,
                        ...(body !== undefined && { 'content-type': 'application/json' }),
                    },
                    body: body === undefined ? undefined : JSON.stringify(body),
                    signal,
                });
                if (res.status !== 429 || attempt >= this.maxRetries) {
                    text = await res.text();
                    break;
                }
            } catch (err) {
                const reason = signal.aborted ? `no response within ${this.timeoutMs / 1000}s` : (err as Error).message;
                throw new CliError('network', `Could not reach ${this.baseUrl}: ${reason}`);
            }
            await res.body?.cancel();
            await this.sleep(retryDelayMs(res, attempt));
        }

        let parsed: unknown = undefined;
        try {
            parsed = text ? JSON.parse(text) : undefined;
        } catch {
            parsed = text;
        }

        if (!res.ok) throw httpError(res, parsed);
        return parsed as T;
    }
}

function httpError(res: Response, body: unknown): CliError {
    const message =
        (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
            ? body.error
            : undefined) ?? `HTTP ${res.status} ${res.statusText}`;
    const code = errorCodeForStatus(res.status);
    const retryAfter = res.headers.get('retry-after') ?? res.headers.get('ratelimit-reset');
    const hint =
        code === 'unauthenticated'
            ? 'Check your API key (`perspective auth status`).'
            : code === 'forbidden'
              ? 'Either the funnel ID is wrong or not in a workspace this key can access (check `perspective funnels list`), ' +
                'or the key lacks the permission this endpoint needs (crm:read, crm:write, metrics:read).'
              : code === 'rate_limited'
                ? `Rate limit is 100 requests/minute, and the CLI already retried.${retryAfter ? ` Retry in ${retryAfter}s.` : ''}`
                : undefined;
    return new CliError(code, message, { status: res.status, hint });
}
