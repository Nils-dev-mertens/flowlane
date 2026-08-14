import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

for (const file of collectTestFiles(__dirname)) {
  // Tests are loaded before Node's test runner starts executing them. This
  // keeps `npm test` as one command without maintaining a test-file list.
  require(file);
}

function collectTestFiles(directory: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      files.push(...collectTestFiles(path));
    } else if (entry.endsWith('.test.ts')) {
      files.push(path);
    }
  }

  return files.sort();
}
