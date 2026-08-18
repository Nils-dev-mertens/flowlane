import { readFile } from 'node:fs/promises';

/**
 * Resolve free-form body content (comment, reply, description) from an inline
 * string, a file path, or stdin.
 *
 * Precedence: `file` (--body-file) → `-` (stdin) → inline `text` → null.
 *
 * @param text Inline text; `-` means "read from stdin".
 * @param file Optional path whose contents become the text.
 * @returns The resolved text, or null when no source was provided.
 */
export async function resolveTextInput(text: string | undefined, file?: string): Promise<string | null> {
  if (file) {
    return readFile(file, 'utf8');
  }
  if (text === '-') {
    return readStdin();
  }
  if (text !== undefined) {
    return text;
  }
  return null;
}

/** Read all of stdin as UTF-8, stripping a single trailing newline. */
export function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data.replace(/\r?\n$/, '')));
    process.stdin.on('error', reject);
    process.stdin.resume();
  });
}
