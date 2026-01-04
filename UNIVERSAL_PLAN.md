# Plan: Universal bgit Integration

The current implementation by Claude provides a robust OAuth foundation but lacks two critical features requested by the user:
1.  **Universal History**: Currently, only `commit` and `push` are paid. We need *all* 155 commands to be paid.
2.  **Aesthetics**: The ASCII Banner is missing from the entry point.

## Execution Steps

### 1. Refactor `lib/command-router.js`
**Current Logic:**
```javascript
const PAYMENT_GATED_COMMANDS = ['commit', 'push'];
```

**New Logic:**
- Import `commands` from `lib/commands.js`.
- Treat **all** of them as payment-gated.
- Unified flow: `ensureAuth` -> `pay` -> `execute`.

### 2. Restore Banner in `index.js`
- Import `showBanner` from `lib/banner.js`.
- Call it at the start of `main()` (if no specific subcommands like `json` output are requested, to avoid breaking scripts).

### 3. Verify
- Run `node index.js status`.
- Expectation:
    - Banner shows.
    - "Opening browser..." (if not authed) OR "Paying..." (if authed).
    - `git status` output.

This aligns the robust "Claude" architecture with the "b0ase" Vision.
