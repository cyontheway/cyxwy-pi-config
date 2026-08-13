---
name: cross-session-msg
description: 跨 session 发消息与补问。当用户想给某个旧 session 发消息、回到原 session 问问题、对重要信息做 double check、跨会话交接或补记时使用。触发词：给那个 session 发消息、回原来 session 问一下、跨会话、double check 一下原来讨论的、问一下之前那个窗口。注意：这适合问完即走的单向通信，不适合高频来回对话。
aliases:
  - cross-session
  - 跨会话
  - 跨session
---
# 跨 Session 发消息 Skill

## 适用场景

1. **补问旧上下文**：重大项目有多个 session（MOC、handoff 都在，但原 session 上下文最全）。需要精确答案或 double check 的重要信息，回到原 session 问，利用它的历史上下文
2. **会话交接**：当前 session 收尾时，把结论、待办、文件清单发给项目主 session，那边 resume 后直接续上
3. **事后补记**：某个 session 开了但没写 handover，结束后补发总结让它存档
4. **工作台汇总**：多个 session 各干了一摊活，让一个 session 汇总

## 核心机制

```bash
pi --session <短id> -p "<消息>"
```

- `-p` 是非交互打印模式：启动临时 pi 进程 → 加载目标 session 历史 → 追加问题 → 模型回复 → **直接打印到命令行输出** → 退出
- 回复当场拿到，不需要事后翻 jsonl 文件
- 消息会写入目标 session 文件，形成 user + assistant 两条新记录
- **`--session` 只接受短 id**（文件名里的 8 位 hex，如 `019fa965`），不接受完整文件名

## 用户手动发消息（/msg 命令）

用户知道自己想要的 session 号时，可直接在 TUI 用 `/msg` 命令（extension：`session-msg.ts`）：

```
/msg <session短id或名字> <消息>
```

- Tab 自动补全 session 列表（显示短 id + 名称）
- 结果以气泡形式渲染在当前 transcript（不进入 LLM 上下文）
- 用法：`/msg 019fa965 帮我看下上次讨论的序号9 gross/net 口径`
- 与 AI 调用 skill 的区别：skill 是 AI 主动补问（适合复杂场景），/msg 是用户手动发（知道 session 号时最快）

## 执行步骤

1. **确认目标 session**：
   - 用户给了名字或短 id（如 `019fa965`、`260728 某项目会话`）→ 直接使用
   - 不确定 → `ls ~/.pi/agent/sessions/`（对应你的项目 session 目录）查文件，提取 session 名称（读 jsonl 的 `session_info` 事件），列出候选让用户确认，**不要凭记忆猜**
2. **构造消息**：一句话说清目的（发总结 / 问问题 / 补记），需要精确答案时把问题写具体，可附文件路径
3. **执行**：`pi --session <id> -p "<消息>"`，工作目录用项目根目录
4. **反馈**：把回复摘要给用户；提醒用户：目标 session 若开着 TUI 不会自动刷新，用 pi-web 查看该 session 最方便

## 注意事项

- **目标 session 的 TUI 不自动刷新**：隔壁窗口看不到新消息，要重载（`/resume` 重新选择）或看 pi-web
- **-p 模式回复直接拿到**：不需要也不建议去读 jsonl 验证（除非要确认写入了）
- **适合问完即走**：单向通信，不要高频来回
- **session 短 id 足够**：`--session` 支持 partial UUID，`019fa965` 这种前缀即可
- **用户上下文未耗尽场景最合适**：大项目 session 一般不会用尽 1M 上下文，原 session 能回答不少问题
- **发错窗口风险**：目标不明确时必须先确认，避免把消息发进无关 session
