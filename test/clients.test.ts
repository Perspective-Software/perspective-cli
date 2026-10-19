import { describe, expect, it } from 'vitest';
import { CliError, ExitCode } from '../src/errors.ts';
import { RestClient } from '../src/rest.ts';

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
        const rest = new RestClient('https://api.example.com', 'k', impl);
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
