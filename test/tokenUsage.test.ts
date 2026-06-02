import path from 'node:path';
import { createTokenUsageCli, TokenUsageUseCase } from '../src/index';
import { LoadTokenUsageOutPort, ShowTokenUsageOutPort } from '../src/application/ports/out/tokenUsageOutPort';
import { createTimeRange, createTokenUsageReport, parseTimePeriod, TimeRange, TokenUsageMeasurement, TokenUsageReport } from '../src/domain/tokenUsage';
import { OpencodeTokenUsageAdapter } from '../src/adapter/out/opencodeTokenUsageAdapter';

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

    test('groups all-time usage by the selected period', () => {
        const measurements: TokenUsageMeasurement[] = [
            { date: '2026-05-31', agent: 'opencode', model: 'gpt-5.5', inputTokens: 10, outputTokens: 1, cachedTokens: 0 },
            { date: '2026-06-01', agent: 'opencode', model: 'gpt-5.5', inputTokens: 20, outputTokens: 2, cachedTokens: 0 },
            { date: '2027-01-01', agent: 'opencode', model: 'gpt-5.5', inputTokens: 30, outputTokens: 3, cachedTokens: 0 }
        ];

        expect(createTokenUsageReport('weekly', measurements).entries.map((entry) => entry.date)).toEqual([
            '2026-05-25',
            '2026-06-01',
            '2026-12-28'
        ]);
        expect(createTokenUsageReport('monthly', measurements).entries.map((entry) => ({ date: entry.date, totalTokens: entry.totalTokens }))).toEqual([
            { date: '2026-05', totalTokens: 11 },
            { date: '2026-06', totalTokens: 22 },
            { date: '2027-01', totalTokens: 33 }
        ]);
        expect(createTokenUsageReport('yearly', measurements).entries.map((entry) => ({ date: entry.date, totalTokens: entry.totalTokens }))).toEqual([
            { date: '2026', totalTokens: 33 },
            { date: '2027', totalTokens: 33 }
        ]);
    });
});

describe('token usage use case', () => {
    test('loads measurements for today with a day filter and presents a report', async () => {
        const loader = new FakeTokenUsageLoader([
            { date: '2026-05-26', agent: 'build', model: 'gpt-5.5', inputTokens: 10, outputTokens: 1, cachedTokens: 2 }
        ]);
        const presenter = new CapturingPresenter();
        const useCase = new TokenUsageUseCase(loader, presenter, () => new Date(2026, 4, 26, 12, 0, 0, 0));

        await useCase.viewTokenUsage({ timePeriod: 'today' });

        expect(loader.loadedRange).toEqual({
            start: new Date(2026, 4, 26, 0, 0, 0, 0),
            endExclusive: new Date(2026, 4, 27, 0, 0, 0, 0)
        });
        expect(presenter.report?.entries).toEqual([
            { date: '2026-05-26', agent: 'build', model: 'gpt-5.5', inputTokens: 10, outputTokens: 1, cachedTokens: 2, totalTokens: 13, cost: 0 }
        ]);
    });

    test('loads all measurements for daily grouping', async () => {
        const loader = new FakeTokenUsageLoader([
            { date: '2026-05-26', agent: 'build', model: 'gpt-5.5', inputTokens: 10, outputTokens: 1, cachedTokens: 2 }
        ]);
        const presenter = new CapturingPresenter();
        const useCase = new TokenUsageUseCase(loader, presenter, () => new Date(2026, 4, 26, 12, 0, 0, 0));

        await useCase.viewTokenUsage({ timePeriod: 'daily' });

        expect(loader.loadedRange).toBeUndefined();
        expect(presenter.report?.period).toBe('daily');
    });
});

describe('opencode token usage adapter', () => {
    test('loads token usage from the sample sqlite database', async () => {
        const adapter = new OpencodeTokenUsageAdapter(sampleDatabasePath());
        const range = {
            start: new Date('2026-06-02T00:00:00.000Z'),
            endExclusive: new Date('2026-06-03T00:00:00.000Z')
        };

        const measurements = await adapter.loadTokenUsage(range);
        const report = createTokenUsageReport('today', measurements, range);

        expect(measurements.length).toBeGreaterThan(0);
        expect(measurements.every((measurement) => measurement.inputTokens + measurement.outputTokens + measurement.cachedTokens > 0)).toBe(true);
        expect(report.entries).toEqual([
            {
                date: '2026-06-02',
                agent: 'opencode',
                model: 'gpt-5.5',
                inputTokens: 838464,
                outputTokens: 34435,
                cachedTokens: 17459200,
                totalTokens: 18332099,
                cost: 0
            }
        ]);
    });
});

describe('token usage cli', () => {
    test('prints raw token usage as json', async () => {
        const output: string[] = [];
        const program = createTokenUsageCli({
            now: () => new Date(2026, 4, 26, 12, 0, 0, 0),
            writeLine: (line) => output.push(line)
        });

        await program.parseAsync(['today', '--raw', '--opencode-db', sampleDatabasePath()], { from: 'user' });

        const report = JSON.parse(output[0]) as TokenUsageReport;
        expect(report.period).toBe('today');
        expect(report.startDate).toBe('2026-05-26');
        expect(report.endDate).toBe('2026-05-26');
        expect(report.entries.length).toBeGreaterThan(0);
        expect(report.total.cost).toBe(0);
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

function sampleDatabasePath(): string {
    return path.resolve(__dirname, '../sample-data/opencode.db');
}
