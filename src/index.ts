import { runTokenUsageCli } from './adapter/in/tokenUsageCliAdapter';

export { createTokenUsageCli, runTokenUsageCli } from './adapter/in/tokenUsageCliAdapter';
export { TokenUsageUseCase } from './application/usecases/tokenUsageUseCase';
export type { ViewTokenUsageInPort, ViewTokenUsageCommand } from './application/ports/in/tokenUsageInPort';
export type { LoadTokenUsageOutPort, ShowTokenUsageOutPort } from './application/ports/out/tokenUsageOutPort';
export type { TimePeriod, TimeRange, TokenUsageEntry, TokenUsageMeasurement, TokenUsageReport, TokenUsageTotals } from './domain/tokenUsage';

if (require.main === module) {
    runTokenUsageCli().catch((err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error(error.message);
        process.exit(1);
    });
}
