import { CliError, errorCodeForStatus } from './errors.ts';

export type Query = Record<string, string | number | undefined>;

export interface RestRequest {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    query?: Query;
    body?: unknown;
}

const USER_AGENT = 'perspective-cli';

/** Client for the External API under /v1. Returns the parsed JSON body as-is ({data} / {data, meta}). */
export class RestClient {
    readonly baseUrl: string;
    private readonly apiKey: string;
    private readonly fetchImpl: typeof fetch;

    constructor(baseUrl: string, apiKey: string, fetchImpl: typeof fetch = fetch) {
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
        this.fetchImpl = fetchImpl;
    }

    url(path: string, query: Query = {}): string {
        const url = new URL(`/v1${path}`, this.baseUrl);
        for (const [key, value] of Object.entries(query)) {
            if (value !== undefined) url.searchParams.set(key, String(value));
        }
        return url.toString();
    }

    async request<T = unknown>({ method = 'GET', path, query, body }: RestRequest): Promise<T> {
        let res: Response;
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
            });
        } catch (err) {
            throw new CliError('network', `Could not reach ${this.baseUrl}: ${(err as Error).message}`);
        }

        const text = await res.text();
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
              ? 'The API key lacks the permission this endpoint needs (e.g. crm:read, metrics:read).'
              : code === 'rate_limited'
                ? `Rate limit is 100 requests/minute.${retryAfter ? ` Retry in ${retryAfter}s.` : ''}`
                : undefined;
    return new CliError(code, message, { status: res.status, hint });
}
