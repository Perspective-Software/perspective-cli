import type { Command } from 'commander';
import { Context, type GlobalOptions } from './context.ts';
import { printError, printResult, selectFields } from './output.ts';

type Handler = (ctx: Context, ...args: any[]) => Promise<unknown>;

/**
 * Wraps a command handler: builds the Context from global flags, prints the
 * returned value as JSON on stdout, and turns any error into a JSON error on
 * stderr plus a documented exit code.
 */
export function action(handler: Handler) {
    return async (...args: unknown[]): Promise<void> => {
        const command = args[args.length - 1] as Command;
        const globals = command.optsWithGlobals<GlobalOptions>();
        const ctx = new Context(globals);
        try {
            const result = await handler(ctx, ...args.slice(0, -1));
            printResult(globals.fields ? selectFields(result, globals.fields) : result, { pretty: globals.pretty });
        } catch (err) {
            process.exitCode = printError(err, { pretty: globals.pretty });
        }
    };
}
