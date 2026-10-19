import { CliError } from './errors.ts';

export interface OutputOptions {
    pretty?: boolean;
}

/** Pretty-print for humans at a terminal, compact JSON when piped (agents, jq). */
function indentFor(opts: OutputOptions, stream: NodeJS.WriteStream): number | undefined {
    const pretty = opts.pretty ?? stream.isTTY === true;
    return pretty ? 2 : undefined;
}

export function printResult(value: unknown, opts: OutputOptions = {}): void {
    if (value === undefined) return;
    process.stdout.write(`${JSON.stringify(value, null, indentFor(opts, process.stdout))}\n`);
}

export function printError(err: unknown, opts: OutputOptions = {}): number {
    const cliError =
        err instanceof CliError
            ? err
            : new CliError('error', err instanceof Error ? err.message : String(err));
    process.stderr.write(
        `${JSON.stringify(cliError.toJSON(), null, indentFor(opts, process.stderr))}\n`,
    );
    return cliError.exitCode;
}
