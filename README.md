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

On **Hostinger** (Phusion Passenger), don't set any `SSL_*` variables — Hostinger terminates HTTPS and assigns the port itself. Passenger loads `server.js` with `require()`, so the entry files must not use top-level `await`. If you see a 503, check hPanel → Node.js → **Runtime logs** for the startup error.

## HTTPS

HTTPS turns on when both `SSL_KEY_PATH` and `SSL_CERT_PATH` are set. The server then listens on port **443** by default (override with `HTTPS_PORT`, or with `PORT` if `HTTPS_PORT` is unset), enforces TLS 1.2+, and sends an HSTS header. Without certificates it serves plain HTTP on `PORT` (default 3000), which is the right mode for managed hosts that terminate TLS for you.

| Variable | Purpose |
| --- | --- |
| `SSL_KEY_PATH` | Private key PEM file (e.g. Let's Encrypt `privkey.pem`). |
| `SSL_CERT_PATH` | Certificate PEM file (e.g. Let's Encrypt `fullchain.pem`). |
| `SSL_CA_PATH` | Optional intermediate CA bundle, if not already in the certificate file. |
| `SSL_PASSPHRASE` | Optional key passphrase. |
| `HTTPS_PORT` | HTTPS listener port; defaults to 443. |
| `HTTP_REDIRECT_PORT` | Optional. Starts an HTTP listener (usually `80`) that 301-redirects to HTTPS. |
| `PUBLIC_HOST` | Optional hostname used for redirects instead of the request `Host` header. Recommended in production. |

```bash
SSL_KEY_PATH=/etc/letsencrypt/live/labs.example.com/privkey.pem \
SSL_CERT_PATH=/etc/letsencrypt/live/labs.example.com/fullchain.pem \
HTTP_REDIRECT_PORT=80 PUBLIC_HOST=labs.example.com npm start
```

Ports below 1024 need elevated privileges. On Linux, grant only the binding capability instead of running as root: `sudo setcap 'cap_net_bind_service=+ep' "$(which node)"`. On Windows, run as an administrator. If one certificate path is missing, the port is unavailable, or a file can't be read, the server exits with a clear error. Restart the process after renewing certificates.

## What is included

- A responsive, searchable package catalogue with light/dark themes and links to each package's npm and source pages.
- A dedicated page per tool, with an overview and a working playground using that tool's published npm package:
  - **Async Slot Pool:** asynchronous concurrency limits, retries, timeouts, reproducible failures, and streamed progress.
  - **ExcelIO:** editable bounded sample data, multi-sheet XLSX generation and download, read-back, optional worker-thread writing, and row validation.
  - **Cache Bridge:** visitor-isolated in-memory LRU cache, per-key TTL, and package-provided cache statistics.
  - **FetchForge:** retries, timeouts, circuit breaking, and response caching against a controlled in-process mock fetch service.
  - **MongoDock:** a live MongoDB playground with streamed batched `bulkWrite`, offset and keyset pagination, aggregation, batch streaming, safety guards, transactions, health checks, and a hook-driven operation log.
- Each tool has its own metadata, page, assets, and optional Express router. Adding a backend-enabled tool requires a `tools/<slug>/` directory containing `tool.json`, `index.html`, `assets/`, and optionally `server.js` exporting an Express router. A browser-only page can omit `server.js`. Tool metadata is validated and discovered at startup, so malformed metadata fails loudly.
- Shared navigation, theme controls, page layout/styles, accessible components, and helpers live in `public/assets/`.

`GET /healthz` provides a lightweight readiness check. `GET /api/tools` returns the discovered public catalogue.

## Demo limits and privacy

Playground runs are manual and temporary; the app has no login, analytics, Redis service, external-URL proxy, arbitrary code runner, or file-upload endpoint. The only database is the optional MongoDock demo database described below. Sample data is processed by the actual package; failures and partial outcomes remain visible.

The app caps JSON requests at 64 KB, public API requests at 60 per IP per minute, active package operations at 8 per process, in-memory demo sessions at 1,000, and idle demo sessions at 15 minutes. ExcelIO accepts up to 75 rows and caps generated workbooks at 1 MB. Cache Bridge sessions are private to one browser and process, hold at most six keys, and do not persist to Redis. FetchForge has a fixed mock service; unmatched URLs cannot leave the process.

### MongoDock demo database

The MongoDock playground needs a real MongoDB. Set `MONGODOCK_DEMO_URI` to a dedicated, disposable database (for example a free MongoDB Atlas M0 cluster: `mongodb+srv://user:pass@cluster.example.mongodb.net/handoo_labs_demo`). On Atlas, allow your host's outbound IP under Network Access. Without the variable, the page loads and shows an "offline" banner; the rest of the site is unaffected.

- All documents live in one collection, `handoo_playground_items`. Every query is scoped to the visitor's session ID, so visitors never see each other's data.
- Each visitor can hold at most 2,000 documents, inserted at most 1,000 per run. A visitor's documents are deleted when their session expires, and a TTL index removes anything older than 60 minutes as a backstop.
- The connection is opened lazily on the first request, retried at most every 15 seconds after a failure, and indexes are created once at connect time. Connection strings are never sent to the browser or logged.
- Transactions need a replica set. Atlas provides one; a standalone server reports the transaction as unsupported instead of failing.
- Use a database user with `readWrite` on that database only.

Limits and sessions are in-memory and per process. This initial release is designed for a single Node.js instance; horizontal scaling needs sticky routing for stateful demonstrations or an intentionally shared session design. All demo content is nonpersistent and disappears on expiration or restart (MongoDock documents expire as described above).

Deploy behind HTTPS on a Node-capable host. Set `TRUST_PROXY_HOPS` to the exact number of trusted reverse proxies in front of Express (default `0`); this lets the IP-based limiter and secure cookies use the real client connection without trusting arbitrary forwarded headers. Keep `NODE_ENV=production`, allow only the application origin, and don't expose the server's demo APIs through an untrusted proxy.

The published ExcelIO package currently depends on ExcelJS 4.4.0, which declares a vulnerable UUID 8 range. The lockfile overrides that transitive dependency to the compatible CommonJS-capable UUID 11.1.1 line; real workbook generation, worker writing, and read-back are covered by the integration tests.