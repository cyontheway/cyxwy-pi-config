/**
 * 会话结束时播放提示音
 * 监听 agent_end（每次 LLM 响应结束）/ session_shutdown（退出）
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function playSound(name: string) {
  const { spawn } = require("node:child_process");
  spawn("afplay", [`/System/Library/Sounds/${name}.aiff`], { detached: true }).unref();
}

export default function (pi: ExtensionAPI) {
  // 每次 agent 完成一轮对话时响 Hero
  pi.on("agent_end", async () => {
    playSound("Hero");
  });

  // 退出会话时响（选个不一样的）
  pi.on("session_shutdown", async () => {
    playSound("Submarine");
  });
}
