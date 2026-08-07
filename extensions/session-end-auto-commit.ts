/**
 * Git Auto-Commit — Session 结束时自动 commit
 *
 * 在 session_shutdown 时自动 stage + commit 工作区变更，
 * commit message 用 git diff --stat 展示实际变更文件。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  let cachedSessionId = "";

  // session 启动时缓存 ID（shutdown 时可能取不到）
  pi.on("session_start", (_event, ctx) => {
    cachedSessionId = ctx.sessionManager.getSessionId() || "";
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    // 1. 检查是否在 git 仓库
    const { code: isRepo } = await pi.exec("git", ["rev-parse", "--is-inside-work-tree"]);
    if (isRepo !== 0) return;

    // 2. 检查是否有未提交的变更（含未跟踪文件）
    const { stdout: status } = await pi.exec("git", ["status", "--porcelain"]);
    if (!status.trim()) return;

    // 3. 提取最后一条 assistant 消息的首行（作 subject）
    const entries = ctx.sessionManager.getEntries();
    let assistantFirstLine = "";
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry.type === "message" && entry.message.role === "assistant") {
        const content = entry.message.content;
        if (Array.isArray(content)) {
          const text = content
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map((c) => c.text)
            .join("\n");
          assistantFirstLine = text.split("\n")[0]?.trim() || "";
        }
        break;
      }
    }

    // 4. Stage（先 stage，后面的 stat 才能覆盖新文件）
    const { code: stageCode } = await pi.exec("git", ["add", "-A"]);
    if (stageCode !== 0) return;

    // 5. 用 --cached 拿 stage 后的完整 diff stat
    const { stdout: diffStat } = await pi.exec("git", ["diff", "--stat", "--cached"]);
    const body = diffStat.trim();

    // 6. 组装 commit message
    const sessionTag = cachedSessionId ? `[${cachedSessionId.slice(0, 12)}]` : "";
    const subject = assistantFirstLine
      ? `[pi] shutdown${sessionTag}: ${assistantFirstLine.length > 60 ? assistantFirstLine.slice(0, 57) + "..." : assistantFirstLine}`
      : `[pi] shutdown${sessionTag}: auto-commit`;

    const message = body ? `${subject}\n\n${body}` : subject;

    // 7. Commit
    const { code: commitCode } = await pi.exec("git", ["commit", "-m", message]);
    if (commitCode !== 0) return;

    if (ctx.hasUI) {
      const fileCount = body.split("\n").length;
      ctx.ui.notify(`✅ auto-commit (${fileCount} files)`, "info");
    }
  });
}
