import { ShowTokenUsageOutPort } from '../../application/ports/out/tokenUsageOutPort';
import { TokenUsageReport } from '../../domain/tokenUsage';

export class JsonTokenUsagePresenter implements ShowTokenUsageOutPort {
    constructor(private writeLine: (line: string) => void = console.log) {}

    showTokenUsage(report: TokenUsageReport): void {
        this.writeLine(JSON.stringify(report, null, 2));
    }
}
