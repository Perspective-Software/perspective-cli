import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CliError } from './errors.ts';

export const DEFAULT_BASE_URL = 'https://api.perspective.co';

export interface StoredConfig {
    baseUrl?: string;
    apiKey?: string;
}

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
    if (env.PERSPECTIVE_CONFIG_DIR) return env.PERSPECTIVE_CONFIG_DIR;
    const xdg = env.XDG_CONFIG_HOME || join(homedir(), '.config');
    return join(xdg, 'perspective');
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
    return join(configDir(env), 'credentials.json');
}

export async function loadConfig(env: NodeJS.ProcessEnv = process.env): Promise<StoredConfig> {
    const path = configPath(env);
    let text: string;
    try {
        text = await readFile(path, 'utf8');
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
        throw err;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        parsed = undefined;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new CliError('error', `${path} is not a JSON object`, {
            hint: 'Run `perspective auth logout` to delete it, then `perspective auth login`.',
        });
    }
    return parsed as StoredConfig;
}

/** The file holds secrets: the directory is 0700 and the file 0600. */
export async function saveConfig(
    config: StoredConfig,
    env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
    const dir = configDir(env);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const path = configPath(env);
    await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    await chmod(path, 0o600);
}

export async function clearConfig(env: NodeJS.ProcessEnv = process.env): Promise<void> {
    await rm(configPath(env), { force: true });
}
