import { readFile } from 'node:fs/promises';
import { usage } from './errors.ts';

async function readStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8');
}

/** Reads text from a literal, `@path` (file) or `-` (stdin). */
export async function readTextArg(value: string): Promise<string> {
    if (value === '-') return readStdin();
    if (value.startsWith('@')) return readFile(value.slice(1), 'utf8');
    return value;
}

/** Parses a JSON object from a literal, `@path` or `-`. */
export async function readJsonObject(value: string, what = 'input'): Promise<Record<string, unknown>> {
    const text = await readTextArg(value);
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (err) {
        throw usage(`${what} is not valid JSON: ${(err as Error).message}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw usage(`${what} must be a JSON object`);
    }
    return parsed as Record<string, unknown>;
}

/**
 * `key=value` → [key, value]. The value is parsed as JSON when it is valid
 * JSON (numbers, booleans, arrays, objects, quoted strings) and kept as a
 * plain string otherwise. Dotted keys nest: `address.city=Berlin`.
 */
export function parseAssignment(raw: string): [string[], unknown] {
    const eq = raw.indexOf('=');
    if (eq <= 0) throw usage(`Expected key=value, got "${raw}"`);
    const key = raw.slice(0, eq);
    const text = raw.slice(eq + 1);
    let value: unknown = text;
    try {
        value = JSON.parse(text);
    } catch {
        // plain string
    }
    // Keep integers that a double can't hold exactly (e.g. long IDs) as text.
    if (typeof value === 'number' && /^\s*-?\d+\s*$/.test(text) && BigInt(text.trim()) !== BigInt(value)) {
        value = text;
    }
    return [key.split('.'), value];
}

export function applyAssignments(target: Record<string, unknown>, assignments: string[]): Record<string, unknown> {
    for (const raw of assignments) {
        const [path, value] = parseAssignment(raw);
        let node = target;
        for (const segment of path.slice(0, -1)) {
            const next = node[segment];
            if (!next || typeof next !== 'object' || Array.isArray(next)) node[segment] = {};
            node = node[segment] as Record<string, unknown>;
        }
        node[path[path.length - 1]!] = value;
    }
    return target;
}

export function collect(value: string, previous: string[] = []): string[] {
    return [...previous, value];
}

/** Without `min`, any integer is accepted. */
export function parseInteger(name: string, min?: number, max = Number.MAX_SAFE_INTEGER) {
    return (value: string): number => {
        const n = value.trim() === '' ? NaN : Number(value);
        if (!Number.isSafeInteger(n) || (min !== undefined && (n < min || n > max))) {
            throw usage(
                min === undefined ? `--${name} must be an integer` : `--${name} must be an integer between ${min} and ${max}`,
            );
        }
        return n;
    };
}
