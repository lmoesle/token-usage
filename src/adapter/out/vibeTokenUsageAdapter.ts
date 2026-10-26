import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
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
                .filter((entry) => entry.isDirectory() && entry.name !== 'unified')
                .map((entry) => path.join(resolvedSessionDir, entry.name))
                .sort();

            const measurements = await Promise.all(
                sessionPaths.map((sessionPath) => this.loadSessionUsage(sessionPath, range))
            );

            const unifiedRoot = path.join(resolvedSessionDir, 'unified');
            const unifiedSessions = await listSessionDirectories(unifiedRoot);
            const unifiedMeasurements = await Promise.all(unifiedSessions.map(
                (sessionPath) => this.loadUnifiedSessionUsage(sessionPath, range)
            ));

            return [...measurements.flat(), ...unifiedMeasurements.flat()];
        } catch (err: unknown) {
            if (isNodeError(err) && err.code === 'ENOENT') {
                return [];
            }

            const error = err instanceof Error ? err : new Error(String(err));
            throw new Error(`Failed to read vibe usage sessions at ${resolvedSessionDir}: ${error.message}`, { cause: err });
        }
    }

    private async loadUnifiedSessionUsage(sessionPath: string, range?: TimeRange): Promise<TokenUsageMeasurement[]> {
        try {
            const id = path.basename(sessionPath);
            const current = requireObject(JSON.parse(await readStoreFile(sessionPath, 'CURRENT')));
            const minor = current.store_format_minor ?? 1;
            requireValid(current.store_format === 'mistral.vibe.unified-session-store/v1'
                && isSequence(minor) && minor >= 1 && minor <= 8, 'unsupported unified store format');
            requireValid(current.session_id === id && typeof current.generation === 'string'
                && /^[0-9]{16}$/.test(current.generation) && isSequence(current.snapshot_sequence), 'invalid CURRENT identity or generation');
            const generation = `generations/${current.generation}`;
            const manifest = await readStoreDocument(sessionPath, `${generation}/manifest.json`, current.manifest_sha256);
            const sequence = current.snapshot_sequence as number;
            requireValid(manifest.manifest_version === 1 && manifest.session_id === id
                && manifest.generation === current.generation && manifest.snapshot_sequence === sequence, 'CURRENT and manifest disagree');
            const readReference = async (reference: unknown): Promise<JsonObject> => {
                const file = requireObject(reference);
                requireValid(typeof file.path === 'string' && /^[^/\\]+$/.test(file.path)
                    && file.path !== '.' && file.path !== '..', 'invalid generation file reference');
                return readStoreDocument(sessionPath, `${generation}/${file.path}`, file.sha256);
            };
            const projection = await readReference(manifest.projection_state);
            const runtime = await readReference(manifest.runtime_state);
            requireValid(projection.projection_state_version === 1 && runtime.runtime_state_version === 3,
                'unsupported unified state version');
            for (const state of [projection, runtime]) {
                requireValid(state.session_id === id && state.snapshot_sequence === sequence, 'invalid state identity or sequence');
            }
            const journal = requireObject(manifest.recovery_journal_segment);
            requireValid(journal.first_sequence === sequence + 1 && typeof journal.path === 'string'
                && /^journal\/[0-9]{16}\.jsonl$/.test(journal.path), 'invalid recovery journal reference');
            let session = requireObject(requireObject(projection.snapshot).session);
            let watermark = projection.watermark;
            requireValid(isSequence(watermark), 'invalid projection watermark');
            let expectedSequence = sequence + 1;
            const lines = (await readStoreFile(sessionPath, journal.path as string)).split('\n');
            // Only newline-terminated records are committed; the live writer may be appending the final line.
            for (const line of lines.slice(0, -1)) {
                const record = requireObject(JSON.parse(line));
                requireValid(record.recovery_journal_record_version === 1 && record.sequence === expectedSequence,
                    'invalid recovery journal version or sequence gap');
                expectedSequence++;
                const payload = requireObject(record.payload);
                if (record.type !== 'projection_advanced' && record.type !== 'projection_delta') {
                    continue;
                }
                requireValid(isSequence(payload.watermark) && (payload.watermark as number) >= (watermark as number),
                    'projection watermark moved backwards');
                watermark = payload.watermark;
                if (record.type === 'projection_advanced') {
                    session = requireObject(requireObject(payload.snapshot).session);
                } else {
                    requireValid(Array.isArray(payload.delta), 'invalid projection delta');
                    for (const value of payload.delta as unknown[]) {
                        const delta = requireObject(value);
                        if (delta.op === 'set_envelope') {
                            session = requireObject(requireObject(delta.state).session);
                        }
                    }
                }
            }
            requireValid(session.id === id, 'projection session identity mismatch');
            const startedAt = typeof session.createdAt === 'number' ? new Date(session.createdAt) : undefined;
            if (startedAt === undefined || Number.isNaN(startedAt.getTime()) || isOutsideRange(startedAt, range)) {
                return [];
            }
            if (session.tokenUsage === undefined || session.tokenUsage === null) {
                return [];
            }
            const usage = requireObject(session.tokenUsage);
            const input = toTokenCount(usage.inputTokens);
            const outputTokens = toTokenCount(usage.outputTokens);
            const cachedTokens = Math.min(input, toTokenCount(usage.cachedInputTokens));
            if (input + outputTokens === 0) {
                return [];
            }
            return [{
                date: toDateKey(startedAt), agent: VIBE_AGENT,
                model: readModel(isJsonObject(runtime.session_metadata) ? runtime.session_metadata : {}),
                inputTokens: input - cachedTokens, outputTokens, cachedTokens
            }];
        } catch (err: unknown) {
            if (isNodeError(err) && err.code === 'ENOENT') {
                return [];
            }
            throw err;
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

        const promptTokens = toTokenCount(stats.session_prompt_tokens ?? stats.prompt_tokens);
        const outputTokens = toTokenCount(stats.session_completion_tokens ?? stats.completion_tokens);
        const cachedTokens = Math.min(promptTokens, toTokenCount(stats.session_cached_tokens ?? stats.cached_tokens));
        const inputTokens = promptTokens - cachedTokens;
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

async function listSessionDirectories(directory: string): Promise<string[]> {
    try {
        const stat = await fs.lstat(directory);
        requireValid(!stat.isSymbolicLink(), 'linked unified session directory');
        return (await fs.readdir(directory, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(directory, entry.name)).sort();
    } catch (err: unknown) {
        if (isNodeError(err) && err.code === 'ENOENT') {
            return [];
        }
        throw err;
    }
}

async function readStoreFile(root: string, relativePath: string): Promise<string> {
    let target = root;
    for (const component of relativePath.split('/')) {
        requireValid(component !== '' && component !== '.' && component !== '..' && !component.includes('\\'), 'invalid store path');
        target = path.join(target, component);
        requireValid(!(await fs.lstat(target)).isSymbolicLink(), 'linked unified store file');
    }
    return fs.readFile(target, 'utf8');
}

async function readStoreDocument(root: string, relativePath: string, digest: unknown): Promise<JsonObject> {
    const document = await readStoreFile(root, relativePath);
    // Stored digests cover the JSON body, excluding the writer's terminating newline.
    const raw = document.endsWith('\n') ? document.slice(0, -1) : document;
    requireValid(typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest)
        && createHash('sha256').update(raw).digest('hex') === digest, 'unified store document digest mismatch');
    return requireObject(JSON.parse(raw));
}

function requireValid(valid: boolean, message: string): void {
    if (!valid) {
        throw new Error(message);
    }
}

function requireObject(value: unknown): JsonObject {
    if (!isJsonObject(value)) {
        throw new Error('invalid unified store object');
    }
    return value;
}

function isSequence(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
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
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function toOptionalNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
    return typeof value === 'object' && value !== null && 'code' in value;
}
