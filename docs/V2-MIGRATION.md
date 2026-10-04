# V2 migration and rollout boundary

The V2 implementation is additive. V1 code, source fixture, project key and revision
shape remain unchanged. V2 uses `/v2`, `/api/v2/*`, `/mcp/v2`, and a separate
`<project-id>:editor-v2` database key. No SQL schema migration is required.

## Explicit copy

1. Keep the same frozen snapshot and approved asset manifest.
2. Back up the private V1 database and source outside public source/CI.
3. In an empty V2 namespace only, choose the exact V1 saved revision.
4. The server validates the V1 source fingerprint, maps existing edits by exact
   source offsets and creates a new immutable V2 revision. It does not rewrite V1.
5. Review the source diff, text locks, desktop/tablet/mobile preview and exported
   SHA-256 file hashes. A failed copy leaves the original V1 state untouched.
6. Roll back by reopening V1. Do not delete or overwrite old history.

Private production migration, registration as a new plugin, custom-domain changes,
merging and deployment are separate actions. This source milestone does none of them.
The V2 MCP endpoint is read-only and returns versioned source-backed graph/history
and exact exports, so an agent can inspect drafts without deploying them.

## Deferred modules

- Font catalog: version-pinned metadata from open catalogs, per-font license and
  reserved-name records, selected self-hosted asset hashes, lazy previews
- Font creation: independent glyph/design/export workflow with actual binary
  validation; an SVG or renamed file is not a valid generated font
- Image generation: provider adapter only with authorized server credentials and
  explicit billing. ChatGPT sign-in token sharing does not supply image generation
- Domain: native Sites custom domain configuration when explicitly requested;
  ownership/DNS verification precedes any changes

No provider key, login token, payment flow, external font fetch or DNS action is
part of this milestone.
