@AGENTS.md

## Claude Code

- Skills, subagents and rules in `.claude/skills`, `.claude/agents` and `.claude/rules` are generated from `.agents/`. Edit the source, then run `npm run agents:sync`.
- Hooks in `.claude/settings.json` run the vendored `scripts/agents/hooks/*.mjs`: SessionStart prints the worktree, slot, ports and claims; PreToolUse on Bash and PowerShell blocks secret reads, force pushes or deletion of `main`, and `gh api` writes to settings, protection, environment, secret or access endpoints; PostToolUse formats edited files with the repo's Prettier.
- Start task work with `node scripts/worktree/wt.mjs new <type>/<slug>` and open Claude in the printed directory. With `claude -w <name>` instead, run `node scripts/worktree/setup.mjs` there and `git branch -m <type>/<slug>` before the first push.
- After `EnterWorktree`, `$CLAUDE_PROJECT_DIR` still points at the main checkout. Hooks read the hook input `cwd`; run your commands from the worktree root.
- Subagents: `site-implementer` (one task to a green PR), `site-reviewer` and `site-qa` (read-only), `site-release-sync` (extension release to site PR).
