import { spawn } from 'node:child_process';
import type { Command } from 'commander';
import { action } from '../command.ts';
import { clearConfig, configPath, saveConfig } from '../config.ts';
import { CliError } from '../errors.ts';
import { readTextArg } from '../input.ts';
import { login } from '../oauth.ts';
import { info } from '../output.ts';
import { RestClient } from '../rest.ts';

function openBrowser(url: string): void {
    const [cmd, args] =
        process.platform === 'darwin'
            ? ['open', [url]]
            : process.platform === 'win32'
              ? ['cmd', ['/c', 'start', '', url]]
              : ['xdg-open', [url]];
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
}

export function mask(secret: string): string {
    return secret.length <= 8 ? '••••' : `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

export function registerAuth(program: Command): void {
    const auth = program.command('auth').description('Log in, inspect and clear credentials');

    auth.command('login')
        .description(
            'Log in with your Perspective account in the browser (OAuth; enables `tools`). ' +
                'With --with-api-key, store an API key instead (enables REST commands).',
        )
        .option('--with-api-key [key]', 'store an API key; omit the value (or pass -) to read it from stdin')
        .option('--no-browser', 'print the login URL instead of opening a browser')
        .action(
            action(async (ctx, opts: { withApiKey?: string | true; browser: boolean }) => {
                const baseUrl = await ctx.baseUrl();
                const config = await ctx.stored();

                if (opts.withApiKey !== undefined) {
                    const raw = opts.withApiKey === true ? '-' : opts.withApiKey;
                    const key = (await readTextArg(raw)).trim();
                    if (!key) throw new CliError('usage', 'Empty API key');
                    // Validate before storing: a cheap authenticated read.
                    await new RestClient(baseUrl, key).request({ path: '/workspaces' });
                    config.apiKey = key;
                    await saveConfig(config, ctx.env);
                    return { ok: true, method: 'api_key', apiKey: mask(key), configPath: configPath(ctx.env) };
                }

                config.oauth = await login({
                    baseUrl,
                    onAuthorizeUrl: (url) => {
                        info(`Open this URL to log in:\n\n  ${url}\n`);
                        if (opts.browser) openBrowser(url);
                        info('Waiting for the browser…');
                    },
                });
                await saveConfig(config, ctx.env);
                return {
                    ok: true,
                    method: 'oauth',
                    expiresAt: config.oauth.expiresAt ? new Date(config.oauth.expiresAt).toISOString() : null,
                    configPath: configPath(ctx.env),
                };
            }),
        );

    auth.command('status')
        .description('Show which credentials are configured and where they come from (no network calls)')
        .action(
            action(async (ctx) => {
                const config = await ctx.stored();
                const keySource = ctx.opts.apiKey
                    ? 'flag'
                    : ctx.env.PERSPECTIVE_API_KEY
                      ? 'env'
                      : config.apiKey
                        ? 'config'
                        : null;
                const key = ctx.opts.apiKey ?? ctx.env.PERSPECTIVE_API_KEY ?? config.apiKey;
                const tokenSource = ctx.opts.token
                    ? 'flag'
                    : ctx.env.PERSPECTIVE_TOKEN
                      ? 'env'
                      : config.oauth
                        ? 'config'
                        : null;
                return {
                    baseUrl: await ctx.baseUrl(),
                    configPath: configPath(ctx.env),
                    rest: { authenticated: Boolean(key), source: keySource, apiKey: key ? mask(key) : null },
                    mcp: {
                        authenticated: Boolean(tokenSource),
                        source: tokenSource,
                        expiresAt:
                            tokenSource === 'config' && config.oauth?.expiresAt
                                ? new Date(config.oauth.expiresAt).toISOString()
                                : null,
                        refreshable: tokenSource === 'config' ? Boolean(config.oauth?.refreshToken) : null,
                    },
                };
            }),
        );

    auth.command('token')
        .description('Print a valid OAuth access token (refreshing it if needed), e.g. for curl')
        .action(action(async (ctx) => ({ accessToken: await ctx.accessToken() })));

    auth.command('logout')
        .description('Delete stored credentials (environment variables are not affected)')
        .action(
            action(async (ctx) => {
                await clearConfig(ctx.env);
                return { ok: true, removed: configPath(ctx.env) };
            }),
        );
}
