import { Option, type Command } from 'commander';
import { action } from '../command.ts';
import { usage } from '../errors.ts';
import { applyAssignments, collect, parseInteger, readJsonObject } from '../input.ts';
import { RestClient } from '../rest.ts';

const SORT_FIELDS = ['ps_converted_at', 'email', 'firstName', 'lastName'];
/** Server-side cap on `limit`. */
const MAX_LIMIT = 100;

interface ContactsPage {
    data: unknown[];
    meta: { total: number; page: number; limit: number; hasNext: boolean };
}

export function registerContacts(program: Command): void {
    const contacts = program.command('contacts').description("A funnel's CRM contacts");

    contacts
        .command('list')
        .description('List contacts of a funnel, newest first')
        .argument('<funnelId>')
        .option('--page <n>', 'page number, 0-based', parseInteger('page', 0), 0)
        .option('--limit <n>', `page size, 1–${MAX_LIMIT}`, parseInteger('limit', 1, MAX_LIMIT), 50)
        .addOption(new Option('--sort <field>', 'sort field').choices(SORT_FIELDS).default('ps_converted_at'))
        .addOption(new Option('--order <dir>', 'sort direction').choices(['asc', 'desc']).default('desc'))
        .option('--all', 'follow pages until the end and return every contact')
        .action(
            action(
                async (
                    ctx,
                    funnelId: string,
                    opts: { page: number; limit: number; sort: string; order: string; all?: boolean },
                ) => {
                    const rest = new RestClient(await ctx.baseUrl(), await ctx.apiKey());
                    const fetchPage = (page: number, limit: number) =>
                        rest.request<ContactsPage>({
                            path: `/funnels/${encodeURIComponent(funnelId)}/contacts`,
                            query: {
                                page,
                                limit,
                                sortField: opts.sort,
                                sortOrder: opts.order === 'asc' ? 1 : -1,
                            },
                        });

                    if (!opts.all) return fetchPage(opts.page, opts.limit);

                    const all: unknown[] = [];
                    let page = 0;
                    let result: ContactsPage;
                    do {
                        result = await fetchPage(page++, MAX_LIMIT);
                        all.push(...result.data);
                    } while (result.meta.hasNext);
                    return { data: all, meta: { total: result.meta.total } };
                },
            ),
        );

    contacts
        .command('get')
        .description('Get one contact')
        .argument('<funnelId>')
        .argument('<contactId>')
        .action(
            action(async (ctx, funnelId: string, contactId: string) => {
                const rest = new RestClient(await ctx.baseUrl(), await ctx.apiKey());
                return rest.request({
                    path: `/funnels/${encodeURIComponent(funnelId)}/contacts/${encodeURIComponent(contactId)}`,
                });
            }),
        );

    contacts
        .command('create')
        .description('Create a contact. Needs --email or --phone.')
        .argument('<funnelId>')
        .option('--email <email>')
        .option('--phone <phone>')
        .option('--first-name <name>')
        .option('--last-name <name>')
        .option('--status <status>', 'one of the statuses configured for the funnel')
        .option('--website <url>')
        .option('--birthday <date>')
        .option('-s, --set <key=value>', 'any body field, repeatable; dots nest (address.city=Berlin)', collect, [])
        .option('--data <json>', 'full request body as JSON, @file or - for stdin; flags override it')
        .option('--skip-automation', 'do not trigger automations for the initial status')
        .action(
            action(
                async (
                    ctx,
                    funnelId: string,
                    opts: {
                        email?: string;
                        phone?: string;
                        firstName?: string;
                        lastName?: string;
                        status?: string;
                        website?: string;
                        birthday?: string;
                        set: string[];
                        data?: string;
                        skipAutomation?: boolean;
                    },
                ) => {
                    const body = opts.data ? await readJsonObject(opts.data, '--data') : {};
                    const flags = {
                        email: opts.email,
                        phone: opts.phone,
                        firstName: opts.firstName,
                        lastName: opts.lastName,
                        status: opts.status,
                        website: opts.website,
                        birthday: opts.birthday,
                    };
                    for (const [key, value] of Object.entries(flags)) if (value !== undefined) body[key] = value;
                    applyAssignments(body, opts.set);
                    if (opts.skipAutomation) body.skipAutomationTrigger = true;
                    if (!body.email && !body.phone) throw usage('A contact needs --email or --phone');

                    const rest = new RestClient(await ctx.baseUrl(), await ctx.apiKey());
                    return rest.request({
                        method: 'POST',
                        path: `/funnels/${encodeURIComponent(funnelId)}/contacts`,
                        body,
                    });
                },
            ),
        );

    contacts
        .command('set')
        .description(
            'Set one field on a contact. Standard fields (firstName, email, status, city, …) or any custom property name.',
        )
        .argument('<funnelId>')
        .argument('<contactId>')
        .argument('<field>')
        .argument('<value>')
        .option('--skip-automation', 'do not trigger automations for this change')
        .action(
            action(
                async (
                    ctx,
                    funnelId: string,
                    contactId: string,
                    field: string,
                    value: string,
                    opts: { skipAutomation?: boolean },
                ) => {
                    const rest = new RestClient(await ctx.baseUrl(), await ctx.apiKey());
                    return rest.request({
                        method: 'PUT',
                        path: `/funnels/${encodeURIComponent(funnelId)}/contacts/${encodeURIComponent(contactId)}/values`,
                        body: {
                            fieldName: field,
                            value,
                            ...(opts.skipAutomation && { skipAutomationTrigger: true }),
                        },
                    });
                },
            ),
        );
}
