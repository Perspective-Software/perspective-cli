#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { Command, CommanderError } from 'commander';
import { registerAuth } from './commands/auth.ts';
import { registerContacts } from './commands/contacts.ts';
import { registerMetrics } from './commands/metrics.ts';
import { registerSkill } from './commands/skill.ts';
import { registerTools } from './commands/tools.ts';
import { registerWorkspaces } from './commands/workspaces.ts';
import { ExitCode } from './errors.ts';
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
        .option('--api-key <key>', 'REST API key (env PERSPECTIVE_API_KEY)')
        .option('--token <token>', 'OAuth access token for MCP tools (env PERSPECTIVE_TOKEN)')
        .option('--pretty', 'indent JSON output (default when stdout is a terminal)')
        .option('--no-pretty', 'compact JSON output (default when piped)')
        .showHelpAfterError()
        .exitOverride();

    registerAuth(program);
    registerWorkspaces(program);
    registerContacts(program);
    registerMetrics(program);
    registerTools(program);
    registerSkill(program);
    return program;
}

try {
    await buildProgram().parseAsync(process.argv);
} catch (err) {
    if (err instanceof CommanderError) {
        // Commander already printed help/version/the usage message.
        process.exitCode = err.exitCode === 0 ? ExitCode.OK : ExitCode.USAGE;
    } else {
        process.exitCode = printError(err);
    }
}
