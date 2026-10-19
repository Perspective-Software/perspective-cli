import { CliError } from './errors.ts';
import { DEFAULT_BASE_URL, loadConfig, type StoredConfig } from './config.ts';

export interface GlobalOptions {
    baseUrl?: string;
    apiKey?: string;
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

    /** API key for the External API (`/v1`). */
    async apiKey(): Promise<string> {
        const key = this.opts.apiKey ?? this.env.PERSPECTIVE_API_KEY ?? (await this.stored()).apiKey;
        if (!key) {
            throw new CliError('unauthenticated', 'No API key configured', {
                hint:
                    'Commands need an API key. Create one under Settings → API Keys, then run ' +
                    '`perspective auth login` or set PERSPECTIVE_API_KEY.',
            });
        }
        return key;
    }
}
