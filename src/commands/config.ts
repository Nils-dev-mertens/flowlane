import chalk from 'chalk';
import { container } from '../container';
import { TOKENS } from '../tokens';
import type { IConfigService } from '../services/interfaces/IConfigService';
import type { FlowlaneConfig } from '../types';

export function configSetCommand(key: string, value: string): void {
  const cfg = container.resolve<IConfigService>(TOKENS.ConfigService);
  cfg
    .set(key as keyof FlowlaneConfig, value)
    .then(() => {
      const displayVal = key === 'token' ? chalk.dim('***') : value;
      console.log(`${chalk.green('✓')} Set ${chalk.cyan(key)} = ${displayVal}`);
    })
    .catch((err: unknown) => {
      console.error(chalk.red(`Failed to set config: ${errMsg(err)}`));
      process.exit(1);
    });
}

export function configGetCommand(key: string): void {
  const cfg   = container.resolve<IConfigService>(TOKENS.ConfigService);
  const value = cfg.get(key as keyof FlowlaneConfig);

  if (value === undefined) {
    console.log(chalk.yellow(`"${key}" is not set.`));
  } else {
    console.log(key === 'token' ? chalk.dim('***') : value);
  }
}

export function configListCommand(): void {
  const cfg = container.resolve<IConfigService>(TOKENS.ConfigService);

  if (!cfg.exists()) {
    console.log(chalk.yellow('No config found. Run: flowlane init'));
    return;
  }

  const config = cfg.getAll();

  console.log(chalk.bold('Current configuration:'));
  for (const [key, value] of Object.entries(config)) {
    const display = key === 'token' ? chalk.dim('***') : String(value);
    console.log(`  ${chalk.cyan(key.padEnd(14))} ${display}`);
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
