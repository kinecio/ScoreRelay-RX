# Agent Guidelines

## AI agent workflow: branch first, document every commit

Any AI coding agent (Claude Code, Codex, Cursor, etc.) starting new work in
this repo must:

1. Create a new branch before making any changes — never commit directly
   to `main` (or `Dev`/`DEV`/whatever the primary integration branch is
   called here).
2. Fully document every commit: a clear summary line plus a body
   explaining what changed and why, so the history is reviewable without
   needing to ask the agent what happened.
