# Contributing to ChromaCode

Thanks for your interest in contributing! Here's how to get started.

## Prerequisites

- **Node.js 18+**
- **npm**
- Optional: C compiler (gcc or clang) + zlib/libpng headers for the native addon

## Setup

```bash
git clone https://github.com/1adam12vibecoder-create/chromacode.git
cd chromacode
npm install
npm test
```

To build and test the native C addon:

```bash
npm run build:native:c
npm run test:native
```

## Code Style

Code style is enforced by ESLint and Prettier. Before submitting a PR:

```bash
npm run lint
npm run format:check
```

To auto-fix formatting:

```bash
npm run format
```

## Pull Request Process

1. Branch from `main`
2. Make your changes
3. Add or update tests for any new behavior
4. Ensure all checks pass: `npm run lint && npm run typecheck && npm test`
5. Open a PR with a clear description of the change

## Reporting Issues

Please use the [GitHub Issues](https://github.com/1adam12vibecoder-create/chromacode/issues) page to report bugs or request features.
