---
name: perspective
description: Read and write a Perspective account (perspective.co funnel builder) from the shell with the `perspective` CLI, a wrapper for the Perspective External API — list workspaces and funnels, read and write CRM contacts, and pull funnel KPIs, charts and question insights. Use when the user asks about their Perspective funnels, leads/contacts or conversion metrics, or wants to script Perspective.
---

# Perspective CLI

`perspective` wraps the Perspective External API (`https://api.perspective.co/v1`).
Every command prints **JSON on stdout**; errors print **JSON on stderr** with a
non-zero exit code. Pipe into `jq` freely.

Docs: https://developers.perspective.co/cli/overview

## 0. Check setup first

```bash
perspective auth status
```

If `authenticated` is `false`, every other command fails with exit code 3. Ask the
user for an API key (Perspective → Settings → API Keys, admins only). They can run
`perspective auth login` themselves (it prompts for the key), or you can pipe it in:
`printf %s "$KEY" | perspective auth login`. `PERSPECTIVE_API_KEY` works too.

Never print, log or commit an API key.

## 1. Find IDs

Almost everything takes a `funnelId`. Get it first:

```bash
perspective funnels list --name "webinar"          # flat list: id, name, status (draft|live|offline), workspaceId
perspective workspaces list                         # nested: workspaces → campaigns
```

## 2. Contacts

```bash
perspective contacts list <funnelId> --limit 100 --sort email --order asc
perspective contacts list <funnelId> --all          # every page, {data, meta.total}
perspective contacts get <funnelId> <contactId>
perspective contacts create <funnelId> --email a@b.co --first-name Ada -s address.city=Berlin
perspective contacts set <funnelId> <contactId> status qualified   # any field or custom property
```

Pagination is page-based: read `meta.hasNext`, bump `--page`, or just use `--all`.
The CLI waits and retries by itself when it hits the rate limit.
`-s key=value` values are parsed as JSON when valid (`-s score=5`); dots nest (`-s address.city=Berlin`).

## 3. Metrics

The default window is the last 30 days in local time.

```bash
perspective metrics kpi <funnelId> conversion_rate
perspective metrics kpi <funnelId> conversion_rate total_sessions   # several → {data: [...]}, each with its type
perspective metrics kpi <funnelId> all --fields type,value,count    # every KPI in one call
perspective metrics kpi <funnelId> new_contacts --from 2026-09-01 --to 2026-10-01
perspective metrics chart <funnelId> page_to_page_conversion_rate --ab-test variant
perspective metrics insight <funnelId> question_1234 --days 7
perspective metrics subtypes                        # valid kpi/chart names
```

What a KPI's `value` means:

| KPI | `value` | `count` |
|---|---|---|
| `conversion_rate`, `completion_rate` | % of sessions (0–100) | conversions / completions |
| `messages_delivery_rate`, `messages_open_rate` | % of messages (0–100) | the events behind the rate |
| `average_time_on_page` | seconds (average over pages of each page's median) | — |
| `time_to_completion` | seconds, median from first page to completion | — |
| `new_contacts`, `total_sessions`, `messages_sent` | count | — |

A rate on a handful of sessions means little: before you rank or compare funnels,
fetch `total_sessions` with it (`kpi <id> conversion_rate total_sessions`) and
mention low sample sizes. `metrics insight` needs the question's element ID from
the funnel builder; there is no way to list them, so ask the user. An unknown
ID returns an empty result, not an error.

## Keep output small

Contact lists can be large. Ask only for the fields you need — `--fields` works on
every command, keeps `meta`, and dots reach into nested objects:

```bash
perspective contacts list <funnelId> --all --fields id,email,status,properties.city
perspective funnels list --status live --fields id,name
```

## Exit codes

| Code | `error.code` | Meaning / what to do |
|---|---|---|
| 0 | — | Success |
| 1 | `error` | API error — read `error.message` |
| 2 | `usage` | Bad arguments or 400 from the API — fix the call (see `error.hint`) |
| 3 | `unauthenticated` | Missing/invalid API key — see step 0 |
| 4 | `forbidden` | Funnel ID wrong or in another workspace (re-check with `funnels list`), or the key lacks a permission (`crm:read`, `crm:write`, `metrics:read`) |
| 5 | `not_found` | Wrong funnel or contact ID — re-discover IDs |
| 6 | `rate_limited` | 100 requests/minute; the CLI already retried — wait a minute; prefer `--all` over many small calls |
| 7 | `network` | API unreachable |

## Rules for agents

- **Read before you write.** `contacts create` and `contacts set` act on a live account and can trigger automations and emails to real people. Run them with `--dry-run` first, show the user the printed request, and send it only after they confirm — unless they explicitly asked for that exact change. Pass `--skip-automation` to either command when the user wants data without side effects.
- Dates are ISO 8601. Metrics windows: `--from/--to`, or `--days N` (default 30).
- Global flags: `--fields`, `--base-url`, `--api-key`, `--pretty`/`--no-pretty`.
