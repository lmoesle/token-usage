import { DatabaseSync } from 'node:sqlite';
import { createTokenUsageCli, TokenUsageUseCase } from '../src/index';
import { LoadTokenPricesOutPort, LoadTokenUsageOutPort, ShowTokenUsageOutPort } from '../src/application/ports/out/tokenUsageOutPort';
import { createTimeRange, createTokenUsageReport, parseTimePeriod, TimeRange, TokenPrices, TokenUsageMeasurement, TokenUsageReport } from '../src/domain/tokenUsage';
import { OpencodeTokenUsageAdapter } from '../src/adapter/out/opencodeTokenUsageAdapter';
import { TokenPriceConfigAdapter } from '../src/adapter/out/tokenPriceConfigAdapter';

describe('token usage domain', () => {
    test('creates a local time range for today only', () => {
        const now = new Date(2026, 5, 2, 13, 45, 0, 0);

        expect(createTimeRange('today', now)).toEqual({
            start: new Date(2026, 5, 2, 0, 0, 0, 0),
            endExclusive: new Date(2026, 5, 3, 0, 0, 0, 0)
        });
        expect(createTimeRange('daily', now)).toBeUndefined();
        expect(createTimeRange('weekly', now)).toBeUndefined();
        expect(createTimeRange('monthly', now)).toBeUndefined();
        expect(createTimeRange('yearly', now)).toBeUndefined();
    });

    test('rejects unsupported time periods', () => {
        expect(() => parseTimePeriod('hourly')).toThrow('Unsupported time period "hourly"');
    });

    test('aggregates measurements by date, agent and model', () => {
        const report = createTokenUsageReport('daily', [
            { date: '2026-05-26', agent: 'build', model: 'gpt-5.5', inputTokens: 10, outputTokens: 5, cachedTokens: 3 },
            { date: '2026-05-26', agent: 'build', model: 'gpt-5.5', inputTokens: 7, outputTokens: 1, cachedTokens: 2 },
            { date: '2026-05-26', agent: 'review', model: 'gpt-5.5', inputTokens: 4, outputTokens: 2, cachedTokens: 0 }
        ]);

        expect(report.entries).toEqual([
            { date: '2026-05-26', agent: 'build', model: 'gpt-5.5', inputTokens: 17, outputTokens: 6, cachedTokens: 5, totalTokens: 28, cost: 0 },
            { date: '2026-05-26', agent: 'review', model: 'gpt-5.5', inputTokens: 4, outputTokens: 2, cachedTokens: 0, totalTokens: 6, cost: 0 }
        ]);
        expect(report.total).toEqual({
            inputTokens: 21,
            outputTokens: 8,
            cachedTokens: 5,
            totalTokens: 34,
            cost: 0
        });
    });

    test('calculates costs from model token prices', () => {
        const report = createTokenUsageReport('daily', [
            { date: '2026-05-26', agent: 'opencode', model: 'gpt-5.5', inputTokens: 1_000_000, outputTokens: 1_000_000, cachedTokens: 1_000_000 },
            { date: '2026-05-26', agent: 'opencode', model: 'unknown-model', inputTokens: 1_000_000, outputTokens: 1_000_000, cachedTokens: 1_000_000 }
        ], undefined, {
            'gpt-5.5': { input: 5, cached: 0.5, output: 30 }
        });

        expect(report.entries).toEqual([
            { date: '2026-05-26', agent: 'opencode', model: 'gpt-5.5', inputTokens: 1_000_000, outputTokens: 1_000_000, cachedTokens: 1_000_000, totalTokens: 3_000_000, cost: 35.5 },
            { date: '2026-05-26', agent: 'opencode', model: 'unknown-model', inputTokens: 1_000_000, outputTokens: 1_000_000, cachedTokens: 1_000_000, totalTokens: 3_000_000, cost: 0 }
        ]);
        expect(report.total.cost).toBe(35.5);
    });

    test('groups all-time usage by the selected period', () => {
        const measurements: TokenUsageMeasurement[] = [
            { date: '2026-05-31', agent: 'opencode', model: 'gpt-5.5', inputTokens: 10, outputTokens: 1, cachedTokens: 0 },
            { date: '2026-06-01', agent: 'opencode', model: 'gpt-5.5', inputTokens: 20, outputTokens: 2, cachedTokens: 0 },
            { date: '2026-06-02', agent: 'opencode', model: 'gpt-5.5', inputTokens: 40, outputTokens: 4, cachedTokens: 0 },
            { date: '2027-01-01', agent: 'opencode', model: 'gpt-5.5', inputTokens: 30, outputTokens: 3, cachedTokens: 0 }
        ];

        expect(createTokenUsageReport('weekly', measurements).entries.map((entry) => ({ date: entry.date, totalTokens: entry.totalTokens }))).toEqual([
            { date: '2026-W22', totalTokens: 11 },
            { date: '2026-W23', totalTokens: 66 },
            { date: '2026-W53', totalTokens: 33 }
        ]);
        expect(createTokenUsageReport('monthly', measurements).entries.map((entry) => ({ date: entry.date, totalTokens: entry.totalTokens }))).toEqual([
            { date: '2026-05', totalTokens: 11 },
            { date: '2026-06', totalTokens: 66 },
            { date: '2027-01', totalTokens: 33 }
        ]);
        expect(createTokenUsageReport('yearly', measurements).entries.map((entry) => ({ date: entry.date, totalTokens: entry.totalTokens }))).toEqual([
            { date: '2026', totalTokens: 77 },
            { date: '2027', totalTokens: 33 }
        ]);
    });
});

describe('token usage use case', () => {
    test('loads measurements for today with a day filter and presents a report', async () => {
        const loader = new FakeTokenUsageLoader([
            { date: '2026-05-26', agent: 'build', model: 'gpt-5.5', inputTokens: 10, outputTokens: 1, cachedTokens: 2 }
        ]);
        const priceLoader = new FakeTokenPricesLoader({
            'gpt-5.5': { input: 5, cached: 0.5, output: 30 }
        });
        const presenter = new CapturingPresenter();
        const useCase = new TokenUsageUseCase(loader, priceLoader, presenter, () => new Date(2026, 4, 26, 12, 0, 0, 0));

        await useCase.viewTokenUsage({ timePeriod: 'today' });

        expect(loader.loadedRange).toEqual({
            start: new Date(2026, 4, 26, 0, 0, 0, 0),
            endExclusive: new Date(2026, 4, 27, 0, 0, 0, 0)
        });
        expect(presenter.report?.entries).toEqual([
            { date: '2026-05-26', agent: 'build', model: 'gpt-5.5', inputTokens: 10, outputTokens: 1, cachedTokens: 2, totalTokens: 13, cost: expect.any(Number) }
        ]);
        expect(presenter.report?.entries[0].cost).toBeCloseTo(0.000081);
    });

    test('loads all measurements for daily grouping', async () => {
        const loader = new FakeTokenUsageLoader([
            { date: '2026-05-26', agent: 'build', model: 'gpt-5.5', inputTokens: 10, outputTokens: 1, cachedTokens: 2 }
        ]);
        const presenter = new CapturingPresenter();
        const useCase = new TokenUsageUseCase(loader, new FakeTokenPricesLoader({}), presenter, () => new Date(2026, 4, 26, 12, 0, 0, 0));

        await useCase.viewTokenUsage({ timePeriod: 'daily' });

        expect(loader.loadedRange).toBeUndefined();
        expect(presenter.report?.period).toBe('daily');
    });
});

describe('token price config adapter', () => {
    test('loads configured model token prices', async () => {
        const prices = await new TokenPriceConfigAdapter().loadTokenPrices();

        expect(prices['gpt-5.5']).toEqual({ input: 5, cached: 0.5, output: 30 });
        expect(prices['claude-sonnet-4-5']).toEqual({ input: 3, cached: 0.3, output: 15 });
        expect(prices['deepseek-v4-flash']).toEqual({ input: 0.14, cached: 0.03, output: 0.28 });
        expect(prices['gemini-3-pro']).toEqual({ input: 2, cached: 0.2, output: 12 });
        expect(prices['glm-5']).toEqual({ input: 1, cached: 0.2, output: 3.2 });
        expect(prices['devstral-medium-latest']).toEqual({ input: 0.4, cached: 0, output: 2 });
        expect(prices['gpt-5.3-codex-spark']).toEqual({ input: 1.75, cached: 0.175, output: 14 });
        expect(prices['kimi-k2.5']).toEqual({ input: 0.6, cached: 0.08, output: 3 });
        expect(prices['minimax-m2.5']).toEqual({ input: 0.3, cached: 0.06, output: 1.2 });
        expect(prices['open-mixtral-8x22b']).toEqual({ input: 2, cached: 0, output: 6 });
        expect(prices['qwen3.6-plus']).toEqual({ input: 0.5, cached: 0.05, output: 3 });
        expect(Object.keys(prices).length).toBeGreaterThanOrEqual(160);
        for (const price of Object.values(prices)) {
            expect(typeof price.input).toBe('number');
            expect(typeof price.cached).toBe('number');
            expect(typeof price.output).toBe('number');
        }
    });
});

describe('opencode token usage adapter', () => {
    test('loads token usage from the opencode sqlite database', async () => {
        const adapter = new OpencodeTokenUsageAdapter(':memory:', () => createOpencodeFixtureDatabase());
        const range = {
            start: new Date(2026, 5, 2, 0, 0, 0, 0),
            endExclusive: new Date(2026, 5, 3, 0, 0, 0, 0)
        };

        const measurements = await adapter.loadTokenUsage(range);
        const report = createTokenUsageReport('today', measurements, range);

        expect(measurements.every((measurement) => measurement.inputTokens + measurement.outputTokens + measurement.cachedTokens > 0)).toBe(true);
        expect(report.entries).toEqual([
            {
                date: '2026-06-02',
                agent: 'opencode',
                model: 'gpt-5.5',
                inputTokens: 25,
                outputTokens: 3,
                cachedTokens: 3,
                totalTokens: 31,
                cost: 0
            }
        ]);
    });

    test('loads the complete opencode sqlite history without a time range', async () => {
        const adapter = new OpencodeTokenUsageAdapter(':memory:', () => createOpencodeFixtureDatabase());

        const measurements = await adapter.loadTokenUsage();
        const report = createTokenUsageReport('daily', measurements);

        expect(report.entries).toEqual([
            {
                date: '2026-06-01',
                agent: 'opencode',
                model: 'plain-model',
                inputTokens: 101,
                outputTokens: 10,
                cachedTokens: 1,
                totalTokens: 112,
                cost: 0
            },
            {
                date: '2026-06-02',
                agent: 'opencode',
                model: 'gpt-5.5',
                inputTokens: 25,
                outputTokens: 3,
                cachedTokens: 3,
                totalTokens: 31,
                cost: 0
            }
        ]);
    });
});

describe('token usage cli', () => {
    test('prints raw token usage as json', async () => {
        const output: string[] = [];
        const loader = new FakeTokenUsageLoader([
            { date: '2026-05-26', agent: 'opencode', model: 'gpt-5.5', inputTokens: 10, outputTokens: 2, cachedTokens: 3 }
        ]);
        const program = createTokenUsageCli({
            now: () => new Date(2026, 4, 26, 12, 0, 0, 0),
            writeLine: (line) => output.push(line),
            loadTokenUsageOutPort: loader,
            loadTokenPricesOutPort: new FakeTokenPricesLoader({})
        });

        await program.parseAsync(['today', '--raw'], { from: 'user' });

        const report = JSON.parse(output[0]) as TokenUsageReport;
        expect(report.period).toBe('today');
        expect(report.startDate).toBe('2026-05-26');
        expect(report.endDate).toBe('2026-05-26');
        expect(report.entries).toEqual([
            { date: '2026-05-26', agent: 'opencode', model: 'gpt-5.5', inputTokens: 10, outputTokens: 2, cachedTokens: 3, totalTokens: 15, cost: 0 }
        ]);
    });
});

class FakeTokenUsageLoader implements LoadTokenUsageOutPort {
    loadedRange: TimeRange | undefined;

    constructor(private measurements: TokenUsageMeasurement[]) {}

    async loadTokenUsage(range?: TimeRange): Promise<TokenUsageMeasurement[]> {
        this.loadedRange = range;
        return this.measurements;
    }
}

class CapturingPresenter implements ShowTokenUsageOutPort {
    report: TokenUsageReport | undefined;

    showTokenUsage(report: TokenUsageReport): void {
        this.report = report;
    }
}

class FakeTokenPricesLoader implements LoadTokenPricesOutPort {
    constructor(private tokenPrices: TokenPrices) {}

    async loadTokenPrices(): Promise<TokenPrices> {
        return this.tokenPrices;
    }
}

interface OpencodeFixtureRow {
    timeCreated: number;
    model: string | null;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
}

function createOpencodeFixtureDatabase(): DatabaseSync {
    const database = new DatabaseSync(':memory:');
    database.exec(`
        CREATE TABLE session (
            time_created INTEGER NOT NULL,
            model TEXT,
            tokens_input INTEGER NOT NULL,
            tokens_output INTEGER NOT NULL,
            tokens_cache_read INTEGER NOT NULL,
            tokens_cache_write INTEGER NOT NULL
        )
    `);

    const rows: OpencodeFixtureRow[] = [
        createOpencodeFixtureRow({ day: 1, model: 'plain-model', inputTokens: 100, outputTokens: 10, cacheReadTokens: 1, cacheWriteTokens: 1 }),
        createOpencodeFixtureRow({ day: 2, model: JSON.stringify({ id: 'gpt-5.5' }), inputTokens: 10, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 }),
        createOpencodeFixtureRow({ day: 2, model: 'gpt-5.5', inputTokens: 5, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 6 }),
        createOpencodeFixtureRow({ day: 2, model: '', inputTokens: 999, outputTokens: 999, cacheReadTokens: 999, cacheWriteTokens: 999 }),
        createOpencodeFixtureRow({ day: 2, model: null, inputTokens: 999, outputTokens: 999, cacheReadTokens: 999, cacheWriteTokens: 999 }),
        createOpencodeFixtureRow({ day: 2, model: 'zero-model', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
    ];

    const insert = database.prepare(`
        INSERT INTO session (
            time_created,
            model,
            tokens_input,
            tokens_output,
            tokens_cache_read,
            tokens_cache_write
        ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const row of rows) {
        insert.run(row.timeCreated, row.model, row.inputTokens, row.outputTokens, row.cacheReadTokens, row.cacheWriteTokens);
    }

    return database;
}

function createOpencodeFixtureRow(row: Omit<OpencodeFixtureRow, 'timeCreated'> & { day: number }): OpencodeFixtureRow {
    return {
        timeCreated: new Date(2026, 5, row.day, 12, 0, 0, 0).getTime(),
        model: row.model,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheReadTokens: row.cacheReadTokens,
        cacheWriteTokens: row.cacheWriteTokens
    };
}
