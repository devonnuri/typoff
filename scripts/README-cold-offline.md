# Preview/export and cold-offline regression

Build the production app, start `npm run preview -- --host 127.0.0.1`, then run:

```sh
TYPOFF_URL=http://127.0.0.1:4173 \
TYPOFF_REPORT=/path/to/report.json \
node scripts/verify-cold-offline.mjs
```

The script uses fresh Chromium storage, observes requests from the page, workers,
and service worker, records request timing and exposed response body sizes, and
records static asset sizes. It verifies:

- cold editor and preview startup;
- compiler WASM in the activated service worker's precache;
- offline reload, fresh compilation, and an actual SVG download;
- invalid-source last-good preview preservation, explanatory strip, and no stale
  download through the real handler (even forcibly enabling its button);
- an editable UI with loading feedback while WASM fetches are delayed by 3 seconds;
- no uncaught browser errors on the normal/offline path.

Chromium sometimes exposes negative response body sizes for service-worker/cache
responses. These are recorded as `null`, not negative transfers. Observed cold
transfer totals exclude service-worker responses; they are measurements from this
server configuration, not predictions for compressed production hosting.

## Measured local production baseline and result

Fresh headless Chromium, Vite preview on loopback, no network throttling. These are
single samples, not statistically significant speed comparisons:

| Measurement | Before | After |
| --- | ---: | ---: |
| Editor visible | 336 ms | 346 ms |
| First preview visible | 1,130 ms | 1,141 ms |
| Observed cold network response body bytes | 60,829,917 | 32,454,864 |
| Compiler WASM network fetches | 2 | 1 |
| Application entry JS (uncompressed) | 839,743 bytes | 84,291 bytes |
| Largest client JS chunk | 839,743 bytes | 392,660 bytes |
| Compiler WASM static size | 28,377,376 bytes | 28,377,376 bytes |
| Workbox precache build total | 32,379.87 KiB | 32,383.53 KiB |

The original worker compiler fetch raced the service worker's precache download,
transferring the same 28 MB WASM twice. Production first compilation now waits for
SW control (at most 8 seconds), so the worker reads precached assets. The editor
never waits for this. Already-controlled/offline pages and browsers without SW
support start the worker immediately; stalled SW installation falls back to online
worker fetching after the bounded wait. Disposal during warmup cannot create an
orphan worker. The extra wait may delay the first preview on slow connections,
but removes the duplicate large transfer while retaining complete offline assets.

Client code is split into application, React, UI, editor, and Typst-language
chunks without raising Vite's warning threshold. Compiler/renderer continue to
run in their existing lazy-created worker. This is bounded chunking and improved
loading feedback, not a claim of smaller total JavaScript or smaller WASM. All
chunks and bundled fonts remain precached. First visit offline without a completed
warmup is not supported; imported external packages still require their existing
package-cache warmup.

Source export safety uses successful render version, active file identity, document
identity, and exact workspace contents/paths. Source edits, switches, and workspace
changes invalidate eligibility synchronously; stale compile results cannot replace
the preview. Export rechecks eligibility before worker work and before triggering
the download, covering queued edits and file switches. The hook exposes
`canExportSvg` for UI disabling, but the handler itself enforces the invariant.
