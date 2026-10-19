import { describe, expect, it } from 'vitest';
import { CliError, ExitCode } from '../src/errors.ts';
import { McpClient, parseSse, unwrapToolResult } from '../src/mcp.ts';
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

describe('parseSse', () => {
    it('finds the response with the matching id', () => {
        const body = 'event: message\ndata: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}\n\n';
        expect(parseSse(body, 7)?.result).toEqual({ ok: true });
        expect(parseSse(body, 8)).toBeUndefined();
    });
});

describe('McpClient', () => {
    it('posts JSON-RPC to the scoped endpoint with a bearer token and parses SSE replies', async () => {
        const { impl, calls } = fakeFetch(({ init }) => {
            const { id } = JSON.parse(String(init.body)) as { id: number };
            return new Response(
                `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result: { tools: [{ name: 'list_brands' }] } })}\n\n`,
                { status: 200, headers: { 'content-type': 'text/event-stream' } },
            );
        });
        const mcp = new McpClient('https://api.example.com', 'tok', 'crm', impl);
        expect(await mcp.listTools()).toEqual([{ name: 'list_brands' }]);
        expect(calls[0]!.url).toBe('https://api.example.com/mcp/crm');
        expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer tok');
        expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ method: 'tools/list' });
    });

    it('follows tools/list pagination', async () => {
        const { impl } = fakeFetch(({ init }) => {
            const { id, params } = JSON.parse(String(init.body)) as { id: number; params?: { cursor?: string } };
            const result = params?.cursor
                ? { tools: [{ name: 'b' }] }
                : { tools: [{ name: 'a' }], nextCursor: 'c1' };
            return json(200, { jsonrpc: '2.0', id, result });
        });
        const tools = await new McpClient('https://x', 't', 'all', impl).listTools();
        expect(tools.map((t) => t.name)).toEqual(['a', 'b']);
    });

    it('surfaces JSON-RPC errors', async () => {
        const { impl } = fakeFetch(({ init }) => {
            const { id } = JSON.parse(String(init.body)) as { id: number };
            return json(200, { jsonrpc: '2.0', id, error: { code: -32602, message: 'Invalid params' } });
        });
        const err = (await new McpClient('https://x', 't', 'all', impl)
            .callTool('x', {})
            .catch((e: unknown) => e)) as CliError;
        expect(err.code).toBe('usage');
        expect(err.message).toBe('Invalid params');
    });

    it('maps a 401 with an OAuth error body to unauthenticated', async () => {
        const { impl } = fakeFetch(() => json(401, { error: 'unauthorized', error_description: 'Invalid token' }));
        const err = (await new McpClient('https://x', 't', 'all', impl).listTools().catch((e: unknown) => e)) as CliError;
        expect(err.code).toBe('unauthenticated');
        expect(err.message).toBe('Invalid token');
    });
});

describe('unwrapToolResult', () => {
    it('prefers structured content', () => {
        expect(unwrapToolResult({ structuredContent: { a: 1 }, content: [{ type: 'text', text: 'x' }] })).toEqual({ a: 1 });
    });
    it('parses a single JSON text part', () => {
        expect(unwrapToolResult({ content: [{ type: 'text', text: '{"id":"f1"}' }] })).toEqual({ id: 'f1' });
    });
    it('keeps non-JSON text and returns arrays for multiple parts', () => {
        expect(
            unwrapToolResult({
                content: [
                    { type: 'text', text: 'hello' },
                    { type: 'text', text: '[1]' },
                ],
            }),
        ).toEqual(['hello', [1]]);
    });
});
