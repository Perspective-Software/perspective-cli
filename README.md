# Perspective CLI

`perspective` drives [Perspective](https://perspective.co) from the shell. It wraps the
[External API](https://developers.perspective.co/api-reference/overview) and is built to be
driven by both people and coding agents: output is JSON, errors are JSON, and exit codes are
stable.

Full docs: <https://developers.perspective.co/cli/overview>

## Install

Requires Node.js ≥ 22.12.

```bash
npm install -g @perspective-software/cli    # or: pnpm add -g @perspective-software/cli
perspective --help
```

## Authenticate

The CLI uses an API key from Perspective → Settings → API Keys.

```bash
perspective auth login                        # prompts for the key, validates it, stores it
printf %s "$KEY" | perspective auth login     # or pipe it in
perspective auth status
```

The key is stored in `~/.config/perspective/credentials.json` (mode 0600). In CI, set
`PERSPECTIVE_API_KEY` instead. Precedence is `--api-key` flag → env → file.

## Use

```bash
perspective funnels list --status live
perspective contacts list <funnelId> --all
perspective contacts list <funnelId> --all --fields id,email,status
perspective contacts create <funnelId> --email ada@example.com --first-name Ada --dry-run
perspective contacts create <funnelId> --email ada@example.com --first-name Ada
perspective metrics kpi <funnelId> conversion_rate --days 7
perspective metrics kpi <funnelId> all --fields type,value,count
perspective metrics chart <funnelId> visitor_devices --from 2026-09-01 --to 2026-10-01
```

Output is pretty-printed at a terminal and compact when piped (`--pretty` / `--no-pretty`).
`--fields a,b,c.d` keeps only those fields of each result. `--dry-run` on `contacts create`
and `contacts set` prints the request instead of sending it. On HTTP 429 the CLI waits
(`Retry-After`, at most a minute) and retries up to 3 times.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | API error |
| 2 | usage error (bad flags/arguments, HTTP 400) |
| 3 | not authenticated (HTTP 401) |
| 4 | forbidden (HTTP 403) |
| 5 | not found (HTTP 404) |
| 6 | rate limited (HTTP 429, 100 requests/minute) |
| 7 | network error |

Errors go to stderr as `{"error":{"code","message","status?","hint?"}}`.

## Agents

[`skills/perspective/SKILL.md`](skills/perspective/SKILL.md) teaches coding agents (Claude Code and
anything else that reads Agent Skills) how to use the CLI safely. Install it with:

```bash
perspective skill install            # ~/.claude/skills/perspective/SKILL.md
perspective skill install --project  # ./.claude/skills/perspective/SKILL.md
perspective skill show               # print it (JSON; | jq -r .content)
```

## Development

```bash
pnpm install                         # also builds dist/ via `prepare`
pnpm test
pnpm typecheck
pnpm dev funnels list                # run from source (Node's type stripping)
perspective --base-url http://localhost:3000 …   # point at a local External API
```

Layout: `src/cli.ts` (entry) · `src/commands/*` (one file per command group) · `src/rest.ts`
(API client) · `src/context.ts` (credential resolution) · `skills/perspective/SKILL.md`.

When you add or change a command, update `SKILL.md` and the docs in
`Perspective-Software/developer-docs` (`docs/cli/`) in the same change.
