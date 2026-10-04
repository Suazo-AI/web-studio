# Editor V2 isolated milestone

V2 runs at `/v2` alongside unchanged V1 `/`. It uses a separate `:editor-v2` storage key and a versioned LayerDocument. No existing project/schema changes, Site publishing, source repository writes, automatic migration, provider keys or domain changes occur.

## Acceptance

1. Selecting any supported layer and pressing Delete/Backspace removes the entire selected layer subtree. A tombstone persists across save/reload/export. Text-field Delete/Backspace remains native.
2. Plain text can be intentionally empty. Blur, selection changes, save/reload and export preserve the empty value. Empty does not mean absent.
3. Visible Undo/Redo plus Ctrl/Cmd+Z, Shift+Z, Ctrl+Y. Native editing undo stays native while text fields are focused. A gesture is one history step. Revisions are immutable; writes use expected revision + CAS.
4. Ctrl/Cmd+C/X/V duplicates/moves safe supported source layers only. Browser text copying/pasting stays native. Clipboard denial has explicit in-editor fallback; arbitrary HTML is never accepted.
5. Source-backed layer graph exposes actual parents/order for safe source components, including images and review containers. Review evidence text stays locked. Reordering/reparenting rejects cycles and unsafe content-model changes.
6. Flow mode changes actual sibling order; it never represents movement as positive margins. Free mode is explicit, uses signed coordinates inside a positioned parent, and is viewport scoped. Mobile remains flow unless explicitly changed. Drag moves, not resizes.
7. Changes render immediately and persist automatically as draft revisions; Save is also available. Local recovery survives a failed request and reports revision conflicts instead of overwriting another tab.
8. Export returns exact source files and SHA-256 hashes with explicit review/integration requirement. Deployment remains separate.
9. V1 remains test-covered and behavior/schema compatible. Explicit migration is a separate copy operation with source-binding validation; it never modifies original history.
10. Synthetic-only browser tests exercise real keydown, blur, deletion/undo/reload, clipboard, structural movement, mobile and desktop screenshots/video. Private inputs never enter public source, CI or artifacts.

## Scope and limits

This milestone is a bounded HTML/CSS editor, not complete Figma parity. Unsupported active widgets remain outside the selectable graph. Arbitrary CSS, external imports, runtime URL fetching, generated fonts/images, domain management and publishing are future modules. Free-position desktop layouts need mobile review before export. The baseline source's own CSS continues to govern flow.

Source absolute/fixed positioning is displayed as inherited source positioning.
It is not silently converted to V2 coordinates: the user must explicitly choose
Flow or Free first, because a new parent-relative containing block can change layout.
