/**
 * Permission Gate — pi 权限控制 Extension
 *
 * 对标 Claude Code 的 allow/ask/deny 三级权限系统。
 * 支持模式切换：/pm normal | yolo | plan
 *   normal — allow → ask → deny 全开
 *   yolo   — 只拦 deny（危险操作），跳过 ask
 *   plan   — 只读模式，拒绝所有写操作（write/edit/rm/mv 等）
 *
 * 拦截工具：bash, write, edit, read（read 仅拦受保护文件）
 *
 * 安装后 /reload 生效。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

// ── 模式 ────────────────────────────────────────────────

type Mode = "normal" | "yolo" | "plan";
let currentMode: Mode = "yolo"; // 默认权限模式

// ── 规则定义 ────────────────────────────────────────────

interface Rule {
  tool: "bash" | "write" | "edit";
  patterns: string[];
}

// ALLOW 只在 normal 模式下检查；yolo 下跳过所有 allow/ask 但仍然检查 deny
const ALLOW: Rule[] = [
  { tool: "bash", patterns: ["obsidian read"] },
  { tool: "bash", patterns: ["obsidian search"] },
  { tool: "bash", patterns: ["obsidian open"] },
  { tool: "bash", patterns: ["obsidian file"] },
  { tool: "bash", patterns: ["obsidian help"] },
  { tool: "bash", patterns: ["pip3 show"] },
  { tool: "bash", patterns: ["brew list"] },
  { tool: "bash", patterns: ["pandoc"] },
  { tool: "bash", patterns: ["unzip"] },
  { tool: "bash", patterns: ["gh issue view"] },
];

const DENY: Rule[] = [
  { tool: "bash", patterns: ["rm -rf"] },
  { tool: "bash", patterns: ["rmdir"] },
  { tool: "bash", patterns: ["sudo"] },
  { tool: "bash", patterns: ["chmod 777"] },
  { tool: "bash", patterns: ["mv "] },
  { tool: "bash", patterns: ["awk -i inplace"] },
  { tool: "bash", patterns: [" | tee"] },
  { tool: "bash", patterns: ["dd of="] },
  { tool: "bash", patterns: ["--break-system-packages"] },
  // 工作草稿.md 保护：由 tool_call 内前置检查统一拦截（含"工作草稿"字样的命令），此处不再重复列 pattern
  // cat > 用专用正则检查，避免误匹配 cat >> 和 python 字符串内容
  // echo > 由下方的 echo+> 组合检查统一处理
];

const ASK: Rule[] = [
  { tool: "bash", patterns: ["rm "] },
  { tool: "bash", patterns: ["chmod"] },
  { tool: "bash", patterns: ["cp -r"] },
  { tool: "bash", patterns: ["python3"] },
  { tool: "bash", patterns: ["node "] },
  { tool: "bash", patterns: ["npm install"] },
  { tool: "bash", patterns: [".venv/bin/pip"] },
  { tool: "bash", patterns: ["pip install"] },
  { tool: "bash", patterns: ["brew install"] },
  { tool: "bash", patterns: [">>"] },
  { tool: "bash", patterns: ["git add"] },
  { tool: "bash", patterns: ["git commit"] },
  { tool: "bash", patterns: ["git push"] },
  { tool: "bash", patterns: ["git checkout"] },
  { tool: "bash", patterns: ["open "] },
  { tool: "bash", patterns: ["trash"] },
  { tool: "bash", patterns: ["sed"] },
  { tool: "bash", patterns: ["obsidian prepend"] },
  { tool: "bash", patterns: ["obsidian append"] },
  { tool: "bash", patterns: ["obsidian create"] },
  { tool: "bash", patterns: ["obsidian delete"] },
  { tool: "bash", patterns: ["obsidian move"] },
  { tool: "bash", patterns: ["obsidian rename"] },
  { tool: "write", patterns: [] },
  { tool: "edit", patterns: [] },
];

/** 检查命令是否包含任一 pattern（忽略 heredoc << 之后的内容） */
function hasPattern(cmd: string, patterns: string[]): boolean {
  // 只检查 heredoc 之前的部分，避免 python 脚本内容误命中
  const cmdOnly = cmd.replace(/<<\s*\S+[\s\S]*$/, "").trim();
  return patterns.some((p) => cmdOnly.includes(p));
}

/** 检查命令是否匹配某组规则（任一 pattern 命中即返回 true） */
function matches(cmd: string, rules: Rule[]): Rule | undefined {
  for (const r of rules) {
    if (r.tool !== "bash") continue;
    if (r.patterns.length === 0 || hasPattern(cmd, r.patterns)) return r;
  }
  return undefined;
}

// ── 工具函数 ────────────────────────────────────────────

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "…";
}

/** 更新状态栏显示 */
function updateStatus(ctx: { ui: { setStatus: (key: string, text: string) => void } }) {
  const statusMap: Record<Mode, string> = { yolo: "🔓 yolo", normal: "🔒 normal", plan: "📋 plan" };
  ctx.ui.setStatus("pm", statusMap[currentMode] || "🔒 normal");
}

// ── Extension 入口 ─────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // session_start 时恢复状态栏
  pi.on("session_start", (_event, ctx) => {
    updateStatus(ctx);
  });

  // 注册 Shift+Tab 快捷键（需先在 keybindings.json 中解绑 thinking.cycle）
  pi.registerShortcut("shift+tab", {
    description: "切换 yolo ↔ normal ↔ plan",
    handler: async (ctx) => {
      const cycle: Mode[] = ["yolo", "normal", "plan"];
      const idx = cycle.indexOf(currentMode);
      currentMode = cycle[(idx + 1) % cycle.length];
      updateStatus(ctx);
      const modeNames: Record<Mode, string> = { yolo: "🔓 YOLO 模式", normal: "🔒 Normal 模式", plan: "📋 Plan 只读模式" };
      ctx.ui.notify(modeNames[currentMode], "info");
    },
  });

  // input 事件：拦截 /pm 命令，走 LLM 回复（兼容 TUI 和 pi-web）
  pi.on("input", (event) => {
    const m = event.text.match(/^\/pm\s+(normal|yolo|plan)$/);
    if (!m) return;
    currentMode = m[1] as Mode;
    const names: Record<Mode, string> = { yolo: "🔓 YOLO", normal: "🔒 Normal", plan: "📋 Plan" };
    return { action: "transform", text: `（已将权限模式切换为 ${names[currentMode]}）` };
  });

  // tool_call 拦截
  pi.on("tool_call", async (event, ctx) => {
    // ── bash ──────────────────────────────────────
    if (isToolCallEventType("bash", event)) {
      const cmd = event.input.command ?? "";
      // 提取 heredoc 前的命令部分，避免 python/heredoc 内容误命中
      const cmdOnly = cmd.replace(/<<\s*\S+[\s\S]*$/, "").trim();

      // === 工作草稿.md 保护（永远生效，先于一切规则） ===
      // 只要命令里出现"工作草稿"字样（无论 cat/grep/head/git show/python/obsidian 等），一律拦截；
      // 不设任何放行机制，无论用户如何要求或引诱都不读取
      if (cmdOnly.includes("工作草稿")) {
        return {
          block: true,
          reason: `🛑 拦截（保护）：\`工作草稿.md\` 是受保护文件，禁止以任何方式读取或操作。\n\n请不要尝试其他命令读取它（cat/grep/head/git show/python 等），同样会被拦截。`,
        };
      }

      // === mv -n 例外：不覆盖的 mv 安全放行 ===
      // 匹配 mv -n、mv -nv、mv -n -v、mv --no-clobber
      // 用 includes 避免 regex \b 在 `-` 前不匹配的问题
      if (cmdOnly.includes("mv -n") || cmdOnly.includes("mv --no-clobber")) {
        // 在 DENY 之前放行
      } else

      // === DENY 永远生效（不论 perm 还是 yolo） ===
      if (matches(cmd, DENY)) {
        return {
          block: true,
          reason: `🛑 拦截（deny）：\`${truncate(cmd, 80)}\`\n\n此操作被安全规则禁止。`,
        };
      }

      // === echo + > 组合检查（即使 yolo 模式也拦） ===
      // 要求 echo 出现在命令段开头（行首或 &&/;/| 之后），
      // 避免 python3 -c 或 echo 字符串内容误命中
      if (/(?:^|&&|\|\||[;&|`])\s*echo\b[^&|;>]*\s+>(?!>)\s*\S+[\/~.]/.test(cmdOnly)) {
        return {
          block: true,
          reason: `🛑 拦截（deny）：\`${truncate(cmd, 80)}\`\n\necho 覆盖可能覆盖文件，请使用 write tool 代替。`,
        };
      }

      // === cat > DENY（使用命令边界正则，避免误匹配 cat >> 和字符串内容） ===
      // 匹配 cat > 出现在命令开始或 &&/;/| 之后，且不是 >>
      if (/(?:^|&&|\|\||[;&|`])\s*cat\s*>(?!>)/.test(cmdOnly)) {
        return {
          block: true,
          reason: `🛑 拦截（deny）：\`${truncate(cmd, 80)}\`\n\ncat > 可能覆盖文件，请使用 write tool 代替。`,
        };
      }

      // === PLAN 模式：只放行 allow，其余全部拦截 ===
      if (currentMode === "plan") {
        if (matches(cmd, ALLOW)) return;
        return { block: true, reason: `📋 Plan 只读模式：不允许此操作 \`${truncate(cmd, 80)}\`` };
      }

      // === YOLO 模式：deny 之后直接放行 ===
      if (currentMode === "yolo") {
        return;
      }

      // === NORMAL 模式：allow → ask ===

      // allow 检查
      if (matches(cmd, ALLOW)) return;

      // ask 检查
      const askRule = matches(cmd, ASK);
      if (askRule) {
        const ok = await ctx.ui.confirm("⚠️ 确认执行", `\`${truncate(cmd, 150)}\``);
        if (!ok) return { block: true, reason: "已取消" };
        return;
      }

      // 不在任何规则中也 ASK（对标 CC 默认行为）
      const ok = await ctx.ui.confirm("⚠️ 确认执行", `\`${truncate(cmd, 150)}\``);
      if (!ok) return { block: true, reason: "已取消" };
      return;
    }

    // ── read ──────────────────────────────────────
    // 只拦截受保护文件（工作草稿.md），其余 read 正常放行
    if (isToolCallEventType("read", event)) {
      const path = event.input.path ?? "";
      if (path.includes("工作草稿")) {
        return {
          block: true,
          reason: "🛑 拦截（保护）：`工作草稿.md` 是受保护文件，禁止读取。请勿尝试通过 bash 等其他方式读取，同样会被拦截。",
        };
      }
      return;
    }

    // ── write ─────────────────────────────────────
    if (isToolCallEventType("write", event)) {
      const path = event.input.path ?? "";

      // plan 下所有 write 都拦
      if (currentMode === "plan") {
        return { block: true, reason: `📋 Plan 只读模式：不允许写入文件 \`${path}\`` };
      }

      if (currentMode === "yolo") return; // yolo 下跳过

      let exists = false;
      try {
        const { existsSync } = await import("node:fs");
        exists = existsSync(path);
      } catch { /* ignore */ }
      if (!exists) return;

      const ok = await ctx.ui.confirm("📝 覆盖文件？", `\`${path}\``);
      if (!ok) return { block: true, reason: "已取消：不覆盖" };
      return;
    }

    // ── edit ──────────────────────────────────────
    if (isToolCallEventType("edit", event)) {
      // plan 下所有 edit 都拦
      if (currentMode === "plan") {
        return { block: true, reason: `📋 Plan 只读模式：不允许编辑文件 \`${event.input.path ?? ""}\`` };
      }

      if (currentMode === "yolo") return; // yolo 下跳过

      const ok = await ctx.ui.confirm("✏️ 编辑文件？", `\`${event.input.path ?? ""}\``);
      if (!ok) return { block: true, reason: "已取消：不编辑" };
      return;
    }
  });
}
