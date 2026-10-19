# Perspective CLI

`perspective` drives [Perspective](https://perspective.co) from the shell. It covers the
[External REST API](https://developers.perspective.co/api-reference/overview) and every tool of
the [MCP server](https://developers.perspective.co/mcp/overview), and it is built to be driven
by both people and coding agents: output is JSON, errors are JSON, and exit codes are stable.

Full docs: <https://developers.perspective.co/cli/overview>

## Install

Requires Node.js ≥ 22.12.

```bash
npm install -g github:Perspective-Software/perspective-cli
perspective --help
```

## Authenticate

Two credentials, one per API surface:

| Command | Credential | Unlocks |
|---|---|---|
| `perspective auth login` | OAuth (browser login, refreshed automatically) | `tools …` (MCP: funnels, sequences, brands, stats, …) |
| `perspective auth login --with-api-key` | API key from Settings → API Keys (read from stdin) | `workspaces`, `funnels`, `contacts`, `metrics` |

```bash
perspective auth login                                   # opens the browser
printf %s "$KEY" | perspective auth login --with-api-key # stores and validates an API key
perspective auth status
```

Credentials are stored in `~/.config/perspective/credentials.json` (mode 0600). In CI, set
`PERSPECTIVE_API_KEY` and/or `PERSPECTIVE_TOKEN` instead. Precedence is flag → env → file.

## Use

```bash
perspective funnels list --status online
perspective contacts list <funnelId> --all
perspective contacts create <funnelId> --email ada@example.com --first-name Ada
perspective metrics kpi <funnelId> conversion_rate --days 7
perspective metrics chart <funnelId> visitor_devices --from 2026-09-01 --to 2026-10-01

perspective tools list --scope funnel-build
perspective tools describe create_funnel
perspective tools call get_funnel_stats -a funnelId=<funnelId>
perspective tools call create_funnel --input @brief.json
```

Output is pretty-printed at a terminal and compact when piped (`--pretty` / `--no-pretty`).

### Exit codes

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | API or tool error |
| 2 | usage error (bad flags/arguments, HTTP 400) |
| 3 | not authenticated (HTTP 401) |
| 4 | forbidden (HTTP 403) |
| 5 | not found (HTTP 404) |
| 6 | rate limited (HTTP 429, 100 requests/minute) |
| 7 | network error |

Errors go to stderr as `{"error":{"code","message","status?","hint?","details?"}}`.

## Agents

[`skills/perspective/SKILL.md`](skills/perspective/SKILL.md) teaches coding agents (Claude Code and
anything else that reads Agent Skills) how to use the CLI safely. Install it with:

```bash
perspective skill install            # ~/.claude/skills/perspective/SKILL.md
perspective skill install --project  # ./.claude/skills/perspective/SKILL.md
perspective skill show               # print it
```

## Development

```bash
npm install          # also builds dist/ via `prepare`
npm test
npm run typecheck
npm run dev -- funnels list          # run from source (Node's type stripping)
perspective --base-url http://localhost:3000 …   # point at a local External API
```

Layout: `src/cli.ts` (entry) · `src/commands/*` (one file per command group) · `src/rest.ts`
(REST client) · `src/mcp.ts` (stateless MCP JSON-RPC client) · `src/oauth.ts` (PKCE loopback
login) · `src/context.ts` (credential resolution) · `skills/perspective/SKILL.md`.

When you add or change a command, update `SKILL.md` and the docs in
`Perspective-Software/developer-docs` (`docs/cli/`) in the same change.
