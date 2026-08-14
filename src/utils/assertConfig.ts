import chalk from 'chalk';
import type { IConfigService } from '../services/interfaces/IConfigService';

/** Validate the resolved config and exit with a clear message when invalid. */
export function assertConfig(cfg: IConfigService): void {
  const { valid, missing } = cfg.validate();
  if (!valid) {
    console.error(chalk.red(`Missing config: ${missing.join(', ')}. Run: flowlane init`));
    process.exit(1);
  }
}
