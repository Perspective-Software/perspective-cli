# perspective-cli — agent notes

- TypeScript, ESM, Node ≥ 22.12. Runtime dependency: `commander` only. Keep it that way;
  the MCP client is hand-rolled on purpose (the hosted server is stateless Streamable HTTP,
  so one POST per JSON-RPC call), avoiding the SDK's server-side dependency tree.
- Contract that must not break: stdout is JSON only (human text goes to stderr via
  `info()`); errors are `CliError` → JSON on stderr; exit codes in `src/errors.ts` are never
  renumbered.
- Every command goes through `action()` in `src/command.ts`.
- Two credentials: API key (`x-perspective-api-key`) for REST `/v1`, OAuth bearer for
  `/mcp`. The server does not accept one for the other.
- Changing a command means updating `skills/perspective/SKILL.md`, `README.md`, and the
  developer docs (`developer-docs/docs/cli/`).
- Verify with `npm run typecheck`, `npm test` and `npm run build`.
