import fs from 'node:fs/promises';
import path from 'node:path';
import { LoadTokenUsageOutPort } from '../../application/ports/out/tokenUsageOutPort';
import { TimeRange, TokenUsageMeasurement, toDateKey } from '../../domain/tokenUsage';
import { CodingAgentUsageHandler } from './codingAgentTokenUsageAdapter';
import { expandHome } from './usagePath';

export const DEFAULT_CODEX_HOME_DIR = '~/.codex';
export const CODEX_AGENT = 'codex';

const CODEX_SESSION_DIRS = ['sessions', 'archived_sessions'];
const UNKNOWN_CODEX_MODEL = 'unknown';

type JsonObject = Record<string, unknown>;

interface CodexUsageSnapshot {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
}

interface CodexTranscriptUsage {
    sessionId: string;
    measurements: TokenUsageMeasurement[];
}

export class CodexTokenUsageHandler implements CodingAgentUsageHandler {
    readonly agent = CODEX_AGENT;
    readonly usagePath: string;

    constructor(private codexHomeDir: string = DEFAULT_CODEX_HOME_DIR) {
        this.usagePath = codexHomeDir;
    }

    createAdapter(): LoadTokenUsageOutPort {
        return new CodexTokenUsageAdapter(this.codexHomeDir);
    }
}

export class CodexTokenUsageAdapter implements LoadTokenUsageOutPort {
    constructor(private codexHomeDir: string = DEFAULT_CODEX_HOME_DIR) {}

    async loadTokenUsage(range?: TimeRange): Promise<TokenUsageMeasurement[]> {
        const resolvedHomeDir = expandHome(this.codexHomeDir);

        try {
            const transcriptFiles = (await Promise.all(
                CODEX_SESSION_DIRS.map(async (directory) => (await listJsonlFiles(path.join(resolvedHomeDir, directory))).sort())
            )).flat();

            const transcriptUsages = await Promise.all(
                transcriptFiles.map((transcriptFile) => this.loadTranscriptUsage(transcriptFile, range))
            );

            const seenSessionIds = new Set<string>();
            return transcriptUsages.flatMap((transcriptUsage) => {
                if (seenSessionIds.has(transcriptUsage.sessionId)) {
                    return [];
                }

                seenSessionIds.add(transcriptUsage.sessionId);
                return transcriptUsage.measurements;
            });
        } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error(String(err));
            throw new Error(`Failed to read codex usage transcripts at ${resolvedHomeDir}: ${error.message}`);
        }
    }

    private async loadTranscriptUsage(transcriptFile: string, range?: TimeRange): Promise<CodexTranscriptUsage> {
        const rawTranscript = await fs.readFile(transcriptFile, 'utf8');
        const measurements: TokenUsageMeasurement[] = [];
        let currentModel = UNKNOWN_CODEX_MODEL;
        let previousTotalUsage: CodexUsageSnapshot | undefined;
        let sessionId = path.basename(transcriptFile, '.jsonl');

        rawTranscript.split('\n').forEach((line, index) => {
            if (line.trim().length === 0) {
                return;
            }

            const event = parseJsonLine(line, transcriptFile, index + 1);
            sessionId = readSessionId(event) ?? sessionId;
            currentModel = readModel(event) ?? currentModel;

            const totalUsage = readUsageSnapshot(event, 'total_token_usage');
            const lastUsage = readUsageSnapshot(event, 'last_token_usage');
            if (totalUsage === undefined && lastUsage === undefined) {
                return;
            }

            const usage = totalUsage === undefined
                ? lastUsage
                : this.createUsageDelta(totalUsage, previousTotalUsage, lastUsage);
            previousTotalUsage = totalUsage ?? previousTotalUsage;

            const timestamp = parseDate(event.timestamp);
            if (usage === undefined || timestamp === undefined || isOutsideRange(timestamp, range)) {
                return;
            }

            const inputTokens = Math.max(usage.inputTokens - usage.cachedInputTokens, 0);
            const cachedTokens = usage.cachedInputTokens;
            const outputTokens = usage.outputTokens;
            if (inputTokens + cachedTokens + outputTokens === 0) {
                return;
            }

            measurements.push({
                date: toDateKey(timestamp),
                agent: CODEX_AGENT,
                model: currentModel,
                inputTokens,
                outputTokens,
                cachedTokens
            });
        });

        return { sessionId, measurements };
    }

    private createUsageDelta(
        totalUsage: CodexUsageSnapshot,
        previousTotalUsage: CodexUsageSnapshot | undefined,
        lastUsage: CodexUsageSnapshot | undefined
    ): CodexUsageSnapshot | undefined {
        if (previousTotalUsage === undefined) {
            return totalUsage;
        }

        const delta = subtractUsage(totalUsage, previousTotalUsage);
        if (hasNegativeTokens(delta)) {
            return lastUsage;
        }

        return delta;
    }
}

async function listJsonlFiles(directory: string): Promise<string[]> {
    let entries: Awaited<ReturnType<typeof readDirectoryEntries>>;

    try {
        entries = await readDirectoryEntries(directory);
    } catch (err: unknown) {
        if (isNodeError(err) && err.code === 'ENOENT') {
            return [];
        }

        throw err;
    }

    const nestedFiles = await Promise.all(entries.map((entry) => {
        const entryPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            return listJsonlFiles(entryPath);
        }

        return Promise.resolve(entry.isFile() && entry.name.endsWith('.jsonl') ? [entryPath] : []);
    }));

    return nestedFiles.flat();
}

async function readDirectoryEntries(directory: string) {
    return fs.readdir(directory, { withFileTypes: true });
}

function parseJsonLine(line: string, transcriptFile: string, lineNumber: number): JsonObject {
    try {
        const value = JSON.parse(line) as unknown;
        return isJsonObject(value) ? value : {};
    } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        throw new Error(`Invalid JSON in ${transcriptFile}:${lineNumber}: ${error.message}`);
    }
}

function readModel(event: JsonObject): string | undefined {
    const payload = isJsonObject(event.payload) ? event.payload : undefined;
    const model = payload?.model;

    return typeof model === 'string' && model.trim().length > 0 ? model.trim() : undefined;
}

function readSessionId(event: JsonObject): string | undefined {
    const payload = isJsonObject(event.payload) ? event.payload : undefined;
    const sessionId = payload?.id;

    return typeof sessionId === 'string' && sessionId.trim().length > 0 ? sessionId.trim() : undefined;
}

function readUsageSnapshot(event: JsonObject, key: 'total_token_usage' | 'last_token_usage'): CodexUsageSnapshot | undefined {
    const payload = isJsonObject(event.payload) ? event.payload : undefined;
    if (payload?.type !== 'token_count') {
        return undefined;
    }

    const info = isJsonObject(payload.info) ? payload.info : undefined;
    const usage = info === undefined || !isJsonObject(info[key]) ? undefined : info[key];
    if (usage === undefined) {
        return undefined;
    }

    return {
        inputTokens: toTokenCount(usage.input_tokens),
        cachedInputTokens: toTokenCount(usage.cached_input_tokens),
        outputTokens: toTokenCount(usage.output_tokens)
    };
}

function subtractUsage(current: CodexUsageSnapshot, previous: CodexUsageSnapshot): CodexUsageSnapshot {
    return {
        inputTokens: current.inputTokens - previous.inputTokens,
        cachedInputTokens: current.cachedInputTokens - previous.cachedInputTokens,
        outputTokens: current.outputTokens - previous.outputTokens
    };
}

function hasNegativeTokens(usage: CodexUsageSnapshot): boolean {
    return usage.inputTokens < 0 || usage.cachedInputTokens < 0 || usage.outputTokens < 0;
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

function isJsonObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
    return typeof value === 'object' && value !== null && 'code' in value;
}
