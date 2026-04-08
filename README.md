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
