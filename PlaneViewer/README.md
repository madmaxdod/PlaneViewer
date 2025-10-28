# PlaneViewer (Vite dev server)

This folder contains the PlaneViewer web app. Vite is already configured in `package.json` with convenient scripts.

Quick start

From inside the `PlaneViewer` folder:

```bash
cd PlaneViewer
npm install    # only needed once to install dependencies
npm run dev -- --host
```

Or from the workspace root (no need to cd):

```bash
npm --prefix PlaneViewer run dev -- --host
```

Then open your browser at:

```
http://localhost:5173
```

Notes
- `--host` allows the dev server to be reachable from other hosts/containers; omit it for local-only binding.
- To build a production bundle: `npm run build` (inside `PlaneViewer`).
- To preview a production build locally: `npm run preview`.
