/**
 * Session Namer — 自动命名 session
 * 格式：YYMMDD <话题>（日期从 session 第一行提取）
 *
 * AI 调用 name_session 时自己推断一个有意义的描述，不用用户说。
 * 不需要 morning 检测——AI 根据内容自行决定。
 *
 * 使用方式：
 *   - AI 调用 name_session tool，从对话内容推断有意义的话题描述
 *   - 不需用户参与
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readFileSync } from "node:fs";

// ── 日期提取 ────────────────────────────────────────────

/** 从 session 文件第一行（session header）提取开始日期，格式 YYMMDD */
function sessionStartYYMMDD(sessionFile: string | undefined): string {
  const fallback = (): string => {
    const d = new Date();
    const yy = String(d.getFullYear()).slice(2);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yy}${mm}${dd}`;
  };

  if (!sessionFile) return fallback();
  try {
    const firstLine = readFileSync(sessionFile, "utf-8").split("\n")[0];
    if (firstLine) {
      const header = JSON.parse(firstLine);
      if (header.timestamp) {
        const d = new Date(header.timestamp);
        const yy = String(d.getFullYear()).slice(2);
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        return `${yy}${mm}${dd}`;
      }
    }
  } catch {
    // 解析失败，fallback 到当天
  }
  return fallback();
}

// ── 构造名字 ────────────────────────────────────────────

function buildName(datePrefix: string, topic?: string): string {
  if (topic && topic.trim()) {
    return `${datePrefix} ${topic.trim()}`;
  }
  return datePrefix;
}

// ── Extension 入口 ─────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "name_session",
    label: "命名 Session",
    description:
      `自动给当前 session 命名。格式 YYMMDD <名字>，日期前缀自动添加。` +
      `AI 自己从对话内容推断一个有意义的描述作为话题（如"合同审查""标签标准化"）。`,
    promptSnippet:
      "给当前 session 命名。AI 自己从对话内容推断话题词，用户不参与。",
    promptGuidelines: [
      `调用 name_session 前，先判断对话内容的主要话题，传一个简短有意义的描述（2-8字中文，如「合同审查」「标签标准化」「会话命名修复」）。`,
      "话题描述要让人一眼看懂是什么——用中文，不要用文件名、skill名、代码产物名。",
    ],
    parameters: Type.Object({
      name: Type.Optional(
        Type.String({
          description:
            "简短有意义的中文话题，2-8 字。例如：合同审查、标签标准化。不要文件名/skill名/产品名。不传则只显示日期。",
        }),
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const sessionFile = ctx.sessionManager?.getSessionFile();
      const datePrefix = sessionStartYYMMDD(sessionFile);
      const fullName = buildName(datePrefix, params.name);

      pi.setSessionName(fullName);
      return {
        content: [{ type: "text", text: `Session 已命名为：${fullName}` }],
        details: { name: fullName },
      };
    },
  });
}
