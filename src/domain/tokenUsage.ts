export const SUPPORTED_TIME_PERIODS = ['today', 'daily', 'weekly', 'monthly', 'yearly'] as const;

export type TimePeriod = typeof SUPPORTED_TIME_PERIODS[number];

export interface TimeRange {
    start: Date;
    endExclusive: Date;
}

export interface TokenUsageMeasurement {
    date: string;
    agent: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
}

export interface TokenPrice {
    input: number;
    cached: number;
    output: number;
}

export type TokenPrices = Record<string, TokenPrice>;

export interface TokenUsageEntry extends TokenUsageMeasurement {
    totalTokens: number;
    cost: number;
}

export interface TokenUsageTotals {
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    totalTokens: number;
    cost: number;
}

export interface TokenUsageReport {
    period: TimePeriod;
    startDate: string;
    endDate: string;
    entries: TokenUsageEntry[];
    total: TokenUsageTotals;
}

export function parseTimePeriod(value: string): TimePeriod {
    const normalized = value.toLowerCase();
    if (isSupportedTimePeriod(normalized)) {
        return normalized;
    }

    throw new Error(`Unsupported time period "${value}". Supported periods: ${SUPPORTED_TIME_PERIODS.join(', ')}`);
}

export function createTimeRange(period: TimePeriod, now: Date = new Date()): TimeRange | undefined {
    if (period !== 'today') {
        return undefined;
    }

    const start = startOfDay(now);
    return { start, endExclusive: addDays(start, 1) };
}

const TOKENS_PER_PRICE_UNIT = 1_000_000;

export function createTokenUsageReport(
    period: TimePeriod,
    measurements: TokenUsageMeasurement[],
    range?: TimeRange,
    tokenPrices: TokenPrices = {}
): TokenUsageReport {
    const entriesByKey = new Map<string, TokenUsageMeasurement>();

    for (const measurement of measurements) {
        const groupedMeasurement = {
            ...measurement,
            date: createGroupKey(period, measurement.date)
        };
        const key = [groupedMeasurement.date, groupedMeasurement.agent, groupedMeasurement.model].join('\u0000');
        const existing = entriesByKey.get(key);

        if (existing === undefined) {
            entriesByKey.set(key, groupedMeasurement);
            continue;
        }

        existing.inputTokens += groupedMeasurement.inputTokens;
        existing.outputTokens += groupedMeasurement.outputTokens;
        existing.cachedTokens += groupedMeasurement.cachedTokens;
    }

    const entries = Array.from(entriesByKey.values())
        .map((measurement) => ({
            ...measurement,
            totalTokens: measurement.inputTokens + measurement.outputTokens + measurement.cachedTokens,
            cost: calculateCost(measurement, tokenPrices[measurement.model])
        }))
        .sort((a, b) => {
            const dateCompare = a.date.localeCompare(b.date);
            if (dateCompare !== 0) {
                return dateCompare;
            }

            const agentCompare = a.agent.localeCompare(b.agent);
            if (agentCompare !== 0) {
                return agentCompare;
            }

            return a.model.localeCompare(b.model);
        });

    return {
        period,
        ...resolveReportDateRange(measurements, range),
        entries,
        total: calculateTotals(entries)
    };
}

export function toDateKey(date: Date): string {
    return [date.getFullYear(), padDatePart(date.getMonth() + 1), padDatePart(date.getDate())].join('-');
}

function calculateTotals(entries: TokenUsageEntry[]): TokenUsageTotals {
    return entries.reduce<TokenUsageTotals>((total, entry) => {
        total.inputTokens += entry.inputTokens;
        total.outputTokens += entry.outputTokens;
        total.cachedTokens += entry.cachedTokens;
        total.totalTokens += entry.totalTokens;
        total.cost += entry.cost;
        return total;
    }, {
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        totalTokens: 0,
        cost: 0
    });
}

function calculateCost(measurement: TokenUsageMeasurement, tokenPrice: TokenPrice | undefined): number {
    if (tokenPrice === undefined) {
        return 0;
    }

    return (
        measurement.inputTokens * tokenPrice.input
        + measurement.cachedTokens * tokenPrice.cached
        + measurement.outputTokens * tokenPrice.output
    ) / TOKENS_PER_PRICE_UNIT;
}

function createGroupKey(period: TimePeriod, dateKey: string): string {
    switch (period) {
        case 'today':
        case 'daily':
            return dateKey;
        case 'weekly':
            return toIsoWeekKey(parseDateKey(dateKey));
        case 'monthly':
            return dateKey.slice(0, 7);
        case 'yearly':
            return dateKey.slice(0, 4);
    }
}

function resolveReportDateRange(measurements: TokenUsageMeasurement[], range?: TimeRange): { startDate: string; endDate: string } {
    if (range !== undefined) {
        return {
            startDate: toDateKey(range.start),
            endDate: toDateKey(new Date(range.endExclusive.getTime() - 1))
        };
    }

    const dates = measurements.map((measurement) => measurement.date).sort();
    return {
        startDate: dates[0] ?? '',
        endDate: dates[dates.length - 1] ?? ''
    };
}

function isSupportedTimePeriod(value: string): value is TimePeriod {
    return (SUPPORTED_TIME_PERIODS as readonly string[]).includes(value);
}

function startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseDateKey(dateKey: string): Date {
    const [year, month, day] = dateKey.split('-').map(Number);
    return new Date(year, month - 1, day);
}

function toIsoWeekKey(date: Date): string {
    const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const isoDay = utcDate.getUTCDay() || 7;
    utcDate.setUTCDate(utcDate.getUTCDate() + 4 - isoDay);

    const isoYear = utcDate.getUTCFullYear();
    const yearStart = new Date(Date.UTC(isoYear, 0, 1));
    const isoWeek = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);

    return `${isoYear}-W${padDatePart(isoWeek)}`;
}

function addDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

function padDatePart(value: number): string {
    return value.toString().padStart(2, '0');
}
