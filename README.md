# token-usage

token-usage is a small TypeScript CLI scaffold for tracking AI agent token usage.

This initial setup provides:
- A minimal Commander-based CLI entrypoint (`token-usage`).
- TypeScript build with `webpack`.
- npm scripts for build/lint/test.
- GitHub Actions workflow for CI.

## Setup

```bash
npm install
```

## Build

```bash
npm run build
```

The bundled CLI is emitted to `dist/index.js`.

## Run

```bash
npm start
```

prints a hello-world message.

## Development

- `npm run lint` – lint source and test files.
- `npm test` – run unit tests.
