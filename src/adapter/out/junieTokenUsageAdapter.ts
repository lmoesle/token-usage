import fs from 'node:fs/promises';
import path from 'node:path';
import { LoadTokenUsageOutPort } from '../../application/ports/out/tokenUsageOutPort';
import { TimeRange, TokenUsageMeasurement, toDateKey } from '../../domain/tokenUsage';
import { CodingAgentUsageHandler } from './codingAgentTokenUsageAdapter';
import { expandHome } from './usagePath';

export const DEFAULT_JUNIE_SESSIONS_DIR = '~/.junie/sessions';
export const JUNIE_AGENT = 'junie';

const SESSION_EVENTS_FILE = 'events.jsonl';
const LLM_RESPONSE_METADATA_EVENT = 'LlmResponseMetadataEvent';
const UNKNOWN_JUNIE_MODEL = 'unknown';

type JsonObject = Record<string, unknown>;

export class JunieTokenUsageHandler implements CodingAgentUsageHandler {
    readonly agent = JUNIE_AGENT;
    readonly usagePath: string;

    constructor(private sessionsDir: string = DEFAULT_JUNIE_SESSIONS_DIR) {
        this.usagePath = sessionsDir;
    }

    createAdapter(): LoadTokenUsageOutPort {
        return new JunieTokenUsageAdapter(this.sessionsDir);
    }
}

export class JunieTokenUsageAdapter implements LoadTokenUsageOutPort {
    constructor(private sessionsDir: string = DEFAULT_JUNIE_SESSIONS_DIR) {}

    async loadTokenUsage(range?: TimeRange): Promise<TokenUsageMeasurement[]> {
        const resolvedSessionsDir = expandHome(this.sessionsDir);

        try {
            const entries = await fs.readdir(resolvedSessionsDir, { withFileTypes: true });
            const eventsFiles = entries
                .filter((entry) => entry.isDirectory())
                .map((entry) => path.join(resolvedSessionsDir, entry.name, SESSION_EVENTS_FILE))
                .sort();

            const measurements = await Promise.all(
                eventsFiles.map((eventsFile) => this.loadSessionUsage(eventsFile, range))
            );

            return measurements.flat();
        } catch (err: unknown) {
            if (isNodeError(err) && err.code === 'ENOENT') {
                return [];
            }

            const error = err instanceof Error ? err : new Error(String(err));
            throw new Error(`Failed to read junie usage sessions at ${resolvedSessionsDir}: ${error.message}`);
        }
    }

    private async loadSessionUsage(eventsFile: string, range?: TimeRange): Promise<TokenUsageMeasurement[]> {
        let rawEvents: string;

        try {
            rawEvents = await fs.readFile(eventsFile, 'utf8');
        } catch (err: unknown) {
            if (isNodeError(err) && err.code === 'ENOENT') {
                return [];
            }

            throw err;
        }

        const measurements: TokenUsageMeasurement[] = [];

        rawEvents.split('\n').forEach((line, index) => {
            if (line.trim().length === 0) {
                return;
            }

            const event = parseJsonLine(line, eventsFile, index + 1);
            measurements.push(...mapEventUsage(event, range));
        });

        return measurements;
    }
}

function mapEventUsage(event: JsonObject, range?: TimeRange): TokenUsageMeasurement[] {
    const modelUsages = readModelUsages(event);
    if (modelUsages.length === 0) {
        return [];
    }

    const timestamp = parseTimestamp(event.timestampMs);
    if (timestamp === undefined || isOutsideRange(timestamp, range)) {
        return [];
    }

    const date = toDateKey(timestamp);

    return modelUsages.flatMap((modelUsage) => mapModelUsage(modelUsage, date));
}

function readModelUsages(event: JsonObject): JsonObject[] {
    const sessionEvent = isJsonObject(event.event) ? event.event : undefined;
    const agentEvent = sessionEvent !== undefined && isJsonObject(sessionEvent.agentEvent) ? sessionEvent.agentEvent : undefined;
    if (agentEvent === undefined || agentEvent.kind !== LLM_RESPONSE_METADATA_EVENT || !Array.isArray(agentEvent.modelUsage)) {
        return [];
    }

    return agentEvent.modelUsage.filter(isJsonObject);
}

function mapModelUsage(modelUsage: JsonObject, date: string): TokenUsageMeasurement[] {
    const inputTokens = toTokenCount(modelUsage.inputTokens) + toTokenCount(modelUsage.cacheCreateTokens);
    const cachedTokens = toTokenCount(modelUsage.cacheInputTokens);
    const outputTokens = toTokenCount(modelUsage.outputTokens);
    if (inputTokens + cachedTokens + outputTokens === 0) {
        return [];
    }

    const cost = toOptionalNumber(modelUsage.cost);

    return [{
        date,
        agent: JUNIE_AGENT,
        model: readModel(modelUsage),
        inputTokens,
        outputTokens,
        cachedTokens,
        ...(cost === undefined ? {} : { cost })
    }];
}

function readModel(modelUsage: JsonObject): string {
    const model = modelUsage.model;

    return typeof model === 'string' && model.trim().length > 0 ? model.trim() : UNKNOWN_JUNIE_MODEL;
}

function parseJsonLine(line: string, eventsFile: string, lineNumber: number): JsonObject {
    try {
        const value = JSON.parse(line) as unknown;
        return isJsonObject(value) ? value : {};
    } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        throw new Error(`Invalid JSON in ${eventsFile}:${lineNumber}: ${error.message}`);
    }
}

function parseTimestamp(value: unknown): Date | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
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
