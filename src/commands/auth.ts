import { createInterface } from 'node:readline';
import type { Command } from 'commander';
import { action } from '../command.ts';
import { clearConfig, configPath, saveConfig } from '../config.ts';
import { CliError } from '../errors.ts';
import { readTextArg } from '../input.ts';
import { RestClient } from '../rest.ts';

export function mask(secret: string): string {
    return secret.length <= 8 ? '••••' : `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

/** Prompts on stderr without echoing what is typed. */
function promptSecret(question: string): Promise<string> {
    return new Promise((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
        const internal = rl as unknown as { _writeToOutput: (text: string) => void };
        process.stderr.write(question);
        internal._writeToOutput = () => {};
        rl.question('', (answer) => {
            rl.close();
            process.stderr.write('\n');
            resolve(answer);
        });
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
                const raw =
                    ctx.opts.apiKey ??
                    (process.stdin.isTTY ? await promptSecret('API key: ') : await readTextArg('-'));
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
