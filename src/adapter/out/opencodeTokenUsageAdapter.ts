import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { LoadTokenUsageOutPort } from '../../application/ports/out/tokenUsageOutPort';
import { TimeRange, TokenUsageMeasurement, toDateKey } from '../../domain/tokenUsage';

export const DEFAULT_OPENCODE_DB_PATH = '~/.local/share/opencode/opencode.db';
const OPENCODE_AGENT = 'opencode';
type OpenDatabase = (dbPath: string) => DatabaseSync;

interface OpencodeSessionRow {
    time_created: number;
    model: string | null;
    tokens_input: number;
    tokens_output: number;
    tokens_cache_read: number;
    tokens_cache_write: number;
}

export class OpencodeTokenUsageAdapter implements LoadTokenUsageOutPort {
    constructor(
        private dbPath: string = DEFAULT_OPENCODE_DB_PATH,
        private openDatabase: OpenDatabase = (dbPath) => new DatabaseSync(dbPath, { readOnly: true })
    ) {}

    async loadTokenUsage(range?: TimeRange): Promise<TokenUsageMeasurement[]> {
        const resolvedDbPath = expandHome(this.dbPath);
        let database: DatabaseSync | undefined;

        try {
            database = this.openDatabase(resolvedDbPath);
            const statement = database.prepare(this.createQuery(range));

            const rows = range === undefined
                ? statement.all() as unknown as OpencodeSessionRow[]
                : statement.all(range.start.getTime(), range.endExclusive.getTime()) as unknown as OpencodeSessionRow[];

            return rows.flatMap((row) => this.mapRow(row));
        } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error(String(err));
            throw new Error(`Failed to read opencode usage database at ${resolvedDbPath}: ${error.message}`);
        } finally {
            database?.close();
        }
    }

    private createQuery(range?: TimeRange): string {
        const timeFilter = range === undefined
            ? ''
            : `AND time_created >= ?
                  AND time_created < ?`;

        return `
                SELECT
                    time_created,
                    model,
                    tokens_input,
                    tokens_output,
                    tokens_cache_read,
                    tokens_cache_write
                FROM session
                WHERE 1 = 1
                  ${timeFilter}
                  AND model IS NOT NULL
                  AND model <> ''
                ORDER BY time_created ASC
            `;
    }

    private mapRow(row: OpencodeSessionRow): TokenUsageMeasurement[] {
        const model = this.mapModel(row.model);
        const inputTokens = toTokenCount(row.tokens_input);
        const outputTokens = toTokenCount(row.tokens_output);
        const cachedTokens = toTokenCount(row.tokens_cache_read) + toTokenCount(row.tokens_cache_write);

        if (model === undefined || inputTokens + outputTokens + cachedTokens === 0) {
            return [];
        }

        return [{
            date: toDateKey(new Date(toTokenCount(row.time_created))),
            agent: OPENCODE_AGENT,
            model,
            inputTokens,
            outputTokens,
            cachedTokens
        }];
    }

    private mapModel(rawModel: string | null): string | undefined {
        if (rawModel === null || rawModel.trim().length === 0) {
            return undefined;
        }

        try {
            const parsed = JSON.parse(rawModel) as { id?: unknown };
            if (typeof parsed.id === 'string' && parsed.id.length > 0) {
                return parsed.id;
            }
        } catch {
            return rawModel;
        }

        return rawModel;
    }
}

function expandHome(filePath: string): string {
    if (filePath === '~') {
        return os.homedir();
    }

    if (filePath.startsWith('~/')) {
        return path.join(os.homedir(), filePath.slice(2));
    }

    return filePath;
}

function toTokenCount(value: number): number {
    return Number.isFinite(value) ? value : 0;
}
