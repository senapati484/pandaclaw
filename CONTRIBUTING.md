# Contributing to PandaClaw

Thanks for your interest in PandaClaw! This document outlines how to contribute, report issues, and submit changes.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/your-username/pandaclaw`
3. Install dependencies: `bun install`
4. Create a branch: `git checkout -b feat/my-feature`

## Development

```bash
bun run typecheck    # TypeScript type check
bun test             # Run all 93 tests
bun run ask          # Test the ask mode
```

## Code Style

- Use TypeScript with strict types
- No semicolons (project convention)
- No commented-out code or unnecessary comments
- Use `async/await` over callbacks
- Import types with `import type { ... }`
- Use absolute paths for file system operations
- Use `Bun.file()` over `fs.readFile` where possible

## Pull Request Process

1. Ensure all tests pass (`bun test`)
2. Ensure type check passes (`bun run typecheck`)
3. Write tests for new features
4. Keep PRs focused on a single change
5. Reference any related issues

## Reporting Issues

- Use the GitHub issue tracker
- Include the error output and steps to reproduce
- Mention which mode (ask/agent/plan) and provider chain was used

## Feature Requests

Open an issue describing the feature, why it's useful, and how it might work. For complex features, include a brief sketch of the implementation approach.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
