# Contributing to Cartographer

Thank you for your interest in contributing! This guide explains how to report issues, propose changes, and submit pull requests.

## Table of Contents

- [AI-Assisted Contributions](#ai-assisted-contributions)
- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Reporting Issues](#reporting-issues)
- [Proposing Changes](#proposing-changes)
- [Submitting Pull Requests](#submitting-pull-requests)
- [Testing Requirements](#testing-requirements)
- [Code Review Process](#code-review-process)
- [Questions?](#questions)

---

## AI-Assisted Contributions

**AI assistance is welcome.** Use Claude, Copilot, Cursor, or anything else
you find useful. We care about the quality of the contribution, not the tools
that produced it.

One hard rule:

> **Commits must be authored under your own name, not the tool's.**
> **Do not credit an AI as an author of a commit.**

This holds no matter how much of the change a tool wrote. If an agent made the
commit for you, the author and committer must still be you, with your own name
and email.

Commit authorship records the person accountable for the change. An AI is a
tool, not a contributor, and it cannot answer questions in review, respond to a
regression, or stand behind the work six months from now. You can.

### What that means in practice

Do not put an AI's name or address in:

- the `Author:` or `Committer:` field
- a `Co-Authored-By:` trailer
- any other authorship trailer, such as `Signed-off-by:`

```
# Rejected
Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>
Co-Authored-By: Copilot <copilot@github.com>

# Fine
Co-Authored-By: Sam Patel <sam@example.com>
```

Several coding agents add a `Co-Authored-By:` trailer by default. Turn it off,
or strip it before you push:

| Tool | How |
|---|---|
| Claude Code | `"attribution": { "commit": "", "pr": "" }` in `.claude/settings.json` (older versions: `includeCoAuthoredBy: false`) |
| GitHub Copilot | Disable commit co-authorship in editor settings |
| Any tool | `git commit --amend` and delete the trailer before pushing |

To check a branch before opening a PR:

```bash
git log origin/trunk..HEAD --format='%an <%ae>%n%(trailers)' | \
  grep -iE 'claude|copilot|chatgpt|gpt-|gemini|cursor|codeium|anthropic|openai' \
  && echo "AI attribution found - amend before pushing"
```

### What is fine, and encouraged

- Saying in the **PR description** that you used AI assistance, and how. That
  is useful context for a reviewer and is not authorship.
- Mentioning it in a commit **body** as prose, e.g. "Drafted with an AI
  assistant, reviewed and corrected by hand."
- Pasting AI-generated analysis into an issue or review comment.

The distinction is simple: describing your process is welcome, assigning
authorship is not.

### Your responsibility for AI-generated code

By opening a PR you are asserting that you:

- have **read and understood** every line you are submitting
- have **run the tests** (see [Testing Requirements](#testing-requirements)),
  not just watched a tool claim they pass
- can **explain and defend** the change in review
- believe the contribution does not infringe anyone's licence or copyright

AI-generated code gets exactly the same review as anything else. Review time is
the scarce resource here, so a large unreviewed dump is more likely to be closed
than merged. If you would not be comfortable being asked "why does this line
exist?", it is not ready.

---

## Code of Conduct

We are committed to providing a welcoming and inclusive environment for all contributors.

**Expected Behavior:**

- Be respectful and constructive in all interactions
- Welcome diverse perspectives and backgrounds
- Focus on ideas, not personal attacks
- Help others learn and grow

**Unacceptable Behavior:**

- Harassment, discrimination, or hateful language
- Trolling or personal attacks
- Intentional disruption of discussions
- Unwelcome advances or contact

**Reporting Violations:**
Please contact maintainers privately if you witness unacceptable behavior.

---

## Getting Started

### Setup Your Environment

1. **Fork and clone the repository:**

   ```bash
   git clone https://github.com/YOUR_USERNAME/friendly-octo-train.git
   cd friendly-octo-train
   ```

2. **Create a feature branch:**

   ```bash
   git checkout -b feature/your-feature-name
   # or for bug fixes:
   git checkout -b fix/issue-description
   ```

3. **Install and build** (Node.js 22 or later):

   ```bash
   npm install
   npm run build:all   # TypeScript + in-page analyzer bundle
   ```

4. **Verify setup:**

   ```bash
   npm run benchmark:install   # one-off, for the integration fixture
   npm test
   ```

For detailed setup and development instructions, see [DEVELOPMENT.md](DEVELOPMENT.md).

---

## Reporting Issues

### Before Reporting

- Check existing issues to avoid duplicates
- Test with the latest code (`npm run build`)
- Verify you can reproduce the problem consistently

### Reporting a Bug

Please include:

1. **Title:** Clear, concise description
   - ❌ `Error`
   - ✅ `crawl_and_analyze fails with timeout on large pages`

2. **Description:** What you expected vs. what happened
3. **Steps to reproduce:** Exact steps to trigger the issue
4. **Environment:**
   - Node.js version (`node --version`)
   - OS (macOS, Linux, Windows)
   - Browser version (`chrome --version`)

5. **Logs/Error messages:** Full stack trace or error output
6. **Optional:** Screenshots, video, or link to problematic URL

### Reporting a Feature Request

Include:

- **Title:** What feature to add
- **Motivation:** Why this would be useful
- **Possible solution:** Your suggested implementation (optional)
- **Alternatives:** Other approaches you've considered

### Issue Template

```markdown
## Bug Report

**Description:**
...

**Steps to reproduce:**
1. ...
2. ...
3. ...

**Expected behavior:**
...

**Actual behavior:**
...

**Environment:**
- Node.js: X.X.X
- OS: ...
- Chrome: X.X.X

**Logs:**
\`\`\`
[paste error or log output]
\`\`\`

**Additional context:**
...
```

---

## Proposing Changes

### For Small Changes

Open an issue to discuss before investing significant effort. This prevents wasted work if:

- Your idea doesn't align with project goals
- Someone is already working on it
- The approach should be different

### For Large Features

1. **Open an issue** with:
   - Problem statement
   - Proposed solution
   - Implementation approach
   - Estimated effort

2. **Get feedback** from maintainers
3. **Proceed with implementation** once approved

### Design Principles

Changes should:

- **Be incremental**: Small, focused PRs are easier to review
- **Maintain backward compatibility**: Don't break existing APIs
- **Add tests**: New features need corresponding tests
- **Update documentation**: Add or update relevant docs
- **Follow code style**: Match existing patterns in the codebase

---

## Submitting Pull Requests

### Before You Start

1. **Fork the repository** on GitHub
2. **Create a feature branch** from `main`
3. **Keep a clean history**: One feature per branch

### During Development

```bash
# Make changes
vim src/analyzer.ts

# Run dev mode for quick testing
npm run dev

# Build when ready
npm run build

# Run all tests
npm test
```

### Preparing Your PR

1. **Update code** with your changes
2. **Run tests** to ensure nothing breaks
3. **Update documentation** if behavior changed:
   - Update README if public API changed
   - Update relevant sections in USAGE.md or DEVELOPMENT.md
4. **Write a clear commit message:**

   ```
   Brief description of change (50 chars max)

   - More detailed explanation
   - What problem does it solve?
   - Any breaking changes?
   ```

### PR Checklist

Before submitting, ensure:

- [ ] Code follows project style (check [DEVELOPMENT.md](DEVELOPMENT.md#code-style--conventions))
- [ ] All tests pass (`npm test`)
- [ ] No console errors or warnings
- [ ] TypeScript compiles without errors (`npm run build`)
- [ ] New features have tests
- [ ] Documentation is updated
- [ ] Commit messages are clear
- [ ] No AI is credited as a commit author ([why](#ai-assisted-contributions))
- [ ] PR description explains the change

### Submitting the PR

1. **Push to your fork:**

   ```bash
   git push origin feature/your-feature-name
   ```

2. **Open a PR on GitHub** with:
   - Clear title (same as commit message)
   - Description of changes
   - Reference to any related issues (#123)
   - Screenshots/examples if applicable

### PR Template

```markdown
## Description
Brief explanation of what this PR does.

Fixes #[issue number]

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Performance improvement
- [ ] Refactoring

## Changes
- Change 1
- Change 2
- Change 3

## Testing
How was this tested?
- [ ] Tested locally with `npm test`
- [ ] Manual testing: ...
- [ ] Added new tests

## Documentation
- [ ] Updated README.md
- [ ] Updated USAGE.md
- [ ] Updated DEVELOPMENT.md
- [ ] No documentation changes needed

## Checklist
- [ ] Code follows project style
- [ ] All tests pass
- [ ] No breaking changes
- [ ] Commits are clean
```

---

## Testing Requirements

### Unit Tests

Test individual functions and classes:

```typescript
// Example: test analyzer scoring
import { DomAnalyzer } from '../src/analyzer';

describe('DomAnalyzer', () => {
  it('should score buttons higher than divs', async () => {
    const analyzer = new DomAnalyzer();

    const buttonScore = analyzer.scoreElement({
      tagName: 'BUTTON',
      visible: true
    });

    const divScore = analyzer.scoreElement({
      tagName: 'DIV',
      visible: true
    });

    expect(buttonScore).toBeGreaterThan(divScore);
  });
});
```

### Integration Tests

Test end-to-end flows:

```typescript
// Example: test full crawl → analyze → generate flow
describe('Full crawl pipeline', () => {
  it('should generate test cases from crawl', async () => {
    const crawler = new SiteCrawler();
    const analyzer = new DomAnalyzer();
    const generator = new TestCaseGenerator();

    const dom = await crawler.crawl('https://example.com');
    const analyzed = await analyzer.analyze(dom);
    const testCases = generator.generate(analyzed);

    expect(testCases.length).toBeGreaterThan(0);
    expect(testCases[0]).toHaveProperty('id');
    expect(testCases[0]).toHaveProperty('action');
    expect(testCases[0]).toHaveProperty('priority');
  });
});
```

### Running Tests

```bash
# Run all tests (unit + integration)
npm test

# Just the fast unit suites
npm run test:unit

# Just the integration suites (boots the benchmark fixture app)
npm run test:integration

# Run a single suite
node --test test/unit/semantic-tools.test.js

# Watch mode for development
npm test -- --watch
```

### New Features Must Have Tests

- Features without tests will be rejected
- Aim for >80% code coverage on new code
- Test both success and error cases

---

## Code Review Process

### What to Expect

1. **Automated checks:**
   - Tests must pass
   - TypeScript must compile
   - Code style validation

2. **Manual review:**
   - At least one maintainer reviews code
   - May ask questions or request changes
   - Reviews typically complete within 3-5 days

3. **Feedback:**
   - Constructive comments to improve code
   - May suggest refactoring for clarity
   - Will highlight any concerns

### Responding to Feedback

- **Be respectful**: Reviews aren't personal
- **Ask clarifying questions** if feedback is unclear
- **Request re-review** once changes are made
- **Don't force push** after code review starts (keeps history)

### Approval and Merging

- PR must be approved by at least one maintainer
- All tests must pass
- All conversations must be resolved
- Maintainer will merge PR

---

## Common Contribution Types

### Bug Fixes

1. Open issue describing the bug
2. Create branch: `git checkout -b fix/bug-description`
3. Add test that reproduces the bug
4. Fix the code
5. Verify test passes
6. Submit PR with details

### Feature Additions

1. Discuss in an issue first
2. Create branch: `git checkout -b feature/feature-name`
3. Implement feature
4. Add tests for new functionality
5. Update documentation (README, USAGE.md, DEVELOPMENT.md)
6. Submit PR

### Documentation Improvements

1. Create branch: `git checkout -b docs/improvement`
2. Update relevant .md files
3. Verify clarity and accuracy
4. Submit PR

### Performance Improvements

1. Open issue with benchmarks showing the problem
2. Implement improvement
3. Add performance tests or benchmarks
4. Document the change
5. Submit PR with benchmarks

---

## Commit Message Guidelines

Write clear, descriptive commit messages:

```
[type] Brief summary (50 chars max)

Longer explanation of the change (wrap at 72 chars).
Explain what changed and why.

- Details about implementation
- Any breaking changes?
- Relates to issue #123

Fixes #456
```

**Types:**

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation
- `test:` Add/update tests
- `refactor:` Code cleanup (no behavior change)
- `perf:` Performance improvement
- `ci:` CI/CD changes
- `chore:` Dependency updates, tooling

**Examples:**

```
feat: add support for custom scoring weights

fix: handle timeout errors in crawler

docs: clarify ML model fallback behavior

test: add tests for duplicate element detection

perf: optimize DOM traversal for large pages
```

**Authorship:** every trailer must name a person. Do not credit an AI as an
author — see [AI-Assisted Contributions](#ai-assisted-contributions). Many
coding agents add a `Co-Authored-By:` trailer automatically, so check before
you push.

---

## Getting Help

### Questions About

- **Setup?** See [DEVELOPMENT.md](DEVELOPMENT.md#getting-started)
- **Usage?** See [USAGE.md](USAGE.md)
- **Architecture?** See [DEVELOPMENT.md](DEVELOPMENT.md#architecture-deep-dive)
- **Still stuck?** Open a discussion or ask in an issue

### Resources

- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [MCP SDK Documentation](https://github.com/modelcontextprotocol/typescript-sdk)
- [Jest Testing Guide](https://jestjs.io/docs/getting-started)
- [Our Example Reports](ANALYSIS_BSTACKDEMO.md)

---

## Recognition

Contributors will be recognized in:

- Release notes
- Contributors section (if maintained)
- Maintainer gratitude!

---

## Project Governance

**Decision Making:**

- Small changes: Reviewed and merged by maintainers
- Large features: Discussed in issues first
- Breaking changes: Discussed with community

**Maintainers:** TBD (fill in with actual maintainers)

---

## Additional Notes

- **By contributing**, you agree your code can be used under the project's license
- **No pressure**: Contribute when and how you can
- **All contributions matter**: Docs, tests, and reports are as valuable as code

---

**Thank you for contributing to Cartographer! 🎉**

Your efforts help make this project better for everyone.
