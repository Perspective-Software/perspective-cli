import { CliError, errorCodeForStatus } from './errors.ts';

/**
 * Minimal MCP client for the hosted Perspective server.
 *
 * The server runs the Streamable HTTP transport in stateless mode (no session
 * id, a fresh server per POST), so every JSON-RPC call is one independent
 * POST and no `initialize` handshake is needed. Replies arrive either as a
 * JSON body or as a single-message SSE stream; both are handled.
 */

export const MCP_SCOPES = ['all', 'funnel-build', 'sequences', 'analytics', 'crm'] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

const PROTOCOL_VERSION = '2025-06-18';

export interface McpTool {
    name: string;
    title?: string;
    description?: string;
    inputSchema?: unknown;
    annotations?: Record<string, unknown>;
}

export interface McpContent {
    type: string;
    text?: string;
    [key: string]: unknown;
}

export interface McpCallResult {
    content?: McpContent[];
    structuredContent?: unknown;
    isError?: boolean;
}

interface JsonRpcResponse<T> {
    jsonrpc: '2.0';
    id?: number | string | null;
    result?: T;
    error?: { code: number; message: string; data?: unknown };
}

export function isMcpScope(value: string): value is McpScope {
    return (MCP_SCOPES as readonly string[]).includes(value);
}

/** Extracts the JSON-RPC response from an SSE body (`event: message\ndata: {...}`). */
export function parseSse<T>(body: string, id: number): JsonRpcResponse<T> | undefined {
    for (const event of body.split(/\r?\n\r?\n/)) {
        const data = event
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
        if (!data) continue;
        const message = JSON.parse(data) as JsonRpcResponse<T>;
        if (message.id === id) return message;
    }
    return undefined;
}

export class McpClient {
    private readonly endpoint: string;
    private readonly token: string;
    private readonly fetchImpl: typeof fetch;
    private nextId = 1;

    constructor(baseUrl: string, token: string, scope: McpScope = 'all', fetchImpl: typeof fetch = fetch) {
        this.endpoint = scope === 'all' ? `${baseUrl}/mcp` : `${baseUrl}/mcp/${scope}`;
        this.token = token;
        this.fetchImpl = fetchImpl;
    }

    async rpc<T>(method: string, params?: Record<string, unknown>): Promise<T> {
        const id = this.nextId++;
        let res: Response;
        try {
            res = await this.fetchImpl(this.endpoint, {
                method: 'POST',
                headers: {
                    authorization: `Bearer ${this.token}`,
                    'content-type': 'application/json',
                    accept: 'application/json, text/event-stream',
                    'mcp-protocol-version': PROTOCOL_VERSION,
                    'user-agent': 'perspective-cli',
                },
                body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params && { params }) }),
            });
        } catch (err) {
            throw new CliError('network', `Could not reach ${this.endpoint}: ${(err as Error).message}`);
        }

        const text = await res.text();
        if (!res.ok) {
            let message = `HTTP ${res.status} ${res.statusText}`;
            try {
                const body = JSON.parse(text) as { error_description?: string; message?: string; error?: unknown };
                message = body.error_description ?? body.message ?? (typeof body.error === 'string' ? body.error : message);
            } catch {
                // keep the status line
            }
            const code = errorCodeForStatus(res.status);
            throw new CliError(code, message, {
                status: res.status,
                hint: code === 'unauthenticated' ? 'Run `perspective auth login`.' : undefined,
            });
        }

        const contentType = res.headers.get('content-type') ?? '';
        const message = contentType.includes('text/event-stream')
            ? parseSse<T>(text, id)
            : (JSON.parse(text) as JsonRpcResponse<T>);

        if (!message) throw new CliError('error', `No response to ${method} from the MCP server`);
        if (message.error) {
            throw new CliError(message.error.code === -32602 ? 'usage' : 'error', message.error.message, {
                details: message.error.data,
            });
        }
        return message.result as T;
    }

    async listTools(): Promise<McpTool[]> {
        const tools: McpTool[] = [];
        let cursor: string | undefined;
        do {
            const page = await this.rpc<{ tools: McpTool[]; nextCursor?: string }>(
                'tools/list',
                cursor ? { cursor } : undefined,
            );
            tools.push(...page.tools);
            cursor = page.nextCursor;
        } while (cursor);
        return tools;
    }

    callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
        return this.rpc<McpCallResult>('tools/call', { name, arguments: args });
    }
}

/**
 * Reduces a tool result to the most useful JSON value: structured content if
 * the tool returned it, otherwise the text parts — each parsed as JSON when
 * it is JSON. Non-text parts (images, resources) are passed through.
 */
export function unwrapToolResult(result: McpCallResult): unknown {
    if (result.structuredContent !== undefined) return result.structuredContent;
    const parts = (result.content ?? []).map((part) => {
        if (part.type !== 'text' || part.text === undefined) return part;
        try {
            return JSON.parse(part.text) as unknown;
        } catch {
            return part.text;
        }
    });
    return parts.length === 1 ? parts[0] : parts;
}
