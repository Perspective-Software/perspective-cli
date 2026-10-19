import { CliError } from './errors.ts';
import { DEFAULT_BASE_URL, loadConfig, saveConfig, type StoredConfig } from './config.ts';
import { isExpired, refresh } from './oauth.ts';

export interface GlobalOptions {
    baseUrl?: string;
    apiKey?: string;
    token?: string;
    pretty?: boolean;
}

/**
 * Resolves credentials per call. Precedence, highest first:
 * command-line flag → environment variable → stored credentials file.
 */
export class Context {
    readonly opts: GlobalOptions;
    readonly env: NodeJS.ProcessEnv;
    private config?: StoredConfig;

    constructor(opts: GlobalOptions, env: NodeJS.ProcessEnv = process.env) {
        this.opts = opts;
        this.env = env;
    }

    async stored(): Promise<StoredConfig> {
        this.config ??= await loadConfig(this.env);
        return this.config;
    }

    async baseUrl(): Promise<string> {
        const url =
            this.opts.baseUrl ??
            this.env.PERSPECTIVE_BASE_URL ??
            (await this.stored()).baseUrl ??
            DEFAULT_BASE_URL;
        return url.replace(/\/+$/, '');
    }

    /** API key for the REST API (`/v1`). */
    async apiKey(): Promise<string> {
        const key = this.opts.apiKey ?? this.env.PERSPECTIVE_API_KEY ?? (await this.stored()).apiKey;
        if (!key) {
            throw new CliError('unauthenticated', 'No API key configured', {
                hint:
                    'REST commands need an API key. Create one under Settings → API Keys, then run ' +
                    '`perspective auth login --with-api-key` (reads the key from stdin) or set PERSPECTIVE_API_KEY.',
            });
        }
        return key;
    }

    /** OAuth access token for the MCP server (`/mcp`). Refreshes and persists when expired. */
    async accessToken(): Promise<string> {
        const explicit = this.opts.token ?? this.env.PERSPECTIVE_TOKEN;
        if (explicit) return explicit;

        const config = await this.stored();
        if (!config.oauth) {
            throw new CliError('unauthenticated', 'Not logged in', {
                hint:
                    'MCP-backed commands (`perspective tools …`) need an OAuth session. ' +
                    'Run `perspective auth login`, or set PERSPECTIVE_TOKEN.',
            });
        }
        if (isExpired(config.oauth)) {
            config.oauth = await refresh(await this.baseUrl(), config.oauth);
            await saveConfig(config, this.env);
        }
        return config.oauth.accessToken;
    }
}
