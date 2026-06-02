# token-usage

token-usage is a TypeScript CLI for tracking and visualizing AI agent token usage.

This setup provides:
- A Commander-based CLI entrypoint (`token-usage`).
- Token usage aggregation by date, agent, and model.
- Cost calculation from configured model token prices.
- Opencode usage extraction from the local SQLite database.
- Table output and raw JSON output.
- TypeScript build with `webpack`.
- npm scripts for build/lint/test.
- GitHub Actions workflow for CI.

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

The CLI reads Opencode usage from `~/.local/share/opencode/opencode.db` by default.

### Time Periods

Run one of the supported time periods:

```bash
token-usage today
token-usage daily
token-usage weekly
token-usage monthly
token-usage yearly
```

`today` shows only today's usage. `daily`, `weekly`, `monthly`, and `yearly` load the complete usage history and group it by the selected period.

The table groups usage by `Period`, `Agent`, and `Model`. Daily periods use `YYYY-MM-DD`, weekly periods use the Monday date of the week, monthly periods use `YYYY-MM`, and yearly periods use `YYYY`. Each row shows input, output, cached, total tokens, and cost.

### Costs

The CLI calculates costs from the model token prices in `src/adapter/out/tokenPrices.json`. Prices are configured in USD per 1 million tokens and split into `input`, `cached`, and `output` prices. Models without a configured price use `0` cost.

### Raw JSON

Use `--raw` to print the token usage report as JSON:

```bash
token-usage monthly --raw
```

### Custom Opencode Database

Use `--opencode-db` to read another SQLite database, for example the sample database in this repository:

```bash
token-usage daily --opencode-db sample-data/opencode.db
```

## Development

- `npm run lint` – lint source and test files.
- `npm test` – run unit tests.
