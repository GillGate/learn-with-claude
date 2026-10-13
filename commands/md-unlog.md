---
description: Unbind the note — the session stops mirroring into markdown
allowed-tools: Bash(node .claude/md-log/hook.mjs unlink)
---

Run exactly one command and pass its output to the user **verbatim**. Add nothing, explain nothing, take no other actions.

```bash
node .claude/md-log/hook.mjs unlink
```

The note stays on disk as is — only its binding to this session is removed.