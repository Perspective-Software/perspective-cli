import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { action } from '../command.ts';

/** Same relative path from src/commands and dist/commands. */
export const SKILL_SOURCE = fileURLToPath(new URL('../../skills/perspective/SKILL.md', import.meta.url));

export function registerSkill(program: Command): void {
    const skill = program.command('skill').description('The agent skill (SKILL.md) that teaches coding agents to use this CLI');

    skill
        .command('show')
        .description('Print SKILL.md as {path, content}; `| jq -r .content` gives the markdown')
        .action(action(async () => ({ path: SKILL_SOURCE, content: await readFile(SKILL_SOURCE, 'utf8') })));

    skill
        .command('install')
        .description('Install the skill for Claude Code: ~/.claude/skills/perspective (or ./.claude/skills with --project)')
        .option('--project', 'install into the current project instead of your user directory')
        .option('--dir <path>', 'install into <path>/perspective/SKILL.md (any skills directory)')
        .action(
            action(async (_ctx, opts: { project?: boolean; dir?: string }) => {
                const root = opts.dir
                    ? resolve(opts.dir)
                    : opts.project
                      ? resolve('.claude', 'skills')
                      : join(homedir(), '.claude', 'skills');
                const target = join(root, 'perspective', 'SKILL.md');
                await mkdir(join(root, 'perspective'), { recursive: true });
                // Write a temp file and rename it over the target, so a failed write never leaves half a skill.
                const temp = `${target}.${process.pid}.tmp`;
                try {
                    await writeFile(temp, await readFile(SKILL_SOURCE, 'utf8'));
                    await rename(temp, target);
                } catch (err) {
                    await rm(temp, { force: true });
                    throw err;
                }
                return { ok: true, installed: target };
            }),
        );
}
