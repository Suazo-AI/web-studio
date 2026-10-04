# Web Studio (private-first visual editor MVP)

A generic, source-backed visual editor and stateless MCP endpoint. It uses an immutable HTML/CSS source fixture, a sandboxed visual preview, allowlisted changes and persistent draft revisions. It does **not** edit live websites, run arbitrary source code or publish changes.

## Run the synthetic demo

Requirements: Node 24.19+, npm, Chromium for browser tests.

1. `npm ci --ignore-scripts --cache /tmp/atelier-npm-cache`
2. `npm run build`
3. `npm test`
4. `npm run dev` (loopback only; development identity adapter is excluded from production)
5. `npm run test:e2e` (stop the interactive dev server first; test server uses an isolated in-memory database)

The default build uses only `examples/studio-demo`. All content in that fixture is synthetic. The browser tests generate screenshots only from this synthetic demo.

## Private project inputs

A local owner can set `EDITOR_PROJECT_DIR` to a private project directory at **build time**. This is not a web/API parameter. Required structure:

- `project.json`: bounded project ID, display metadata, project-scoped approved taste
- `snapshot/manifest.json`: source provenance and exact SHA-256 file hashes
- `snapshot/src/index.html`, `snapshot/src/styles.css`
- Optional explicitly included `snapshot/src/assets/*`

Keep this directory outside public source/history, or in `.private-projects/` while working locally. Private builds embed project bytes in `.local/` and `dist/`; these outputs must stay private. A private build must never run in public CI or generate public screenshots/artifacts.

Runtime source loading is deliberately absent. There is no arbitrary URL fetch, repository checkout, filesystem API or shell tool.

## What works

- Select directly in the canvas or layer list, with bounded source locations and stable IDs
- Double-click safe plain-text editing; drag to reposition using bounded margins in normal flow
- Resize handles change text size; accessible buttons and inspector provide keyboard alternatives
- Desktop/tablet/mobile scoped style changes; text is shared across viewports
- Direct Save applies source-backed changes without an agent prompt, with exact SHA-256 hashes
- Multi-step unsaved undo/redo plus immutable saved revision history
- Read-only `list_saved_changes` and `get_revision` expose structured before/after audit to an agent
- Text, type, color, spacing and radius overrides from a strict whitelist
- Desktop, tablet and mobile visual widths; original/draft comparison
- Proposed diff review, persistent save, stale-revision rejection
- Undo, redo and restore creating new immutable revisions
- Comments and incremental feedback reads/replies
- Approved project taste plus proposals that remain pending human approval
- JSON patch package with exact revised HTML/CSS, provenance and review requirement
- Exact `web-taste.md` export containing approved decisions only
- Stateless MCP initialize, discovery and tool calls

## What is deliberately absent

Live Git/source writes, deployment, arbitrary imports/URLs, free-positioned/absolute layout authoring, image replacements, Figma integration, portfolio aggregation, arbitrary CSS/JavaScript and real site transactions. Interactive application behavior is removed from the isolated visual preview; the exported source preserves original behavior bytes except the explicitly approved text edits and appended style overrides.

## Deployment boundary

No Site is registered or deployed by this repository. See `docs/DEPLOYMENT.md`. Production uses Sites trusted identity + an explicitly configured owner and D1. Auth fails closed if either is missing. The local development adapter must never be exposed publicly.

## Public-core preparation

`node scripts/export-core.mjs` creates a new clean source directory from an explicit allowlist and scans it for private fixture bytes and identifiers. It excludes all generated bundles, private inputs, runtime state, screenshots and Git history. Review the output before creating any public repository. The generic core is MIT; private project data is excluded. Do not publish the entire working directory.

The architectural reference is Lavish AXI 0.1.81 at commit `2ca57ddf12101fd561f6bf75c7cb6e0856c14cd5`, MIT, © 2026 Kun Chen. No upstream CLI/server was installed or executed; its Node server is not used in the Worker. Public reference skill and notices are preserved in `docs/`. See `docs/LICENSE-STATUS.md` for the licensing boundary.

Use `docs/WEB-CONTENT-CHECKLIST.md` alongside each private project taste file for a 15-point evidence-backed content review. This is a review reference, not automated SEO or a ranking promise.

## Direct editing controls

Select text, then double-click or choose Texto to edit. Drag the text or the move handle to change positive margins within normal flow. Drag the bottom-right handle to change font size. The arrow and A−/A+ buttons work with keyboard activation; move-handle arrow keys use 1px (Shift: 10px). Enter finishes text; Escape cancels text or an active gesture. Ctrl/Cmd+S saves the current source draft. Text input keeps its native undo; outside text input Ctrl/Cmd+Z and Shift+Z use the draft history. Pointer cancellation rolls back the unfinished gesture.

Style edits apply only to the selected preview width (desktop ≥1024px, tablet 768–1023px, mobile ≤767px). Text applies to every width. Movements are bounded positive margins, not free-positioned layers; resize changes typography, not the box. Existing project CSS still controls layout. Review every target width before separately integrating a draft into a live website.

Save is a UI-only atomic action; it is not an MCP tool. The agent can read the saved diff, revision hash and exact exported source, but receiving a change creates no deployment or mutation side effect. The old proposal/review API remains available as an explicit separate workflow. Stale saves retain local work and offer a download before reload.
