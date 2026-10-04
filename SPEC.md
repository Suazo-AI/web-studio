# Product and security contract

## Source scope
One configured, owned project; one HTML page and CSS file. Snapshot hashes must match the manifest during every build. The source manifest maps element selectors, editable text spans and original line/offset locations. Text edits HTML-escape input. Styles are appended using fixed source-derived selectors. No DOM-only mutation is represented as a source save.

## Durable drafts
D1 stores one owner-bound aggregate per project, bound to an immutable SHA-256 fingerprint of source HTML/CSS and manifest asset hashes. A mismatched build fails closed, including previews. Legacy edited state without a fingerprint requires explicit migration under the original source; only pristine r0 can bind automatically. A version-checked SQL UPDATE is the only state commit. Revisions are immutable edit maps with an explicit parent; undo/redo/restore append revisions. A stale head or concurrent aggregate write is rejected. Limits: 100 revisions, 100 outstanding proposals, 200 feedback items, 50 replies/item, 50 taste proposals, 2 MB aggregate JSON. Canceled proposals are explicitly discarded. Repeated apply/reply with identical idempotency scope is safe.

## Auth
All private UI, source, preview and data calls require an exact match between trusted `oai-authenticated-user-id` and `EDITOR_OWNER_USER_ID`. Ownership is never inferred from the first visitor. MCP initialization and tool discovery disclose only generic tool metadata. D1 project ownership is checked again. No service credential substitutes for a user identity. Cross-origin application writes are rejected.

## Preview
Opaque iframe, `sandbox="allow-scripts"`; no same-origin, forms, popup or top-navigation permissions. Preview response also uses CSP sandbox. No source scripts/events, form actions, links, active embeds or remote URLs execute. Approved local image/font assets become data URLs. CSP disables connections. Selection bridge checks frame window, null origin, project, revision and random nonce. The bridge reports only fixed properties and bounded selected geometry.

## Taste and source integration
Taste decisions are explicitly project-scoped. Experiments and proposals cannot auto-approve taste. A real source commit/deployment requires a separately authorized human review/integration outside this editor. Exports mark draft-only and state their source revision. No credential creation, app installation or publication happens here.

## Privacy split
Public: generic engine, editor UI, MCP adapters, tests, synthetic example, blank taste template.
Private: real source, images, source provenance, taste, comments, revisions, generated bundles and screenshots. Never copy private data into public history or CI output. Public-core export uses an explicit allowlist and data-leak checks, not `.gitignore` alone.
