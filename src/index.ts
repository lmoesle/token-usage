import { Command } from 'commander';

const GREETING = 'Hello, token-usage!';

export function getGreetingMessage(): string {
    return GREETING;
}

function createCli(): void {
    const program = new Command();

    program
        .name('token-usage')
        .description('Track AI token usage across sessions')
        .version('0.1.0')
        .action(() => {
            console.log(getGreetingMessage());
        });

    program.parse(process.argv);
}

if (require.main === module) {
    createCli();
}
