#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { Command, CommanderError } from 'commander';
import { registerAuth } from './commands/auth.ts';
import { registerContacts } from './commands/contacts.ts';
import { registerMetrics } from './commands/metrics.ts';
import { registerSkill } from './commands/skill.ts';
import { registerWorkspaces } from './commands/workspaces.ts';
import { CliError, ExitCode } from './errors.ts';
import { printError } from './output.ts';

const { version } = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

function buildProgram(): Command {
    const program = new Command('perspective')
        .description(
            'Perspective from the command line. Output is JSON on stdout; errors are JSON on stderr.\n' +
                'Docs: https://developers.perspective.co/cli/overview',
        )
        .version(version)
        .option('--base-url <url>', 'API origin (env PERSPECTIVE_BASE_URL)', undefined)
        .option('--api-key <key>', 'API key (env PERSPECTIVE_API_KEY)')
        .option('--fields <list>', 'only these fields of each result, comma-separated; dots nest (id,email,properties.city)')
        .option('--pretty', 'indent JSON output (default when stdout is a terminal)')
        .option('--no-pretty', 'compact JSON output (default when piped)')
        // Parse errors (unknown option, missing argument, invalid choice) are printed as JSON
        // in the catch below; commander's own text would break the stderr contract.
        .configureOutput({ outputError: () => {} })
        .exitOverride();

    registerAuth(program);
    registerWorkspaces(program);
    registerContacts(program);
    registerMetrics(program);
    registerSkill(program);
    return program;
}

try {
    await buildProgram().parseAsync(process.argv);
} catch (err) {
    if (err instanceof CommanderError) {
        if (err.exitCode === 0 || err.code === 'commander.help') {
            // Help or version text, already printed by commander.
            process.exitCode = err.exitCode === 0 ? ExitCode.OK : ExitCode.USAGE;
        } else {
            process.exitCode = printError(
                new CliError('usage', err.message.replace(/^error: /, '').replace(/\s*\n\s*/g, ' '), {
                    hint: 'Run the command with --help to see its arguments and options.',
                }),
            );
        }
    } else {
        process.exitCode = printError(err);
    }
}
