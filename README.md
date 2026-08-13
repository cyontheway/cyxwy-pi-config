# cy-pi-config

[中文](./README.zh-CN.md)

A collection of personal configuration for the [pi coding agent](https://github.com/earendil-works/pi), updated as personal needs evolve. Feel free to use or fork.

## Installation

Copy the `.ts` files you need to `~/.pi/agent/extensions/` (or your project's `.pi/extensions/`), then restart pi.

```bash
# Install a single extension
cp extensions/status-footer.ts ~/.pi/agent/extensions/
# Install subagent (includes subdirectory)
cp -r extensions/subagent ~/.pi/agent/extensions/
# Install a skill (optional)
cp -r skills/cross-session-msg ~/.pi/agent/skills/
```

> ⚠️ Extension loading is fail-fast in pi. A syntax error in any extension will prevent all extensions from loading. A full restart is recommended after changes (`/reload` has been unreliable in practice).

## Extension List

| File | Description |
|------|-------------|
| `permission-gate.ts` | Permission gate: three-level interception (allow/ask/deny), mode switching (normal/yolo/plan), protected-file blocking. |
| `pi-header.ts` | Pixel-art Pi logo header with version/dir/model/session info bar (v2 green, designed for the dark-purple theme). |
| `status-footer.ts` | Catppuccin-styled status footer: model, directory, branch, time, token, context, permission mode. |
| `api-speed.ts` | Live API speed monitor (3s sliding window during streaming, average speed + elapsed time on completion). |
| `obsidian-auto-open.ts` | Auto-open edited `.md` files in Obsidian (auto-detects the vault). |
| `ask-user.ts` | Interactive user-choice dialog for AI tool calls (SelectList navigation + custom input fallback). |
| `subagent/` | Subagent delegation with isolated context: single / parallel / chain modes. |
| `roundtable.ts` | Multi-agent talk (`/talk`), roundtable discussion (`/roundtable`, supports clones xN), and debate (`/debate`). |
| `session-inject.ts` | Inject session file path and model info into the agent system prompt. |
| `session-end-auto-commit.ts` | Auto git stage + commit on session end (commit message includes session ID + diff stat). |
| `pre-tool-auto-commit.ts` | Git checkpoint before file overwrite for easy rollback. |
| `session-namer.ts` | Auto session naming: `YYMMDD <topic>`, AI infers the topic from conversation. |
| `session-header.ts` | Session name embedded in the editor top border (gold bold-italic). |
| `stash.ts` | `Ctrl+S` stash / restore editor content (like Claude Code's Ctrl+S draft stash). |
| `tools.ts` | `/tools` command for interactive tool toggling. |
| `sound.ts` | System sound on session end. |
| `session-msg.ts` | `/msg <session-short-id|name> <message>`: send a message to another session via a spawned `pi` process, result rendered as a bubble (with Tab completion for sessions). |

## Skills

| Skill | Description |
|-------|-------------|
| `cross-session-msg` | Cross-session messaging for AI: ask follow-up questions to an old session, hand over tasks, or append notes via `pi --session <id> -p "<message>"`. Companion to the `/msg` extension. |

## Themes

| File | Description |
|------|-------------|
| `themes/dark-purple.json` | Dark purple theme with purple-tinted accents. |

```bash
# Install a theme
cp themes/dark-purple.json ~/.pi/agent/themes/
# Switch to dark-purple in pi settings
```

## Dependencies

Extensions use the pi official SDK types; ensure a compatible pi version:

```bash
npm install -g @earendil-works/pi-coding-agent
```

## License

MIT
