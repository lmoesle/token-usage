import { Command } from 'commander';
import { TokenUsageUseCase } from '../../application/usecases/tokenUsageUseCase';
import { ConsoleTokenUsagePresenter } from '../out/consoleTokenUsagePresenter';
import { DEFAULT_OPENCODE_DB_PATH, OpencodeTokenUsageAdapter } from '../out/opencodeTokenUsageAdapter';
import { JsonTokenUsagePresenter } from '../out/jsonTokenUsagePresenter';
import { LoadTokenUsageOutPort } from '../../application/ports/out/tokenUsageOutPort';

interface TokenUsageCliOptions {
    raw?: boolean;
    opencodeDb?: string;
}

export interface TokenUsageCliDependencies {
    now?: () => Date;
    writeLine?: (line: string) => void;
    loadTokenUsageOutPort?: LoadTokenUsageOutPort;
}

export function createTokenUsageCli(dependencies: TokenUsageCliDependencies = {}): Command {
    const program = new Command();
    const writeLine = dependencies.writeLine ?? console.log;

    program
        .name('token-usage')
        .description('Track AI token usage across supported agents')
        .version('0.1.0')
        .argument('<time-period>', 'time period to view: today, daily, weekly, monthly or yearly')
        .option('--raw', 'print token usage as JSON instead of a table')
        .option('--opencode-db <path>', `path to the opencode SQLite database (default: ${DEFAULT_OPENCODE_DB_PATH})`)
        .action(async (timePeriod: string, options: TokenUsageCliOptions) => {
            const loadTokenUsageOutPort = dependencies.loadTokenUsageOutPort
                ?? new OpencodeTokenUsageAdapter(options.opencodeDb ?? DEFAULT_OPENCODE_DB_PATH);
            const showTokenUsageOutPort = options.raw
                ? new JsonTokenUsagePresenter(writeLine)
                : new ConsoleTokenUsagePresenter(writeLine);
            const viewTokenUsageInPort = new TokenUsageUseCase(loadTokenUsageOutPort, showTokenUsageOutPort, dependencies.now);

            await viewTokenUsageInPort.viewTokenUsage({ timePeriod });
        });

    return program;
}

export async function runTokenUsageCli(argv: string[] = process.argv): Promise<void> {
    await createTokenUsageCli().parseAsync(argv);
}
