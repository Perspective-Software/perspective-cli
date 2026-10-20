import { describe, expect, it } from 'vitest';
import { CliError, ExitCode } from '../src/errors.ts';
import { RestClient, retryDelayMs } from '../src/rest.ts';

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (call: Call) => Response) {
    const calls: Call[] = [];
    const impl = (async (url: string | URL, init: RequestInit = {}) => {
        const call = { url: String(url), init };
        calls.push(call);
        return respond(call);
    }) as typeof fetch;
    return { impl, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('RestClient', () => {
    it('sends the api key header and builds /v1 URLs with query params', async () => {
        const { impl, calls } = fakeFetch(() => json(200, { data: [] }));
        const rest = new RestClient('https://api.example.com', 'k_123', impl);
        await rest.request({ path: '/funnels/f1/contacts', query: { page: 2, limit: undefined } });
        expect(calls[0]!.url).toBe('https://api.example.com/v1/funnels/f1/contacts?page=2');
        expect((calls[0]!.init.headers as Record<string, string>)['x-perspective-api-key']).toBe('k_123');
    });

    it.each([
        [401, 'unauthenticated', ExitCode.UNAUTHENTICATED],
        [403, 'forbidden', ExitCode.FORBIDDEN],
        [404, 'not_found', ExitCode.NOT_FOUND],
        [429, 'rate_limited', ExitCode.RATE_LIMITED],
        [400, 'usage', ExitCode.USAGE],
        [500, 'error', ExitCode.ERROR],
    ])('maps HTTP %i to %s', async (status, code, exit) => {
        const { impl } = fakeFetch(() => json(status, { error: 'boom', status }));
        const rest = new RestClient('https://api.example.com', 'k', impl, { maxRetries: 0 });
        const err = (await rest.request({ path: '/x' }).catch((e: unknown) => e)) as CliError;
        expect(err).toBeInstanceOf(CliError);
        expect(err.code).toBe(code);
        expect(err.exitCode).toBe(exit);
        expect(err.message).toBe('boom');
    });

    it('reports network failures with the network code', async () => {
        const impl = (async () => {
            throw new TypeError('fetch failed');
        }) as typeof fetch;
        const err = (await new RestClient('https://api.example.com', 'k', impl)
            .request({ path: '/x' })
            .catch((e: unknown) => e)) as CliError;
        expect(err.code).toBe('network');
    });
});

describe('RestClient rate limiting', () => {
    it('retries a 429 after the Retry-After delay and returns the next response', async () => {
        let n = 0;
        const { impl, calls } = fakeFetch(() =>
            n++ === 0 ? json(429, { error: 'Too many requests' }, { 'retry-after': '7' }) : json(200, { data: 'ok' }),
        );
        const waits: number[] = [];
        const rest = new RestClient('https://x', 'k', impl, { sleep: async (ms) => void waits.push(ms) });
        expect(await rest.request({ path: '/x' })).toEqual({ data: 'ok' });
        expect(calls).toHaveLength(2);
        expect(waits).toEqual([7000]);
    });

    it('gives up after maxRetries with rate_limited', async () => {
        const { impl, calls } = fakeFetch(() => json(429, { error: 'Too many requests' }));
        const rest = new RestClient('https://x', 'k', impl, { maxRetries: 2, sleep: async () => {} });
        const err = (await rest.request({ path: '/x' }).catch((e: unknown) => e)) as CliError;
        expect(err.code).toBe('rate_limited');
        expect(calls).toHaveLength(3);
    });

    it('backs off exponentially without a header and caps the wait at a minute', () => {
        expect(retryDelayMs(new Response(null, { status: 429 }), 0)).toBe(1000);
        expect(retryDelayMs(new Response(null, { status: 429 }), 2)).toBe(4000);
        expect(retryDelayMs(new Response(null, { status: 429, headers: { 'retry-after': '600' } }), 0)).toBe(60_000);
    });

    it('describes a request without the API key', () => {
        const rest = new RestClient('https://api.example.com', 'secret');
        const described = rest.describe({ method: 'PUT', path: '/funnels/f/contacts/c/values', body: { fieldName: 'status', value: 'won' } });
        expect(described).toEqual({
            method: 'PUT',
            url: 'https://api.example.com/v1/funnels/f/contacts/c/values',
            body: { fieldName: 'status', value: 'won' },
        });
        expect(JSON.stringify(described)).not.toContain('secret');
    });
});

describe('RestClient timeout', () => {
    it('fails with the network code when the API does not answer', async () => {
        const impl = ((_url: string, init: RequestInit) =>
            new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)))) as typeof fetch;
        const err = (await new RestClient('https://x', 'k', impl, { timeoutMs: 20 })
            .request({ path: '/workspaces' })
            .catch((e) => e)) as CliError;
        expect(err.code).toBe('network');
        expect(err.exitCode).toBe(ExitCode.NETWORK);
        expect(err.message).toMatch(/no response within/);
    });
});
