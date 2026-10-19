import type { Command } from 'commander';
import { action } from '../command.ts';
import { clearConfig, configPath, saveConfig } from '../config.ts';
import { CliError } from '../errors.ts';
import { readTextArg } from '../input.ts';
import { RestClient } from '../rest.ts';

export function mask(secret: string): string {
    return secret.length <= 8 ? '••••' : `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

/**
 * Prompts on stderr without echoing what is typed. Reads the terminal in raw
 * mode: readline would redraw the line and wipe the prompt.
 */
function promptSecret(question: string): Promise<string> {
    const stdin = process.stdin;
    process.stderr.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    return new Promise((resolve) => {
        let value = '';
        const finish = () => {
            stdin.off('data', onData);
            stdin.setRawMode(false);
            stdin.pause();
            process.stderr.write('\n');
        };
        const onData = (chunk: string) => {
            for (const char of chunk) {
                if (char === '\r' || char === '\n' || char === '\u0004') {
                    finish();
                    resolve(value);
                    return;
                }
                if (char === '\u0003') {
                    // Ctrl+C: raw mode swallows SIGINT, so exit the way the shell expects.
                    finish();
                    process.exit(130);
                }
                if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
                else value += char;
            }
        };
        stdin.on('data', onData);
    });
}

export function registerAuth(program: Command): void {
    const auth = program.command('auth').description('Store, inspect and clear your API key');

    auth.command('login')
        .description(
            'Store an API key (Settings → API Keys). Prompts for it on a terminal, reads it from stdin ' +
                'when piped, or takes it from --api-key. The key is validated before it is saved.',
        )
        .action(
            action(async (ctx) => {
                let raw = ctx.opts.apiKey;
                if (raw === undefined && process.stdin.isTTY) {
                    process.stderr.write(
                        'Paste your Perspective API key (create one under Settings → API Keys in the app).\n' +
                            'Input is hidden.\n\n',
                    );
                    raw = await promptSecret('API key: ');
                }
                raw ??= await readTextArg('-');
                const key = raw.trim();
                if (!key) throw new CliError('usage', 'Empty API key');
                // Validate before storing: a cheap authenticated read.
                await new RestClient(await ctx.baseUrl(), key).request({ path: '/workspaces' });
                const config = await ctx.stored();
                config.apiKey = key;
                await saveConfig(config, ctx.env);
                return { ok: true, apiKey: mask(key), configPath: configPath(ctx.env) };
            }),
        );

    auth.command('status')
        .description('Show whether an API key is configured and where it comes from (no network calls)')
        .action(
            action(async (ctx) => {
                const config = await ctx.stored();
                const source = ctx.opts.apiKey
                    ? 'flag'
                    : ctx.env.PERSPECTIVE_API_KEY
                      ? 'env'
                      : config.apiKey
                        ? 'config'
                        : null;
                const key = ctx.opts.apiKey ?? ctx.env.PERSPECTIVE_API_KEY ?? config.apiKey;
                return {
                    authenticated: Boolean(key),
                    source,
                    apiKey: key ? mask(key) : null,
                    baseUrl: await ctx.baseUrl(),
                    configPath: configPath(ctx.env),
                };
            }),
        );

    auth.command('logout')
        .description('Delete the stored API key (environment variables are not affected)')
        .action(
            action(async (ctx) => {
                await clearConfig(ctx.env);
                return { ok: true, removed: configPath(ctx.env) };
            }),
        );
}
