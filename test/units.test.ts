import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mask } from '../src/commands/auth.ts';
import { KPI_SUBTYPES, normalizeSubtype, resolveWindow } from '../src/commands/metrics.ts';
import { flattenFunnels } from '../src/commands/workspaces.ts';
import { configPath, loadConfig, saveConfig } from '../src/config.ts';
import { Context } from '../src/context.ts';
import { CliError } from '../src/errors.ts';
import { applyAssignments, parseAssignment } from '../src/input.ts';
import { selectFields } from '../src/output.ts';

describe('assignments', () => {
    it('parses JSON values and falls back to strings', () => {
        expect(parseAssignment('limit=20')).toEqual([['limit'], 20]);
        expect(parseAssignment('noBrand=true')).toEqual([['noBrand'], true]);
        expect(parseAssignment('name=Spring sale')).toEqual([['name'], 'Spring sale']);
        expect(parseAssignment('q=a=b')).toEqual([['q'], 'a=b']);
    });

    it('nests dotted keys and merges into existing objects', () => {
        const target = { data: { name: 'x' } } as Record<string, unknown>;
        applyAssignments(target, ['data.prompt=hi', 'data.noBrand=true']);
        expect(target).toEqual({ data: { name: 'x', prompt: 'hi', noBrand: true } });
    });

    it('rejects malformed input as a usage error', () => {
        expect(() => parseAssignment('novalue')).toThrow(CliError);
    });
});

describe('metrics helpers', () => {
    it('normalizes subtype spellings', () => {
        expect(normalizeSubtype('conversion-rate', 'kpi', KPI_SUBTYPES)).toBe('kpi_conversion_rate');
        expect(normalizeSubtype('kpi_new_contacts', 'kpi', KPI_SUBTYPES)).toBe('kpi_new_contacts');
        expect(() => normalizeSubtype('nope', 'kpi', KPI_SUBTYPES)).toThrow(/Unknown kpi subtype/);
    });

    it('defaults to the last N days and honours explicit bounds', () => {
        const now = new Date('2026-10-19T12:00:00.000Z');
        const w = resolveWindow({ days: 7, tzOffset: '0' }, now);
        expect(w).toEqual({ from: '2026-10-12T12:00:00.000Z', to: '2026-10-19T12:00:00.000Z', offset: '0' });
        const explicit = resolveWindow({ from: '2026-09-01', to: '2026-10-01', days: 30, tzOffset: '120' }, now);
        expect(explicit.from).toBe('2026-09-01T00:00:00.000Z');
        expect(explicit.offset).toBe('120');
        expect(() => resolveWindow({ from: '2026-10-02', to: '2026-10-01', days: 30 }, now)).toThrow(/before/);
    });
});

describe('flattenFunnels', () => {
    it('lifts campaigns out of workspaces', () => {
        expect(
            flattenFunnels([{ id: 'w1', name: 'Main', campaigns: [{ id: 'f1', name: 'Quiz', status: 'live' }] }]),
        ).toEqual([{ id: 'f1', name: 'Quiz', status: 'live', workspaceId: 'w1', workspaceName: 'Main' }]);
    });
});

describe('auth', () => {
    it('masks secrets', () => {
        expect(mask('abcd1234efgh')).toBe('abcd…efgh');
        expect(mask('short')).toBe('••••');
    });
});

describe('config + context', () => {
    async function tempEnv(): Promise<NodeJS.ProcessEnv> {
        return { PERSPECTIVE_CONFIG_DIR: await mkdtemp(join(tmpdir(), 'pcli-')) };
    }

    it('stores credentials with 0600 permissions', async () => {
        const env = await tempEnv();
        await saveConfig({ apiKey: 'k' }, env);
        expect((await stat(configPath(env))).mode & 0o777).toBe(0o600);
        expect(await loadConfig(env)).toEqual({ apiKey: 'k' });
    });

    it('resolves flag > env > file', async () => {
        const env = await tempEnv();
        await saveConfig({ apiKey: 'from-file', baseUrl: 'https://file.example' }, env);
        expect(await new Context({}, env).apiKey()).toBe('from-file');
        expect(await new Context({}, { ...env, PERSPECTIVE_API_KEY: 'from-env' }).apiKey()).toBe('from-env');
        expect(await new Context({ apiKey: 'from-flag' }, { ...env, PERSPECTIVE_API_KEY: 'from-env' }).apiKey()).toBe(
            'from-flag',
        );
        expect(await new Context({ baseUrl: 'https://flag.example/' }, env).baseUrl()).toBe('https://flag.example');
    });

    it('fails with unauthenticated when nothing is configured', async () => {
        const env = await tempEnv();
        await expect(new Context({}, env).apiKey()).rejects.toMatchObject({ code: 'unauthenticated' });
    });

});

describe('selectFields', () => {
    const page = {
        data: [
            { id: 'c1', email: 'a@x.co', status: 'new', properties: { city: 'Berlin' } },
            { id: 'c2', email: 'b@x.co' },
        ],
        meta: { total: 2 },
    };

    it('keeps the listed fields of each item and the meta', () => {
        expect(selectFields(page, 'id,email')).toEqual({
            data: [
                { id: 'c1', email: 'a@x.co' },
                { id: 'c2', email: 'b@x.co' },
            ],
            meta: { total: 2 },
        });
    });

    it('reaches into nested objects and fills missing fields with null', () => {
        expect(selectFields(page, 'id, properties.city')).toEqual({
            data: [
                { id: 'c1', 'properties.city': 'Berlin' },
                { id: 'c2', 'properties.city': null },
            ],
            meta: { total: 2 },
        });
    });

    it('works on a single object and on results without a data envelope', () => {
        expect(selectFields({ data: { type: 'kpi', value: 3 } }, 'value')).toEqual({ data: { value: 3 } });
        expect(selectFields({ kpi: ['a'], chart: ['b'] }, 'kpi')).toEqual({ kpi: ['a'] });
    });
});
