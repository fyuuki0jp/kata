import { cac } from 'cac';
import { registerCompileCommand } from './commands/compile';
import { registerCoverageCommand } from './commands/coverage';
import { registerDocCommand } from './commands/doc';
import { registerInitCommand } from './commands/init';
import { registerMigrateCommand } from './commands/migrate';
import { registerVerifyCommand } from './commands/verify';

const cli = cac('seizu');

registerInitCommand(cli);
registerDocCommand(cli);
registerVerifyCommand(cli);
registerCoverageCommand(cli);
registerCompileCommand(cli);
registerMigrateCommand(cli);

cli.help();
cli.version('2.0.0');
cli.parse();
