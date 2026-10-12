# Handoo Labs

A small, modular home for interactive playgrounds built around the real Handoo Labs npm packages. The site uses plain HTML, CSS, and browser JavaScript; one Node.js/Express server serves the pages and bounded demo APIs.

## Run locally

Requires Node.js 22 or later (Node.js 24 is recommended).

```sh
npm install
npm start
```

Open <http://localhost:3000>. Use `npm run dev` for Node's built-in watch mode, `npm test` for the integration suite, and `npm run check` for a server syntax check. Set `PORT` to change the listener port.

## Deployment settings

Use application type **Express**, Node.js **22 or later**, and entry file **`server.js`** at the repository root. No build command or output directory is required. If your host uses a start command instead, use `npm start`. The server reads the host-provided `PORT` environment variable.

The root entry point and `node server/app.js` both use the same startup function. Deploy the entire repository, including `public/` and `tools/`, rather than only the server files.

## What is included

- A responsive, searchable package catalogue with light/dark themes and links to each package's npm and source pages.
- A dedicated page per tool, with an overview and a working playground using that tool's published npm package:
  - **Async Slot Pool:** asynchronous concurrency limits, retries, timeouts, reproducible failures, and streamed progress.
  - **ExcelIO:** editable bounded sample data, multi-sheet XLSX generation and download, read-back, optional worker-thread writing, and row validation.
  - **Cache Bridge:** visitor-isolated in-memory LRU cache, per-key TTL, and package-provided cache statistics.
  - **FetchForge:** retries, timeouts, circuit breaking, and response caching against a controlled in-process mock fetch service.
- Each tool has its own metadata, page, assets, and optional Express router. Adding a backend-enabled tool requires a `tools/<slug>/` directory containing `tool.json`, `index.html`, `assets/`, and optionally `server.js` exporting an Express router. A browser-only page can omit `server.js`. Tool metadata is validated and discovered at startup, so malformed metadata fails loudly.
- Shared navigation, theme controls, page layout/styles, accessible components, and helpers live in `public/assets/`.

`GET /healthz` provides a lightweight readiness check. `GET /api/tools` returns the discovered public catalogue.

## Demo limits and privacy

Playground runs are manual and temporary; the app has no login, analytics, database, Redis service, external-URL proxy, arbitrary code runner, or file-upload endpoint. Sample data is processed by the actual package; failures and partial outcomes remain visible.

The app caps JSON requests at 64 KB, public API requests at 60 per IP per minute, active package operations at 8 per process, in-memory demo sessions at 1,000, and idle demo sessions at 15 minutes. ExcelIO accepts up to 75 rows and caps generated workbooks at 1 MB. Cache Bridge sessions are private to one browser and process, hold at most six keys, and do not persist to Redis. FetchForge has a fixed mock service; unmatched URLs cannot leave the process.

Limits and sessions are in-memory and per process. This initial release is designed for a single Node.js instance; horizontal scaling needs sticky routing for stateful demonstrations or an intentionally shared session design. All demo content is nonpersistent and disappears on expiration or restart.

Deploy behind HTTPS on a Node-capable host. Set `TRUST_PROXY_HOPS` to the exact number of trusted reverse proxies in front of Express (default `0`); this lets the IP-based limiter and secure cookies use the real client connection without trusting arbitrary forwarded headers. Keep `NODE_ENV=production`, allow only the application origin, and don't expose the server's demo APIs through an untrusted proxy.

The published ExcelIO package currently depends on ExcelJS 4.4.0, which declares a vulnerable UUID 8 range. The lockfile overrides that transitive dependency to the compatible CommonJS-capable UUID 11.1.1 line; real workbook generation, worker writing, and read-back are covered by the integration tests.