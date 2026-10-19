import type { Command } from 'commander';
import { action } from '../command.ts';
import { RestClient } from '../rest.ts';

interface Workspace {
    id: string;
    name: string;
    campaigns: { id: string; name: string; status: string }[];
}

export function flattenFunnels(workspaces: Workspace[]) {
    return workspaces.flatMap((ws) =>
        ws.campaigns.map((c) => ({ ...c, workspaceId: ws.id, workspaceName: ws.name })),
    );
}

export function registerWorkspaces(program: Command): void {
    program
        .command('workspaces')
        .description('Workspaces and the funnels in them')
        .command('list')
        .description('List workspaces with their funnels (campaigns)')
        .action(
            action(async (ctx) => {
                const rest = new RestClient(await ctx.baseUrl(), await ctx.apiKey());
                return rest.request({ path: '/workspaces' });
            }),
        );

    program
        .command('funnels')
        .description('Funnels across all workspaces')
        .command('list')
        .description('List every funnel as a flat list — the quickest way to find a funnel ID')
        .option('--status <status>', 'only funnels with this status (online|offline)')
        .option('--name <text>', 'only funnels whose name contains this text (case-insensitive)')
        .action(
            action(async (ctx, opts: { status?: string; name?: string }) => {
                const rest = new RestClient(await ctx.baseUrl(), await ctx.apiKey());
                const { data } = await rest.request<{ data: Workspace[] }>({ path: '/workspaces' });
                const needle = opts.name?.toLowerCase();
                return {
                    data: flattenFunnels(data).filter(
                        (f) =>
                            (!opts.status || f.status === opts.status) &&
                            (!needle || f.name.toLowerCase().includes(needle)),
                    ),
                };
            }),
        );
}
