# Deployment checklist (not executed)

1. Review implementation, license and the clean-core publication boundary separately. Public code is not authorization to publish project data.
2. Create a new private Site; never reuse a customer's public Site. Set `project_id` only after registration and retain `capabilities: ["mcp"]`, logical `d1: "DB"`.
3. Use Sites authentication. Configure `EDITOR_OWNER_USER_ID` from the verified owner identity; do not guess it or automatically claim a visitor. Keep the Site audience private. Do not put identity/credentials in source.
4. Generate and review Drizzle migrations; apply schema before Worker publication. There is no runtime CREATE/ALTER TABLE.
5. Build in a private execution context with the intended private project directory. The default demo build has only synthetic data. Never put private build artifacts on public CI.
6. Use supported Sites save/publish flow only after authorization. Verify unauthenticated and wrong-user access, real D1 persistence across reloads, source edit/undo and responsive UI in the deployed private environment.
7. Reuse Sites' automatically provisioned App/private plugin. Fetch its actual connection metadata and use the normal installation/connection UI. Creating or expanding persistent grants requires the relevant user approval. Verify with a read-only `list_projects` after connection.
8. Live source writes and deployment of edited websites remain outside this MVP. A human reviews exported changes against the base revision, integrates into the real repo and runs that repo's tests under separate authorization.

## Binding and protocol

- `DB`: D1, schema in `db/schema.ts`, generated migrations in `drizzle/`
- `EDITOR_OWNER_USER_ID`: required exact Site-scoped owner identity
- `/mcp`: stateless HTTP POST JSON-RPC, initialize / tools/list / tools/call
- `/api/project`, `/api/action`: same-owner UI data operations
- `/preview`: authenticated source-backed, sandboxed visual view

No API keys, OAuth tokens, remote runner, R2 bucket or external network egress are required. The application does not send telemetry.
