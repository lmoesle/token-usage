import { LoadTokenUsageOutPort } from '../../application/ports/out/tokenUsageOutPort';
import { TimeRange, TokenUsageMeasurement } from '../../domain/tokenUsage';
import { usagePathExists } from './usagePath';

export interface CodingAgentUsageHandler {
    readonly agent: string;
    readonly usagePath: string;
    createAdapter(): LoadTokenUsageOutPort;
}

export type UsagePathExists = (usagePath: string) => boolean;

export class CodingAgentTokenUsageAdapter implements LoadTokenUsageOutPort {
    constructor(
        private handlers: CodingAgentUsageHandler[],
        private pathExists: UsagePathExists = usagePathExists
    ) {}

    async loadTokenUsage(range?: TimeRange): Promise<TokenUsageMeasurement[]> {
        const activeAdapters = this.handlers
            .filter((handler) => this.pathExists(handler.usagePath))
            .map((handler) => handler.createAdapter());

        const measurementsByAgent = await Promise.all(
            activeAdapters.map((adapter) => adapter.loadTokenUsage(range))
        );

        return measurementsByAgent.flat();
    }
}
