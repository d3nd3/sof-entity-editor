# SoF Entity Editor

## Development (Vite dev server)

```bash
npm install
npm run dev
```

Then open the URL shown in the terminal (usually `http://localhost:5173`).

## Production build (not dev mode)

Build the app, then serve the compiled output from `dist/`:

```bash
npm install
npm run build
npm run preview
```

Open the URL printed by Vite Preview (usually `http://localhost:4173`). This runs the **production** bundle—the same artifacts you would deploy—unlike `npm run dev`, which uses the dev server and hot reload.

To build only without starting a server:

```bash
npm run build
```

Static files are written to `dist/`.

## Deploy: what/where/how

This project is a **frontend-first Vite app**. `npm run build` outputs static files in `dist/` (`index.html`, JS, CSS), so you can deploy to any static host:

- GitHub Pages
- Netlify
- Vercel (static)
- Cloudflare Pages
- Any Nginx/Apache/static file server

Typical deploy flow:

```bash
npm install
npm run build
```

Then upload/publish the `dist/` folder to your host.

### Does it require a backend?

- **For basic viewer/editor use:** no backend is required (static hosting is enough).
- **For live profile file writes to disk (`entity-profiles/...`):** yes, that behavior is **dev-only** and uses the Vite dev server middleware endpoint (`/api/save-entity-profile` / `/api/load-entity-profile`).
  - This works when running `npm run dev` locally.
  - In a static deployment, those dev-only endpoints do not exist.
