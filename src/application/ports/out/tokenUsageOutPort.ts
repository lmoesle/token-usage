import { TimeRange, TokenPrices, TokenUsageMeasurement, TokenUsageReport } from '../../../domain/tokenUsage';

export interface LoadTokenUsageOutPort {
    loadTokenUsage(range?: TimeRange): Promise<TokenUsageMeasurement[]>;
}

export interface ShowTokenUsageOutPort {
    showTokenUsage(report: TokenUsageReport): void;
}

export interface LoadTokenPricesOutPort {
    loadTokenPrices(): Promise<TokenPrices>;
}
