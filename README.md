# cyxwy-pi-config

个人 pi coding agent 配置合集，在实践中迭代打磨，欢迎参考或直接使用。

A collection of personal configuration for the [pi coding agent](https://github.com/earendil-works/pi), refined through daily use. Feel free to use or fork.

## 安装 / Installation

将需要的 `.ts` 文件复制到 `~/.pi/agent/extensions/`（或项目 `.pi/extensions/`），重启 pi 生效。

Copy the `.ts` files you need to `~/.pi/agent/extensions/` (or your project's `.pi/extensions/`), then restart pi.

```bash
# 示例：安装单个扩展
cp extensions/status-footer.ts ~/.pi/agent/extensions/
# 示例：安装 subagent（含子目录）
cp -r extensions/subagent ~/.pi/agent/extensions/
```

> ⚠️ pi 的扩展加载是 fail-fast：任何一个扩展语法错误会导致全部扩展不加载。改动后建议完全重启 pi（`/reload` 实测多次不生效）。
>
> Note: extension loading is fail-fast in pi. A syntax error in any extension will prevent all extensions from loading. A full restart is recommended after changes.

## 扩展清单 / Extension List

| 文件 File | 功能 Description |
|-----------|------------------|
| `permission-gate.ts` | 权限拦截系统：allow/ask/deny 三级 + normal/yolo/plan 模式切换 + 受保护文件绝对拦截。Permission gate: three-level interception, mode switching, protected-file blocking. |
| `pi-header.ts` | 像素艺术 Pi logo 顶部头部 + 版本/目录/模型/会话名信息栏（v2 紫色系，配 dark-purple 主题）。Pixel-art Pi logo header with version/dir/model/session info bar. |
| `status-footer.ts` | Catppuccin Mocha 风格底部状态栏：模型、目录、分支、时间、token、上下文、权限模式。Catppuccin-styled status footer. |
| `api-speed.ts` | 实时显示 LLM API 速度（流式 3s 滑动窗口估算 tok/s，请求结束显示平均速度 + 耗时）。Live API speed monitor. |
| `obsidian-auto-open.ts` | edit/write 后自动在 Obsidian 中打开 `.md` 文件（自动探测 vault）。Auto-open edited files in Obsidian. |
| `ask-user.ts` | AI 调用时弹选项列表让用户选择（SelectList 箭头导航 + 自定义输入兜底）。Interactive user-choice dialog for AI tool calls. |
| `subagent/` | 子代理工具：single / parallel / chain 三种模式，spawn 独立 pi 进程获得隔离上下文。Subagent delegation with isolated context. |
| `roundtable.ts` | `/talk` 点名对话、`/roundtable` 圆桌讨论（含分身 xN）、`/debate` 自由对辩。Multi-agent talk / roundtable / debate. |
| `session-inject.ts` | 把 session 文件路径 + 模型信息注入 agent system prompt。Inject session metadata into context. |
| `session-end-auto-commit.ts` | session 退出时自动 git stage + commit（commit message 带 session ID + diff stat）。Auto-commit on session end. |
| `pre-tool-auto-commit.ts` | 文件被改写前自动 git checkpoint，方便回滚。Git checkpoint before overwrite. |
| `session-namer.ts` | 自动命名 session：`YYMMDD <话题>`，AI 从对话内容推断话题。Auto session naming. |
| `session-header.ts` | 把 session name 嵌入编辑器顶部边框（金色粗斜体）。Session name in editor top border. |
| `stash.ts` | `Ctrl+S` 暂存/恢复输入框内容（类似 Claude Code 的 Ctrl+S 存草稿）。Ctrl+S stash / restore. |
| `tools.ts` | `/tools` 命令交互式开关工具。Interactive tool toggling. |
| `sound.ts` | 会话结束时播放系统提示音。System sound on session end. |

## 依赖 / Dependencies

扩展使用 pi 官方 SDK 类型，请确保 pi 版本兼容：

```bash
npm install -g @earendil-works/pi-coding-agent
```

## 许可证 / License

MIT
