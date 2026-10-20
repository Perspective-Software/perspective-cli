import { CliError } from './errors.ts';

export interface OutputOptions {
    pretty?: boolean;
}

/** Pretty-print for humans at a terminal, compact JSON when piped (agents, jq). */
function indentFor(opts: OutputOptions, stream: NodeJS.WriteStream): number | undefined {
    const pretty = opts.pretty ?? stream.isTTY === true;
    return pretty ? 2 : undefined;
}

function pick(item: unknown, paths: string[][]): unknown {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const out: Record<string, unknown> = {};
    for (const path of paths) {
        let value: unknown = item;
        for (const key of path) {
            value = value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
        }
        out[path.join('.')] = value ?? null;
    }
    return out;
}

/**
 * Keeps only the listed fields of `data` (each item when it is a list); `meta`
 * stays. Dotted paths reach into nested objects and keep the dotted name as the
 * key, e.g. `properties.city`. Missing fields come back as null so every item
 * has the same keys.
 */
export function selectFields(value: unknown, fields: string): unknown {
    const paths = fields
        .split(',')
        .map((field) => field.trim())
        .filter(Boolean)
        .map((field) => field.split('.'));
    if (paths.length === 0) return value;
    const apply = (data: unknown) => (Array.isArray(data) ? data.map((item) => pick(item, paths)) : pick(data, paths));
    if (value && typeof value === 'object' && !Array.isArray(value) && 'data' in value) {
        return { ...value, data: apply((value as { data: unknown }).data) };
    }
    return apply(value);
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
