---
description: Bind a markdown note to this session — the lesson will be mirrored into it for reading in Obsidian
argument-hint: "[path to an existing .md; without an argument — create a new one]"
allowed-tools: Bash(node .claude/md-log/hook.mjs link), Bash(node .claude/md-log/hook.mjs link *.md), Bash(node .claude/md-log/hook.mjs link "*.md")
---

Run exactly one command and pass its output to the user **verbatim**. Add nothing, explain nothing, take no other actions.

```bash
node .claude/md-log/hook.mjs link $ARGUMENTS
```

With an argument, an **existing** file is bound (absolute path or relative to the project root); if the file does not exist the command refuses, and that is fine. Without an argument the note is created in the directory from `.claude/md-log.config.json`. Either way the session is written into the note from the very beginning, so binding works in the middle of a lesson too.