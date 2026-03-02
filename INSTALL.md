# Installing `flowlane` as a Global CLI Command

## Prerequisites

- Node.js installed
- Project dependencies installed (`npm install`)

## Steps

### 1. Build the project

```bash
npm run build
```

This compiles the TypeScript source into `dist/`.

### 2. Link globally

```bash
npm link
```

This registers `flowlane` as a command available system-wide by creating a symlink in your global Node.js bin directory.

### 3. Use it

```bash
flowlane
```

Run from any directory in your terminal.

## How it works

| Piece | Role |
|---|---|
| `"bin": { "flowlane": "dist/index.js" }` in `package.json` | Tells npm which file to expose as the command |
| `#!/usr/bin/env node` at the top of `dist/index.js` | Tells the OS to execute the file with Node.js |
| `npm link` | Creates a global symlink pointing to this project |

## Rebuilding

If you make changes to the source, rebuild before using the command:

```bash
npm run build
```

No need to re-run `npm link` after rebuilding.

## Uninstall

```bash
npm unlink -g flowlane
```

## Publishing (optional)

To make `flowlane` installable by others via npm:

```bash
npm publish
```

Users can then install it with:

```bash
npm install -g flowlane
```
