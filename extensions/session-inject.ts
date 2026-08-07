/**
 * Session Inject — 把当前 session 路径和模型信息注入 agent 上下文
 *
 * 让 agent 直接知道 session 文件路径 + 首次模型 + 当前模型，不用跑命令反查。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event, ctx) => {
    const sessionFile = ctx.sessionManager.getSessionFile();
    if (!sessionFile) return;

    // 当前模型（此 turn 正在用的）
    const currentModel = ctx.model
      ? `${ctx.model.provider}/${ctx.model.id}`
      : "unknown";

    // 首次模型（第一条 model_change entry）
    const entries = ctx.sessionManager.getEntries();
    const firstModelChange = entries.find(
      (e: any) => e.type === "model_change"
    );
    const firstModel = firstModelChange
      ? `${firstModelChange.provider}/${firstModelChange.modelId}`
      : "unknown";

    const sessionPath = sessionFile.replace(process.env.HOME || "", "~");

    return {
      systemPrompt:
        event.systemPrompt +
        `\n\n当前 pi session：\`${sessionPath}\`\n运行模式：${ctx.mode}\n首次模型：${firstModel}\n当前模型：${currentModel}`,
    };
  });
}
