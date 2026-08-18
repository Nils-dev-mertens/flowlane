import assert from 'node:assert/strict';
import test from 'node:test';
import { safeSpinner, isInteractive } from '../../src/utils/tty';

test('safeSpinner falls back to plain stderr output when not interactive', () => {
  const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  const originalCI = process.env['CI'];
  Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
  process.env['CI'] = undefined;

  try {
    assert.equal(isInteractive(), false);
    const spinner = safeSpinner();
    assert.ok(spinner);

    const lines: string[] = [];
    const originalWrite = process.stderr.write;
    (process.stderr.write as unknown as (chunk: string) => boolean) = (chunk: string) => {
      lines.push(chunk);
      return true;
    };

    try {
      spinner.start('Working…');
      spinner.stop('Done.');
    } finally {
      process.stderr.write = originalWrite;
    }

    assert.ok(lines.some((line) => line.includes('Working…')));
    assert.ok(lines.some((line) => line.includes('Done.')));
  } finally {
    if (originalIsTTY) {
      Object.defineProperty(process.stdout, 'isTTY', originalIsTTY);
    }
    if (originalCI !== undefined) {
      process.env['CI'] = originalCI;
    } else {
      delete process.env['CI'];
    }
  }
});

test('safeSpinner never throws even when the TTY is reported as interactive', () => {
  const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  const originalCI = process.env['CI'];
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  process.env['CI'] = undefined;

  try {
    assert.equal(isInteractive(), true);
    // Even with a "live" TTY the wrapper must never throw synchronously.
    assert.doesNotThrow(() => {
      const spinner = safeSpinner();
      spinner.start('Loading…');
      spinner.stop('Loaded.');
    });
  } finally {
    if (originalIsTTY) {
      Object.defineProperty(process.stdout, 'isTTY', originalIsTTY);
    }
    if (originalCI !== undefined) {
      process.env['CI'] = originalCI;
    } else {
      delete process.env['CI'];
    }
  }
});