import { Option, type Command } from 'commander';
import { action } from '../command.ts';
import { CliError } from '../errors.ts';
import { applyAssignments, collect, readJsonObject } from '../input.ts';
import { MCP_SCOPES, McpClient, unwrapToolResult, type McpScope } from '../mcp.ts';
import type { Context } from '../context.ts';

async function client(ctx: Context, scope: McpScope): Promise<McpClient> {
    return new McpClient(await ctx.baseUrl(), await ctx.accessToken(), scope);
}

const scopeOption = () =>
    new Option('--scope <scope>', 'MCP tool scope').choices([...MCP_SCOPES]).default('all');

export function registerTools(program: Command): void {
    const tools = program
        .command('tools')
        .description(
            'Call any tool of the Perspective MCP server — funnels, sequences, brands, stats, CRM, images (needs `auth login`)',
        );

    tools
        .command('list')
        .description('List available tools (name, title, description)')
        .addOption(scopeOption())
        .option('--schemas', 'include each input schema')
        .action(
            action(async (ctx, opts: { scope: McpScope; schemas?: boolean }) => {
                const list = await (await client(ctx, opts.scope)).listTools();
                return {
                    data: list.map((t) => ({
                        name: t.name,
                        ...(t.title && { title: t.title }),
                        description: t.description,
                        ...(t.annotations?.readOnlyHint !== undefined && { readOnly: t.annotations.readOnlyHint }),
                        ...(opts.schemas && { inputSchema: t.inputSchema }),
                    })),
                };
            }),
        );

    tools
        .command('describe')
        .description('Show one tool with its full input schema')
        .argument('<name>')
        .addOption(scopeOption())
        .action(
            action(async (ctx, name: string, opts: { scope: McpScope }) => {
                const list = await (await client(ctx, opts.scope)).listTools();
                const tool = list.find((t) => t.name === name);
                if (!tool) {
                    throw new CliError('not_found', `No tool named "${name}" in scope "${opts.scope}"`, {
                        hint: 'Run `perspective tools list` to see available tools.',
                    });
                }
                return tool;
            }),
        );

    tools
        .command('call')
        .description('Call a tool. Arguments come from --input and/or repeated -a key=value (values parsed as JSON when valid).')
        .argument('<name>')
        .option('-i, --input <json>', 'arguments object as JSON, @file or - for stdin')
        .option('-a, --arg <key=value>', 'one argument, repeatable; dots nest (brand.name=Acme)', collect, [])
        .option('--raw', 'print the raw MCP result (content array) instead of the unwrapped value')
        .addOption(scopeOption())
        .action(
            action(
                async (
                    ctx,
                    name: string,
                    opts: { input?: string; arg: string[]; raw?: boolean; scope: McpScope },
                ) => {
                    const args = opts.input ? await readJsonObject(opts.input, '--input') : {};
                    applyAssignments(args, opts.arg);
                    const result = await (await client(ctx, opts.scope)).callTool(name, args);
                    if (result.isError) {
                        throw new CliError('tool_error', `Tool ${name} returned an error`, {
                            details: unwrapToolResult(result),
                        });
                    }
                    return opts.raw ? result : unwrapToolResult(result);
                },
            ),
        );
}
