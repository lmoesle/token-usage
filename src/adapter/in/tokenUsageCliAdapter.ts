import { Command } from 'commander';
import { TokenUsageUseCase } from '../../application/usecases/tokenUsageUseCase';
import { ConsoleTokenUsagePresenter } from '../out/consoleTokenUsagePresenter';
import { CodingAgentTokenUsageAdapter } from '../out/codingAgentTokenUsageAdapter';
import { DEFAULT_OPENCODE_DB_PATH, OpencodeTokenUsageHandler } from '../out/opencodeTokenUsageAdapter';
import { JsonTokenUsagePresenter } from '../out/jsonTokenUsagePresenter';
import { LoadTokenPricesOutPort, LoadTokenUsageOutPort } from '../../application/ports/out/tokenUsageOutPort';
import { TokenPriceConfigAdapter } from '../out/tokenPriceConfigAdapter';
import { DEFAULT_VIBE_SESSION_DIR, VibeTokenUsageHandler } from '../out/vibeTokenUsageAdapter';
import { CodexTokenUsageHandler, DEFAULT_CODEX_HOME_DIR } from '../out/codexTokenUsageAdapter';

declare const TOKEN_USAGE_CLI_VERSION: string | undefined;

const cliVersion = typeof TOKEN_USAGE_CLI_VERSION === 'string'
    ? TOKEN_USAGE_CLI_VERSION
    : process.env.npm_package_version ?? '0.2.0';

interface TokenUsageCliOptions {
    raw?: boolean;
    opencodeDb?: string;
    vibeSessionDir?: string;
    codexHome?: string;
}

export interface TokenUsageCliDependencies {
    now?: () => Date;
    writeLine?: (line: string) => void;
    loadTokenUsageOutPort?: LoadTokenUsageOutPort;
    loadTokenPricesOutPort?: LoadTokenPricesOutPort;
}

export function createTokenUsageCli(dependencies: TokenUsageCliDependencies = {}): Command {
    const program = new Command();
    const writeLine = dependencies.writeLine ?? console.log;

    program
        .name('token-usage')
        .description('Track AI token usage across supported agents')
        .version(cliVersion)
        .argument('<time-period>', 'time period to view: today, daily, weekly, monthly or yearly')
        .option('--raw', 'print token usage as JSON instead of a table')
        .option('--opencode-db <path>', `path to the opencode SQLite database (default: ${DEFAULT_OPENCODE_DB_PATH})`)
        .option('--vibe-session-dir <path>', `path to the vibe session logs directory (default: ${DEFAULT_VIBE_SESSION_DIR})`)
        .option('--codex-home <path>', `path to the codex home directory (default: ${DEFAULT_CODEX_HOME_DIR})`)
        .action(async (timePeriod: string, options: TokenUsageCliOptions) => {
            const loadTokenUsageOutPort = dependencies.loadTokenUsageOutPort
                ?? new CodingAgentTokenUsageAdapter([
                    new OpencodeTokenUsageHandler(options.opencodeDb ?? DEFAULT_OPENCODE_DB_PATH),
                    new VibeTokenUsageHandler(options.vibeSessionDir ?? DEFAULT_VIBE_SESSION_DIR),
                    new CodexTokenUsageHandler(options.codexHome ?? DEFAULT_CODEX_HOME_DIR)
                ]);
            const loadTokenPricesOutPort = dependencies.loadTokenPricesOutPort ?? new TokenPriceConfigAdapter();
            const showTokenUsageOutPort = options.raw
                ? new JsonTokenUsagePresenter(writeLine)
                : new ConsoleTokenUsagePresenter(writeLine);
            const viewTokenUsageInPort = new TokenUsageUseCase(loadTokenUsageOutPort, loadTokenPricesOutPort, showTokenUsageOutPort, dependencies.now);

            await viewTokenUsageInPort.viewTokenUsage({ timePeriod });
        });

    return program;
}

export async function runTokenUsageCli(argv: string[] = process.argv): Promise<void> {
    await createTokenUsageCli().parseAsync(argv);
}
