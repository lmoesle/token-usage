import fs from 'node:fs/promises';
import path from 'node:path';
import { LoadTokenUsageOutPort } from '../../application/ports/out/tokenUsageOutPort';
import { TimeRange, TokenUsageMeasurement, toDateKey } from '../../domain/tokenUsage';
import { CodingAgentUsageHandler } from './codingAgentTokenUsageAdapter';
import { expandHome } from './usagePath';

export const DEFAULT_VIBE_SESSION_DIR = '~/.vibe/logs/session';
export const VIBE_AGENT = 'vibe';

const UNKNOWN_VIBE_MODEL = 'unknown';

type JsonObject = Record<string, unknown>;

export class VibeTokenUsageHandler implements CodingAgentUsageHandler {
    readonly agent = VIBE_AGENT;
    readonly usagePath: string;

    constructor(private sessionDir: string = DEFAULT_VIBE_SESSION_DIR) {
        this.usagePath = sessionDir;
    }

    createAdapter(): LoadTokenUsageOutPort {
        return new VibeTokenUsageAdapter(this.sessionDir);
    }
}

export class VibeTokenUsageAdapter implements LoadTokenUsageOutPort {
    constructor(private sessionDir: string = DEFAULT_VIBE_SESSION_DIR) {}

    async loadTokenUsage(range?: TimeRange): Promise<TokenUsageMeasurement[]> {
        const resolvedSessionDir = expandHome(this.sessionDir);

        try {
            const entries = await fs.readdir(resolvedSessionDir, { withFileTypes: true });
            const sessionPaths = entries
                .filter((entry) => entry.isDirectory())
                .map((entry) => path.join(resolvedSessionDir, entry.name))
                .sort();

            const measurements = await Promise.all(
                sessionPaths.map((sessionPath) => this.loadSessionUsage(sessionPath, range))
            );

            return measurements.flat();
        } catch (err: unknown) {
            if (isNodeError(err) && err.code === 'ENOENT') {
                return [];
            }

            const error = err instanceof Error ? err : new Error(String(err));
            throw new Error(`Failed to read vibe usage sessions at ${resolvedSessionDir}: ${error.message}`);
        }
    }

    private async loadSessionUsage(sessionPath: string, range?: TimeRange): Promise<TokenUsageMeasurement[]> {
        const metaPath = path.join(sessionPath, 'meta.json');
        let rawMeta: string;

        try {
            rawMeta = await fs.readFile(metaPath, 'utf8');
        } catch (err: unknown) {
            if (isNodeError(err) && err.code === 'ENOENT') {
                return [];
            }

            throw err;
        }

        return this.mapSessionMeta(JSON.parse(rawMeta), range);
    }

    private mapSessionMeta(meta: unknown, range?: TimeRange): TokenUsageMeasurement[] {
        if (!isJsonObject(meta)) {
            return [];
        }

        const startedAt = parseDate(meta.start_time);
        if (startedAt === undefined || isOutsideRange(startedAt, range)) {
            return [];
        }

        const stats = meta.stats;
        if (!isJsonObject(stats)) {
            return [];
        }

        const config = isJsonObject(meta.config) ? meta.config : {};

        const inputTokens = toTokenCount(stats.session_prompt_tokens ?? stats.prompt_tokens);
        const outputTokens = toTokenCount(stats.session_completion_tokens ?? stats.completion_tokens);
        const cachedTokens = toTokenCount(stats.session_cached_tokens ?? stats.cached_tokens);
        const totalTokens = inputTokens + outputTokens + cachedTokens;
        const fallbackTotalTokens = toTokenCount(stats.session_total_llm_tokens ?? stats.total_tokens);
        const cost = toOptionalNumber(stats.session_cost ?? stats.cost);

        if (totalTokens === 0 && fallbackTotalTokens === 0) {
            return [];
        }

        return [{
            date: toDateKey(startedAt),
            agent: VIBE_AGENT,
            model: readModel(config, meta, stats),
            inputTokens: totalTokens === 0 ? fallbackTotalTokens : inputTokens,
            outputTokens,
            cachedTokens,
            ...(cost === undefined ? {} : { cost })
        }];
    }
}

function readModel(...sources: JsonObject[]): string {
    for (const source of sources) {
        for (const key of ['active_model', 'model', 'model_id', 'model_name']) {
            const value = source[key];

            if (typeof value === 'string' && value.trim().length > 0) {
                return value.trim();
            }

            if (isJsonObject(value) && typeof value.id === 'string' && value.id.trim().length > 0) {
                return value.id.trim();
            }
        }
    }

    return UNKNOWN_VIBE_MODEL;
}

function parseDate(value: unknown): Date | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

function isOutsideRange(date: Date, range?: TimeRange): boolean {
    return range !== undefined && (date < range.start || date >= range.endExclusive);
}

function toTokenCount(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function toOptionalNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
    return value instanceof Error && 'code' in value;
}
