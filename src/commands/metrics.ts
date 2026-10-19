import { Option, type Command } from 'commander';
import { action } from '../command.ts';
import { usage } from '../errors.ts';
import { parseInteger } from '../input.ts';
import { RestClient } from '../rest.ts';

export const KPI_SUBTYPES = [
    'kpi_conversion_rate',
    'kpi_completion_rate',
    'kpi_average_time_on_page',
    'kpi_time_to_completion',
    'kpi_new_contacts',
    'kpi_total_sessions',
    'kpi_messages_sent',
    'kpi_messages_delivery_rate',
    'kpi_messages_open_rate',
];

export const CHART_SUBTYPES = [
    'chart_page_to_page_conversion_rate',
    'chart_activity_by_daytime',
    'chart_contacts_over_time',
    'chart_visitor_devices',
    'chart_top_utm_sources',
    'chart_time_on_page',
    'chart_button_clicks',
];

/** Accepts `conversion_rate`, `conversion-rate` or `kpi_conversion_rate`. */
export function normalizeSubtype(raw: string, prefix: 'kpi' | 'chart', valid: string[]): string {
    const snake = raw.trim().toLowerCase().replace(/-/g, '_');
    const full = snake.startsWith(`${prefix}_`) ? snake : `${prefix}_${snake}`;
    if (!valid.includes(full)) {
        throw usage(`Unknown ${prefix} subtype "${raw}"`, `Valid: ${valid.join(', ')}`);
    }
    return full;
}

/** Resolves KPI names (`all` = every KPI), keeping the given order and dropping repeats. */
export function resolveKpis(raw: string[]): string[] {
    const names = raw.flatMap((name) => (name.trim().toLowerCase() === 'all' ? KPI_SUBTYPES : [name]));
    return [...new Set(names.map((name) => normalizeSubtype(name, 'kpi', KPI_SUBTYPES)))];
}

interface WindowOptions {
    from?: string;
    to?: string;
    days: number;
    tzOffset?: string;
}

function parseDate(name: string, value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw usage(`--${name} is not a valid date: "${value}"`);
    return date;
}

/** `--from/--to` win; otherwise the window is the last `--days` days ending now. */
export function resolveWindow(opts: WindowOptions, now = new Date()) {
    const to = opts.to ? parseDate('to', opts.to) : now;
    const from = opts.from ? parseDate('from', opts.from) : new Date(to.getTime() - opts.days * 86_400_000);
    if (from >= to) throw usage('--from must be before --to');
    // The API wants minutes east of UTC (UTC+2 → "120"); getTimezoneOffset is minutes west.
    const offset = opts.tzOffset ?? String(-now.getTimezoneOffset());
    return { from: from.toISOString(), to: to.toISOString(), offset };
}

function withWindow(cmd: Command): Command {
    return cmd
        .option('--from <date>', 'start of the period (ISO 8601)')
        .option('--to <date>', 'end of the period (ISO 8601), default now')
        .option('--days <n>', 'period length when --from is not given', parseInteger('days', 1, 3650), 30)
        .option('--tz-offset <minutes>', 'timezone offset in minutes east of UTC, default: local timezone');
}

export function registerMetrics(program: Command): void {
    const metrics = program
        .command('metrics')
        .description('Funnel analytics: KPIs, charts and question insights');

    withWindow(
        metrics
            .command('kpi')
            .description(
                'KPIs for a funnel, e.g. conversion_rate total_sessions, or `all`. One KPI prints the API response ' +
                    'as-is; several print {data: [...]} in the order given, each with its `type`.',
            )
            .argument('<funnelId>')
            .argument('<subtypes...>'),
    ).action(
        action(async (ctx, funnelId: string, subtypes: string[], opts: WindowOptions) => {
            const kpis = resolveKpis(subtypes);
            const query = resolveWindow(opts);
            const rest = new RestClient(await ctx.baseUrl(), await ctx.apiKey());
            const fetchKpi = (kpi: string) =>
                rest.request<{ data: unknown }>({
                    path: `/funnels/${encodeURIComponent(funnelId)}/metrics/kpis/${kpi}`,
                    query,
                });
            if (kpis.length === 1) return fetchKpi(kpis[0]!);
            const results = await Promise.all(kpis.map(fetchKpi));
            return { data: results.map((result) => result.data) };
        }),
    );

    withWindow(
        metrics
            .command('chart')
            .description('Chart data for a funnel, e.g. page_to_page_conversion_rate, visitor_devices')
            .argument('<funnelId>')
            .argument('<subtype>')
            .addOption(
                new Option('--ab-test <variant>', 'A/B filter (page_to_page_conversion_rate only)').choices([
                    'all',
                    'original',
                    'variant',
                ]),
            ),
    ).action(
        action(async (ctx, funnelId: string, subtype: string, opts: WindowOptions & { abTest?: string }) => {
            const chart = normalizeSubtype(subtype, 'chart', CHART_SUBTYPES);
            if (opts.abTest && chart !== 'chart_page_to_page_conversion_rate') {
                throw usage('--ab-test only works with page_to_page_conversion_rate');
            }
            const rest = new RestClient(await ctx.baseUrl(), await ctx.apiKey());
            return rest.request({
                path: `/funnels/${encodeURIComponent(funnelId)}/metrics/charts/${chart}`,
                query: { ...resolveWindow(opts), abTest: opts.abTest },
            });
        }),
    );

    withWindow(
        metrics
            .command('insight')
            .description('Answers to one question/survey element (insightId as shown in the builder, e.g. question_1234)')
            .argument('<funnelId>')
            .argument('<insightId>'),
    ).action(
        action(async (ctx, funnelId: string, insightId: string, opts: WindowOptions) => {
            const rest = new RestClient(await ctx.baseUrl(), await ctx.apiKey());
            return rest.request({
                path: `/funnels/${encodeURIComponent(funnelId)}/metrics/insights/${encodeURIComponent(insightId)}`,
                query: resolveWindow(opts),
            });
        }),
    );

    metrics
        .command('subtypes')
        .description('List valid KPI and chart subtypes (offline)')
        .action(action(async () => ({ kpi: KPI_SUBTYPES, chart: CHART_SUBTYPES })));
}
