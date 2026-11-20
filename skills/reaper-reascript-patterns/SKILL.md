---
name: reaper-reascript-patterns
description: "Idiomatic REAPER ReaScript Lua patterns. Use when writing, reviewing, or debugging ReaScripts, especially undo blocks, PreventUIRefresh, defer loops, nil guards, and Lua pattern (not regex) gotchas."
type: workflow
lifecycle: active
---

# REAPER ReaScript Patterns

## Undo + UI Refresh (must balance)
```lua
reaper.Undo_BeginBlock()
reaper.PreventUIRefresh(1)
-- edits
reaper.PreventUIRefresh(-1)
reaper.Undo_EndBlock("Action name", -1)
```
Every early return must still balance both.

## Nil Guards
Always check `GetSelectedMediaItem`, `GetActiveTake`, etc. before use.

## Lua Patterns ≠ Regex
No `{n,m}`, no `|` alternation, `%` for classes. Validate length in code after a simple match.

## defer Loops
No allocations per frame. Exit by not calling `defer` again.
