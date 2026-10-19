---
name: perspective
description: Operate a Perspective account (perspective.co funnel builder) from the shell with the `perspective` CLI — find funnels, read and write CRM contacts, pull funnel KPIs/charts/insights, and call any Perspective MCP tool (create/edit/publish AI funnels, email sequences, brands, email stats). Use when the user asks about their Perspective funnels, leads/contacts, conversion metrics or sequences, or wants to script Perspective.
---

# Perspective CLI

`perspective` wraps the Perspective External API (REST, `/v1`) and the hosted
Perspective MCP server. Every command prints **JSON on stdout**; errors print
**JSON on stderr** with a non-zero exit code. Pipe into `jq` freely.

Docs: https://developers.perspective.co/cli/overview

## 0. Check setup first

```bash
perspective auth status
```

- `rest.authenticated: false` → REST commands (`workspaces`, `funnels`, `contacts`, `metrics`) will fail.
  Ask the user for an API key (Perspective → Settings → API Keys, admins only), then
  `printf %s "$KEY" | perspective auth login --with-api-key` or export `PERSPECTIVE_API_KEY`.
- `mcp.authenticated: false` → `tools` commands will fail. The user must run
  `perspective auth login` themselves (opens a browser). You cannot complete
  that flow headlessly; in CI use `PERSPECTIVE_TOKEN`.

Never print, log or commit an API key or token.

## 1. Find IDs

Almost everything takes a `funnelId`. Get it first:

```bash
perspective funnels list --name "webinar"          # flat list: id, name, status, workspaceId
perspective workspaces list                         # nested: workspaces → campaigns
```

## 2. REST commands (API key)

```bash
# Contacts
perspective contacts list <funnelId> --limit 100 --sort email --order asc
perspective contacts list <funnelId> --all          # every page, {data, meta.total}
perspective contacts get <funnelId> <contactId>
perspective contacts create <funnelId> --email a@b.co --first-name Ada -s address.city=Berlin
perspective contacts set <funnelId> <contactId> status qualified   # any field or custom property

# Metrics — default window is the last 30 days in local time
perspective metrics kpi <funnelId> conversion_rate
perspective metrics kpi <funnelId> new_contacts --from 2026-09-01 --to 2026-10-01
perspective metrics chart <funnelId> page_to_page_conversion_rate --ab-test variant
perspective metrics insight <funnelId> question_1234 --days 7
perspective metrics subtypes                        # valid kpi/chart names
```

Pagination for `contacts list` is page-based: read `meta.hasNext`, bump `--page`, or just use `--all`.

## 3. MCP tools (OAuth login) — everything else

Funnel creation/editing/publishing, email sequences, brands, domains, senders,
email stats and image uploads exist **only** as MCP tools. Discover, then call:

```bash
perspective tools list                               # names + descriptions
perspective tools list --scope analytics             # scopes: all, funnel-build, sequences, analytics, crm
perspective tools describe create_funnel             # full JSON input schema — read it before calling
perspective tools call list_brands
perspective tools call get_funnel_stats -a funnelId=<id> -a dateFrom=2026-10-01T00:00:00Z
perspective tools call create_funnel --input @brief.json
echo '{"jobId":"…"}' | perspective tools call get_funnel_job_status --input -
```

- `-a key=value` values are parsed as JSON when valid (`-a limit=20`, `-a noBrand=true`); dots nest (`-a data.name=Spring`).
- `--input` takes inline JSON, `@file`, or `-` (stdin); `-a` overrides it.
- Output is the tool's structured result, or its text parsed as JSON. `--raw` gives the MCP content array.
- A tool-level failure exits 1 with `error.code: "tool_error"` and the tool's message in `error.details`.

### Recipe: build an AI funnel

1. `tools call list_brands` → pick a brand with the user (or confirm they want none).
2. `tools describe create_funnel` → follow the description; it asks for a rich brief.
3. `tools call create_funnel --input @brief.json` → returns `jobId`, `funnelId`.
4. Poll `tools call get_funnel_job_status -a jobId=<jobId>` (long-polls ~20 s) until completed.
5. Edits: `tools call update_funnel -a funnelId=<id> -a prompt="…"`. Publishing: `update_funnel_metadata`.

## Exit codes

| Code | `error.code` | Meaning / what to do |
|---|---|---|
| 0 | — | Success |
| 1 | `error`, `tool_error` | API or tool error — read `error.message` / `error.details` |
| 2 | `usage` | Bad arguments or 400 from the API — fix the call (see `error.hint`) |
| 3 | `unauthenticated` | Missing/invalid credentials — see step 0 |
| 4 | `forbidden` | Key lacks the permission (`crm:read`, `crm:write`, `metrics:read`) or plan |
| 5 | `not_found` | Wrong funnel/contact/tool ID — re-discover IDs |
| 6 | `rate_limited` | 100 requests/minute — wait and retry; prefer `--all` over many small calls |
| 7 | `network` | API unreachable |

## Rules for agents

- **Read before you write.** `contacts create`, `contacts set`, and tools that create, update, publish, unpublish or send act on a live account: they can trigger automations and emails to real people, and change public pages. Confirm with the user before running them unless they explicitly asked for that exact change. Use `--skip-automation` when the user wants data changes without side effects.
- Prefer the narrowest command: REST commands for contacts/metrics, `tools` only for what REST lacks.
- Use `tools describe <name>` instead of guessing argument names; schemas change.
- Dates are ISO 8601. Metrics windows: `--from/--to`, or `--days N` (default 30).
- Global flags: `--base-url`, `--api-key`, `--token`, `--pretty`/`--no-pretty`.
