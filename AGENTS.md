# perspective-cli — agent notes

- TypeScript, ESM, Node ≥ 22.12. Runtime dependency: `commander` only. Keep it that way.
- Scope: a wrapper for the External API (`/v1`, `x-perspective-api-key`) and nothing else.
  The MCP server is a separate product for chat assistants; don't add MCP or OAuth here.
- Contract that must not break: stdout is JSON only (prompts and other human text go to
  stderr); errors are `CliError` → JSON on stderr; exit codes in `src/errors.ts` are never
  renumbered.
- Every command goes through `action()` in `src/command.ts`.
- Changing a command means updating `skills/perspective/SKILL.md`, `README.md`, and the
  developer docs (`developer-docs/docs/cli/`).
- Use pnpm, not npm. Verify with `pnpm typecheck`, `pnpm test` and `pnpm build`.
