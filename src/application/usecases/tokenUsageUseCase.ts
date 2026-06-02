import { ViewTokenUsageCommand, ViewTokenUsageInPort } from '../ports/in/tokenUsageInPort';
import { LoadTokenUsageOutPort, ShowTokenUsageOutPort } from '../ports/out/tokenUsageOutPort';
import { createTimeRange, createTokenUsageReport, parseTimePeriod } from '../../domain/tokenUsage';

export class TokenUsageUseCase implements ViewTokenUsageInPort {
    constructor(
        private loadTokenUsageOutPort: LoadTokenUsageOutPort,
        private showTokenUsageOutPort: ShowTokenUsageOutPort,
        private now: () => Date = () => new Date()
    ) {}

    async viewTokenUsage(command: ViewTokenUsageCommand): Promise<void> {
        const period = parseTimePeriod(command.timePeriod);
        const range = createTimeRange(period, this.now());
        const measurements = await this.loadTokenUsageOutPort.loadTokenUsage(range);
        const report = createTokenUsageReport(period, measurements, range);

        this.showTokenUsageOutPort.showTokenUsage(report);
    }
}
