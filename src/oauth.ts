import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CliError } from './errors.ts';
import type { StoredOAuth } from './config.ts';

/**
 * OAuth 2.1 authorization-code flow with PKCE against the External API's
 * OAuth proxy (/oauth/register, /oauth/authorize, /oauth/token), which
 * fronts Auth0. The redirect goes to a one-shot loopback server
 * (RFC 8252); the proxy allowlists http://127.0.0.1 for exactly this.
 */

const SCOPE = 'openid offline_access';
const CALLBACK_PATH = '/callback';
const LOGIN_TIMEOUT_MS = 5 * 60_000;
/** Refresh this long before the token actually expires. */
const EXPIRY_SKEW_MS = 60_000;

export function base64url(buf: Buffer): string {
    return buf.toString('base64url');
}

export function createPkcePair(): { verifier: string; challenge: string } {
    const verifier = base64url(randomBytes(32));
    const challenge = base64url(createHash('sha256').update(verifier).digest());
    return { verifier, challenge };
}

interface TokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
}

function toStored(token: TokenResponse, clientId: string, previous?: StoredOAuth): StoredOAuth {
    return {
        accessToken: token.access_token,
        // Auth0 only rotates the refresh token when rotation is enabled; keep the old one otherwise.
        refreshToken: token.refresh_token ?? previous?.refreshToken,
        expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
        clientId,
    };
}

async function postToken(baseUrl: string, params: Record<string, string>): Promise<TokenResponse> {
    let res: Response;
    try {
        res = await fetch(`${baseUrl}/oauth/token`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(params).toString(),
        });
    } catch (err) {
        throw new CliError('network', `Could not reach ${baseUrl}: ${(err as Error).message}`);
    }
    const body = (await res.json().catch(() => ({}))) as TokenResponse & {
        error?: string;
        error_description?: string;
    };
    if (!res.ok || !body.access_token) {
        throw new CliError(
            'unauthenticated',
            `Token request failed: ${body.error_description ?? body.error ?? res.statusText}`,
            { status: res.status, hint: 'Run `perspective auth login` again.' },
        );
    }
    return body;
}

async function registerClient(baseUrl: string, redirectUri: string): Promise<string> {
    const res = await fetch(`${baseUrl}/oauth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ redirect_uris: [redirectUri], client_name: 'Perspective CLI' }),
    });
    const body = (await res.json().catch(() => ({}))) as { client_id?: string; error?: string };
    if (!res.ok || !body.client_id) {
        throw new CliError('error', `Client registration failed: ${body.error ?? res.statusText}`, {
            status: res.status,
        });
    }
    return body.client_id;
}

function listen(server: Server): Promise<number> {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
    });
}

const PAGE = (title: string, body: string) =>
    `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
    `<body style="font-family:system-ui;max-width:32rem;margin:4rem auto">` +
    `<h1>${title}</h1><p>${body}</p></body>`;

export interface LoginOptions {
    baseUrl: string;
    /** Called with the authorize URL; opens a browser or prints it. */
    onAuthorizeUrl: (url: string) => void | Promise<void>;
}

export async function login({ baseUrl, onAuthorizeUrl }: LoginOptions): Promise<StoredOAuth> {
    const state = base64url(randomBytes(16));
    const { verifier, challenge } = createPkcePair();

    let settle!: { resolve: (code: string) => void; reject: (err: Error) => void };
    const codePromise = new Promise<string>((resolve, reject) => {
        settle = { resolve, reject };
    });
    // A callback can fail before we await the promise; don't let that become an unhandled rejection.
    codePromise.catch(() => {});

    const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (url.pathname !== CALLBACK_PATH) {
            res.writeHead(404).end();
            return;
        }
        const error = url.searchParams.get('error');
        const code = url.searchParams.get('code');
        res.setHeader('content-type', 'text/html; charset=utf-8');
        if (url.searchParams.get('state') !== state) {
            res.writeHead(400).end(PAGE('Login failed', 'State mismatch. Close this tab and retry.'));
            settle.reject(new CliError('unauthenticated', 'OAuth state mismatch'));
        } else if (error || !code) {
            const description = url.searchParams.get('error_description') ?? error ?? 'no code';
            res.writeHead(400).end(PAGE('Login failed', 'You can close this tab.'));
            settle.reject(new CliError('unauthenticated', `Authorization failed: ${description}`));
        } else {
            res.writeHead(200).end(
                PAGE('Logged in to Perspective', 'You can close this tab and return to the terminal.'),
            );
            settle.resolve(code);
        }
    });

    const port = await listen(server);
    const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
    const timer = setTimeout(
        () => settle.reject(new CliError('unauthenticated', 'Timed out waiting for browser login')),
        LOGIN_TIMEOUT_MS,
    );

    try {
        const clientId = await registerClient(baseUrl, redirectUri);
        const authorize = new URL(`${baseUrl}/oauth/authorize`);
        authorize.search = new URLSearchParams({
            response_type: 'code',
            client_id: clientId,
            redirect_uri: redirectUri,
            scope: SCOPE,
            state,
            code_challenge: challenge,
            code_challenge_method: 'S256',
        }).toString();
        await onAuthorizeUrl(authorize.toString());

        const code = await codePromise;
        const token = await postToken(baseUrl, {
            grant_type: 'authorization_code',
            code,
            code_verifier: verifier,
            client_id: clientId,
            redirect_uri: redirectUri,
        });
        return toStored(token, clientId);
    } finally {
        clearTimeout(timer);
        server.close();
    }
}

export function isExpired(oauth: StoredOAuth, now = Date.now()): boolean {
    return oauth.expiresAt !== undefined && oauth.expiresAt - EXPIRY_SKEW_MS <= now;
}

export async function refresh(baseUrl: string, oauth: StoredOAuth): Promise<StoredOAuth> {
    if (!oauth.refreshToken) {
        throw new CliError('unauthenticated', 'Session expired', {
            hint: 'Run `perspective auth login` again.',
        });
    }
    const token = await postToken(baseUrl, {
        grant_type: 'refresh_token',
        refresh_token: oauth.refreshToken,
        client_id: oauth.clientId,
    });
    return toStored(token, oauth.clientId, oauth);
}
