import { createTokenUsageCli } from '../../dist';

const program = createTokenUsageCli();
void program.parseAsync(['node', 'token-usage', 'today']);
