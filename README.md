# sof-entity-editor

Web viewer/editor for Soldier of Fortune BSP v46 maps and entity strings. See [docs/bsp-sof.md](docs/bsp-sof.md) for format notes.

```bash
npm install
npm run dev
```

## Maps from GitHub

Under **sof1maps**, choose a **folder** (e.g. `dm`) and type a **map** name (e.g. `doom2sof`) or a full repo path (e.g. `exp/somepack.zip`). The app resolves it to a zip on [plowsof/sof1maps](https://github.com/plowsof/sof1maps), downloads it, and extracts the `.bsp`. You can also open a local `.bsp` file.

With **Load default map on open** checked, it loads `dm/doom2sof` on startup.

## Viewport controls

Click the 3D view (not a text field) so keyboard navigation applies.

| Action | Input |
|--------|--------|
| **Look around (FPS)** | hold **right mouse button** and drag — rotates the camera **in place** (yaw / pitch), like an in-game view |
| Fly forward / back / strafe | **W S A D** or **arrow keys** (along current view direction) |
| Fly “up” / “down” in view | **E** / **Q** |
| Faster movement | hold **Alt** |
| Pan sideways / vertically | **middle mouse** drag |
| Zoom | **mouse wheel** (move along view) |
| Clear entity selection | **Escape** |
| Pick entity | **left-click** a marker or list entry |
| Move entity | **drag** the transform gizmo on the selection |

Click the 3D view first so keyboard focus isn’t in a text field.

Maps and entities use the game’s **Z-up** coordinates; the viewer converts to **Y-up** with `(x,y,z) → (x,z,-y)` so orientation matches the game client (not mirrored left–right).

**Download cache:** Fetched `.zip` files are stored in the browser’s **IndexedDB** (database name **`sof-entity-editor`**, object store **`sof1maps-zips`**). Nothing is written under your project directory — open **DevTools → Application** (Chrome) or **Storage** (Firefox) → **IndexedDB** to inspect. After **Download & load**, the status line says whether the zip came from cache or the network. If cache writes fail (strict privacy mode), check the browser console for a warning. The repo’s `.cache/` in `.gitignore` is only for optional future on-disk tools, not the live web app.

## Entities

**Add entity**: type a classname (browser autocomplete uses the bundled [`entities.txt`](entities.txt) list) and click **Insert at view center**. The new entity’s `origin` is placed **along your view** (~320 units in front of the camera). Export writes `<mapname>_ent.txt`.
