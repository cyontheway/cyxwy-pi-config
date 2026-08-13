# cy-pi-config

[English](./README.md)

个人 pi coding agent 配置合集，根据个人需求更新，欢迎参考或直接使用。

## 安装

将需要的 `.ts` 文件复制到 `~/.pi/agent/extensions/`（或项目 `.pi/extensions/`），重启 pi 生效。

```bash
# 示例：安装单个扩展
cp extensions/status-footer.ts ~/.pi/agent/extensions/
# 示例：安装 subagent（含子目录）
cp -r extensions/subagent ~/.pi/agent/extensions/
# 示例：安装 skill（可选）
cp -r skills/cross-session-msg ~/.pi/agent/skills/
```

> ⚠️ pi 的扩展加载是 fail-fast：任何一个扩展语法错误会导致全部扩展不加载。改动后建议完全重启 pi（`/reload` 实测多次不生效）。

## 扩展清单

| 文件 | 功能 |
|------|------|
| `permission-gate.ts` | 权限拦截系统：allow/ask/deny 三级 + normal/yolo/plan 模式切换 + 受保护文件绝对拦截。 |
| `pi-header.ts` | 像素艺术 Pi logo 顶部头部 + 版本/目录/模型/会话名信息栏（v2 绿色系，配 dark-purple 主题）。 |
| `status-footer.ts` | Catppuccin Mocha 风格底部状态栏：模型、目录、分支、时间、token、上下文、权限模式。 |
| `api-speed.ts` | 实时显示 LLM API 速度（流式 3s 滑动窗口估算 tok/s，请求结束显示平均速度 + 耗时）。 |
| `obsidian-auto-open.ts` | edit/write 后自动在 Obsidian 中打开 `.md` 文件（自动探测 vault）。 |
| `ask-user.ts` | AI 调用时弹选项列表让用户选择（SelectList 箭头导航 + 自定义输入兜底）。 |
| `subagent/` | 子代理工具：single / parallel / chain 三种模式，spawn 独立 pi 进程获得隔离上下文。 |
| `roundtable.ts` | `/talk` 点名对话、`/roundtable` 圆桌讨论（含分身 xN）、`/debate` 自由对辩。 |
| `session-inject.ts` | 把 session 文件路径 + 模型信息注入 agent system prompt。 |
| `session-end-auto-commit.ts` | session 退出时自动 git stage + commit（commit message 带 session ID + diff stat）。 |
| `pre-tool-auto-commit.ts` | 文件被改写前自动 git checkpoint，方便回滚。 |
| `session-namer.ts` | 自动命名 session：`YYMMDD <话题>`，AI 从对话内容推断话题。 |
| `session-header.ts` | 把 session name 嵌入编辑器顶部边框（金色粗斜体）。 |
| `stash.ts` | `Ctrl+S` 暂存/恢复输入框内容（类似 Claude Code 的 Ctrl+S 存草稿）。 |
| `tools.ts` | `/tools` 命令交互式开关工具。 |
| `sound.ts` | 会话结束时播放系统提示音。 |
| `session-msg.ts` | `/msg <session短id或名字> <消息>`：spawn 独立 pi 进程跨 session 发消息，结果气泡渲染（Tab 补全 session 列表）。 |

## Skills

| Skill | 说明 |
|-------|------|
| `cross-session-msg` | 跨 session 发消息 skill：补问旧上下文、会话交接、事后补记（`pi --session <id> -p "<消息>"`）。与 `/msg` extension 配套（skill=AI 主动调用，/msg=用户手动）。 |

## 主题

| 文件 | 说明 |
|------|------|
| `themes/dark-purple.json` | 深紫主题：用户消息底 `#535394`、工具状态三色、紫色调强调色。 |

```bash
# 安装主题
cp themes/dark-purple.json ~/.pi/agent/themes/
# 在 pi 设置中切换为 dark-purple
```

## 依赖

扩展使用 pi 官方 SDK 类型，请确保 pi 版本兼容：

```bash
npm install -g @earendil-works/pi-coding-agent
```

## 许可证

MIT
