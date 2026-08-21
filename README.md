# Typoff

A local-first Typst editor that installs as an offline PWA.

## Development

```bash
npm ci
npm test
npm run build
npm run preview
```

## Offline behavior

After the first successful PWA installation, the editor, compiler, renderer,
service worker, and bundled Libertinus/New Computer Modern/DejaVu fonts work
without a network connection. Typst compilation runs in a Web Worker so long
files do not freeze the editor UI.

Typoff deliberately does not contact the online Typst package registry at
runtime. The Typst standard library is available offline; documents importing
unbundled `@preview` packages report a compile error instead of making a hidden
network request.
