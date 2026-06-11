# token-usage

token-usage is a TypeScript CLI for tracking and visualizing AI agent token usage.

This setup provides:
- A Commander-based CLI entrypoint (`token-usage`).
- Token usage aggregation by date, agent, and model.
- Cost calculation from configured model token prices.
- Opencode usage extraction from the local SQLite database.
- Vibe usage extraction from local session metadata.
- Codex usage extraction from local session transcripts and archived sessions.
- Table output and raw JSON output.
- TypeScript build with `webpack`.
- npm scripts for build/lint/test.
- GitHub Actions workflow for CI.

The CLI reads Opencode usage from `~/.local/share/opencode/opencode.db`, Vibe usage from `~/.vibe/logs/session`, and Codex usage from `~/.codex/sessions` plus `~/.codex/archived_sessions` by default. An agent adapter is activated only when its usage location exists.

```bash
npx @lmoesle/token-usage-cli today
npx @lmoesle/token-usage-cli daily
npx @lmoesle/token-usage-cli weekly
npx @lmoesle/token-usage-cli monthly
npx @lmoesle/token-usage-cli yearly
```

`today` shows only today's usage. `daily`, `weekly`, `monthly`, and `yearly` load the complete usage history and group it by the selected period.

The table groups usage by `Period`, `Agent`, and `Model`. Daily periods use `YYYY-MM-DD`, weekly periods use ISO calendar weeks (`YYYY-Www`), monthly periods use `YYYY-MM`, and yearly periods use `YYYY`. Each row shows input, output, cached, total tokens, and cost.

The CLI calculates costs from the model token prices in `src/adapter/out/tokenPrices.json`. Prices are configured in USD per 1 million tokens and split into `input`, `cached`, and `output` prices. The config covers OpenCode Zen plus common OpenCode providers like OpenAI, Anthropic, Google, and Mistral. Models without a configured price use `0` cost.

Use `--raw` to print the token usage report as JSON:

```bash
npx @lmoesle/token-usage-cli monthly --raw
```

## Custom Opencode Database

Use `--opencode-db` to read another SQLite database, for example the sample database in this repository:

```bash
npx @lmoesle/token-usage-cli daily --opencode-db sample-data/opencode.db
```

## Custom Vibe Sessions Directory

Use `--vibe-session-dir` to read Vibe session metadata from another directory:

```bash
npx @lmoesle/token-usage-cli daily --vibe-session-dir ~/.vibe/logs/session
```

## Custom Codex Home Directory

Use `--codex-home` to read Codex transcripts from another Codex home directory:

```bash
npx @lmoesle/token-usage-cli daily --codex-home ~/.codex
```

## Setup

Use a Node.js runtime with `node:sqlite` support.

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
npm start -- today
```

## Development

- `npm run lint` – lint source and test files.
- `npm test` – run unit tests.
