/**
 * Exit codes are part of the CLI's contract — scripts and agents branch on
 * them — so they never change meaning. Add new codes, never renumber.
 */
export const ExitCode = {
    OK: 0,
    ERROR: 1,
    USAGE: 2,
    UNAUTHENTICATED: 3,
    FORBIDDEN: 4,
    NOT_FOUND: 5,
    RATE_LIMITED: 6,
    NETWORK: 7,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export type ErrorCode =
    | 'error'
    | 'usage'
    | 'unauthenticated'
    | 'forbidden'
    | 'not_found'
    | 'rate_limited'
    | 'network';

const EXIT_BY_CODE: Record<ErrorCode, ExitCodeValue> = {
    error: ExitCode.ERROR,
    usage: ExitCode.USAGE,
    unauthenticated: ExitCode.UNAUTHENTICATED,
    forbidden: ExitCode.FORBIDDEN,
    not_found: ExitCode.NOT_FOUND,
    rate_limited: ExitCode.RATE_LIMITED,
    network: ExitCode.NETWORK,
};

export class CliError extends Error {
    readonly code: ErrorCode;
    readonly status?: number;
    readonly hint?: string;
    readonly details?: unknown;

    constructor(
        code: ErrorCode,
        message: string,
        opts: { status?: number; hint?: string; details?: unknown } = {},
    ) {
        super(message);
        this.name = 'CliError';
        this.code = code;
        this.status = opts.status;
        this.hint = opts.hint;
        this.details = opts.details;
    }

    get exitCode(): ExitCodeValue {
        return EXIT_BY_CODE[this.code];
    }

    toJSON(): Record<string, unknown> {
        return {
            error: {
                code: this.code,
                message: this.message,
                ...(this.status !== undefined && { status: this.status }),
                ...(this.hint && { hint: this.hint }),
                ...(this.details !== undefined && { details: this.details }),
            },
        };
    }
}

export function errorCodeForStatus(status: number): ErrorCode {
    if (status === 401) return 'unauthenticated';
    if (status === 403) return 'forbidden';
    if (status === 404) return 'not_found';
    if (status === 429) return 'rate_limited';
    if (status === 400 || status === 422) return 'usage';
    return 'error';
}

export function usage(message: string, hint?: string): CliError {
    return new CliError('usage', message, { hint });
}
