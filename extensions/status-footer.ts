/**
 * Catppuccin Mocha 风格底部状态栏（ANSI 真彩色）
 * RGB 值完全对齐 Claude Code 的 statusline-detailed.sh
 *
 * 第 1 行：模型、目录、分支、时间、token、上下文
 * 第 2 行：权限模式（yolo/normal）+ 扩展状态
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// Catppuccin Mocha 色板（完全对齐 CC statusline-detailed.sh）
const C = {
  MAUVE:   "38;2;203;166;247", // #cba6f7 - 模型（同CC的MAUVE）
  RED:     "38;2;243;139;168", // #f38ba8 - 上下文警告（同CC的RED）
  PEACH:   "38;2;250;179;135", // #fab387 - 目录（同 CC）
  YELLOW:  "38;2;249;226;175", // #f9e2af - git dirty（同 CC）
  GREEN:   "38;2;166;227;161", // #a6e3a1 - 上下文高（同 CC）
  TEAL:    "38;2;148;226;213", // #94e2d5 - 分支（同 CC）
  LAVENDER:"38;2;180;190;254", // #b4befe - 时间（同 CC）
  SAPPHIRE:"38;2;128;205;239", // #80cdef - 上下文（淡蓝）
  PINK:    "38;2;209;131;232", // #d183e8 - 上下文（同 thinkingXhigh）
  SLATE:   "38;2;147;163;184", // #93a3b8 灰蓝（偏灰偏淡）- API 速度
  SYMBOL: "38;2;249;226;175", // #f9e2af - π 符号（暖黄）
  DIM:     "38;2;110;115;125", // dim 灰
  WHITE:   "38;2;200;200;200", // 浅白 - | 分隔符
  // 权限模式专用色（统一：底色 + 前景）
  NORMAL_BG: "48;2;160;145;200", NORMAL_FG: "38;2;240;235;250",
  YOLO_BG: "48;2;180;100;60",  YOLO_FG: "38;2;255;230;200",
  PLAN_BG: "48;2;70;140;190",  PLAN_FG: "38;2;220;240;255",
};

function cat(color: string, text: string): string {
  return `\x1b[${color}m${text}\x1b[0m`;
}

function fmtTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1000000) return `${Math.round(n / 1000)}k`;
  if (n < 10000000) return `${(n / 1000000).toFixed(1)}M`;
  return `${Math.round(n / 1000000)}M`;
}

function sanitize(text: string): string {
  return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setFooter((tui, _theme, footerData) => {
      const unsub = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: unsub,
        invalidate() {},
        render(width: number): string[] {
          const lines: string[] = [];

          // ── 累计 token ──
          let totalInput = 0, totalOutput = 0, totalCost = 0;
          let totalCacheRead = 0, totalCacheWrite = 0;
          try {
            for (const entry of ctx.sessionManager.getEntries()) {
              if (entry.type === "message" && entry.message.role === "assistant") {
                const u = entry.message.usage;
                totalInput += u.input;
                totalOutput += u.output;
                totalCacheRead += u.cacheRead;
                totalCacheWrite += u.cacheWrite;
                totalCost += u.cost.total;
              }
            }
          } catch { /* ignore */ }

          // ── 目录名（仅最后一级）+ session 名 ──
          let pwd = "~";
          try {
            const cwd = ctx.sessionManager.getCwd() || ctx.cwd || "~";
            pwd = cwd.split('/').filter(Boolean).pop() || "~";
          } catch { /* ignore */ }

          // ── 上下文 ──
          let contextStr = "";
          try {
            const contextUsage = ctx.getContextUsage();
            if (contextUsage) {
              const pct = contextUsage.percent;
              const cw = contextUsage.contextWindow || ctx.model?.contextWindow || 0;
              const pctDisplay = pct !== null ? `${pct.toFixed(1)}%` : "?";
              const cwDisplay = cw ? `/${fmtTokens(cw)}` : "";
              contextStr = cat(C.PINK, `${pctDisplay}${cwDisplay}`);
            }
          } catch { /* ignore */ }

          // ── 模型名（正红） ──
          const modelName = ctx.model?.id || "no-model";
          let modelStr = cat(C.RED, modelName);

          // ── 目录 + 分支 ──
          const branch = footerData.getGitBranch();
          const branchStr = branch ? ` ${cat(C.GREEN, branch)}` : "";
          const dirStr = cat(C.PEACH, pwd + branchStr);

          // ── 时间 ──
          const now = new Date();
          const yy = String(now.getFullYear());
          const MM = String(now.getMonth() + 1).padStart(2, "0");
          const dd = String(now.getDate()).padStart(2, "0");
          const hh = String(now.getHours()).padStart(2, "0");
          const mm = String(now.getMinutes()).padStart(2, "0");
          const timeStr = cat(C.GREEN, `${yy}-${MM}-${dd} ${hh}:${mm}`);

          // ── Token ──
          const tokenStr = cat(C.SAPPHIRE,
            [totalInput ? `↑${fmtTokens(totalInput)}` : "",
             totalOutput ? `↓${fmtTokens(totalOutput)}` : "",
             totalCacheRead ? `R${fmtTokens(totalCacheRead)}` : "",
             totalCacheWrite ? `W${fmtTokens(totalCacheWrite)}` : "",
             totalCost ? `$${totalCost.toFixed(3)}` : "",
            ].filter(Boolean).join("/"));

          // ── API 速度（api-speed 扩展写入） ──
          let speedStr = "";
          try {
            const statuses = footerData.getExtensionStatuses?.();
            const speed = statuses?.get("api-speed");
            if (speed) speedStr = cat(C.SLATE, ` ${sanitize(speed)}`);
          } catch { /* ignore */ }

          // ── 第 1 行：模型 + 目录（左） | 速度 + mode（右） ──
          const line1Left = `${cat(C.SYMBOL, "π")} ${modelStr} in ${dirStr}`;

          // mode（靠右，session name 已移至输入框上方 header）
          let rightExtra = "";
          try {
            const mode = ctx.mode;
            if (mode) rightExtra = cat(C.DIM, mode);
          } catch { /* ignore */ }

          // 速度 + mode 组合（速度在左，mode 在最右）
          if (speedStr) rightExtra = rightExtra ? `${speedStr} ${rightExtra}` : speedStr;

          if (rightExtra) {
            const pad = " ".repeat(Math.max(1, width - visibleWidth(line1Left) - visibleWidth(rightExtra)));
            lines.push(truncateToWidth(line1Left + pad + rightExtra, width));
          } else {
            lines.push(truncateToWidth(line1Left, width));
          }

          // ── 第 2 行：权限模式 | 时间 | token | 上下文 ──
          try {
            const statuses = footerData.getExtensionStatuses?.();
            const secondLineParts: string[] = [];

            // 权限模式（优先）
            const pmStatus = statuses?.get("pm");
            if (pmStatus) {
              if (pmStatus.includes("yolo")) {
                secondLineParts.push(cat(`${C.YOLO_BG};${C.YOLO_FG}`, " yolo "));
              } else if (pmStatus.includes("plan")) {
                secondLineParts.push(cat(`${C.PLAN_BG};${C.PLAN_FG}`, " plan "));
              } else {
                secondLineParts.push(cat(C.NORMAL_FG, "🔒 normal"));
              }
            }

            // 时间
            secondLineParts.push(timeStr);

            // token 统计
            secondLineParts.push(tokenStr);

            // 上下文
            if (contextStr) secondLineParts.push(contextStr);

            // 其他扩展状态
            if (statuses?.size > 0) {
              const others = Array.from(statuses.entries())
                .filter(([k]) => k !== "pm" && k !== "api-speed") // api-speed 已显示在 header
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([, text]) => sanitize(text));
              if (others.length > 0) {
                secondLineParts.push(others.join(" "));
              }
            }

            if (secondLineParts.length > 0) {
              lines.push(truncateToWidth(secondLineParts.join("  "), width, cat(C.DIM, "...")));
            }
          } catch { /* ignore */ }

          return lines;
        },
      };
    });
  });
}
