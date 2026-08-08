/**
 * Pi Header — MAUVE 紫罗兰像素 logo + 顶部信息栏（v2 紫色系，配 dark-purple 主题）
 *
 * 用 ctx.ui.setHeader() 替换内置头部，显示：
 * - 绿色像素字体 "Pi"
 * - 版本号、~/ 绝对目录（空行后接模型名）、会话名称
 *
 * 模型切换 / 会话改名时自动更新。
 */

import os from "node:os";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

// ─── "Pi" 像素字 ──────────────────────────────────────

// 4×4 严格等分（每格 2.5 字符宽，用半块 ▌▐ 拼）
// 有色的格子：1 2 3 / 5 7 / 9 10 12 / 13 16
const PI_ART = [
  "███████▌  ",   // 1 2 3
  "██▌  ██▌  ",   // 5 . 7
  "█████  ▐██",   // 9 10 . 12
  "██▌    ▐██",   // 13 . . 16
];

// 外框正方形：10 字符 × 4 行（终端行高 ≈ 2.5 倍字宽）
const PI_WIDTH = 10;

// ─── Header Component ────────────────────────────────────

class PiHeaderComponent {
  private modelLabel: string;
  private sessionName: string;
  private dir: string;
  private green: (s: string) => string;
  private greenTint: (s: string) => string;

  constructor(
    private theme: Theme,
    private tui: { requestRender: () => void },
    modelLabel: string,
    sessionName: string,
  ) {
    this.modelLabel = modelLabel;
    this.sessionName = sessionName;
    // 工作目录，~/ 开头（home 前缀替换为 ~）
    const cwd = process.cwd();
    const home = os.homedir();
    this.dir =
      cwd === home ? "~" : cwd.startsWith(home + "/") ? "~" + cwd.slice(home.length) : cwd;
    // 绿 #a6e3a1（与 status 时间色同色，256 色回退 151）
    const greenAnsi =
      theme.getColorMode() === "truecolor" ? "\x1b[38;2;166;227;161m" : "\x1b[38;5;151m";
    this.green = (s: string) => `${greenAnsi}${s}\x1b[39m`;
    // 灰绿微染 #838c84（muted 灰 + 约 12% 绿，比上版 #8a9e90 更淡，256 色回退 244）
    const greenTintAnsi =
      theme.getColorMode() === "truecolor" ? "\x1b[38;2;131;140;132m" : "\x1b[38;5;244m";
    this.greenTint = (s: string) => `${greenTintAnsi}${s}\x1b[39m`;
  }

  setModelLabel(label: string) {
    this.modelLabel = label;
    this.tui.requestRender();
  }

  setSessionName(name: string) {
    this.sessionName = name;
    this.tui.requestRender();
  }

  render(width: number): string[] {
    return this.buildLines(width);
  }

  private buildLines(width: number): string[] {
    const p = this.green;
    const g = this.greenTint;

    const info: string[] = [`${g("pi")}  ${g("v" + VERSION)}`];
    // 目录行（~/ 绝对路径）→ 空一行 → 模型名
    info.push(`${g(this.dir)}`);
    info.push("");
    if (this.modelLabel) info.push(`${g(this.modelLabel)}`);
    if (this.sessionName) info.push(`${p(this.sessionName)}`);

    const result: string[] = [];
    const rows = Math.max(PI_ART.length, info.length);

    for (let i = 0; i < rows; i++) {
      const piRow = i < PI_ART.length ? PI_ART[i] : "";
      const infoRow = i < info.length ? info[i] : "";
      const availWidth = width - 2 - PI_WIDTH - 3;
    result.push(`  ${p(piRow.padEnd(PI_WIDTH))}   ${availWidth > 0 ? truncateToWidth(infoRow, availWidth) : infoRow}`);
    }

    result.push("");
    return result;
  }

  invalidate() {}
}

// ─── Extension ────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let header: PiHeaderComponent | null = null;

  function formatModelLabel(m?: { provider?: string; id: string }): string {
    if (!m) return "";
    return `${m.id}`;
  }

  function updateSession() {
    if (header) {
      header.setSessionName(pi.getSessionName() ?? "");
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    ctx.ui.setHeader((tui, theme) => {
      const modelLabel = ctx.model ? formatModelLabel(ctx.model) : "";
      header = new PiHeaderComponent(theme, tui, modelLabel, pi.getSessionName() ?? "");
      return header;
    });
  });

  pi.on("model_select", async (event) => {
    if (header) {
      header.setModelLabel(formatModelLabel(event.model));
    }
  });

  pi.on("session_info_changed", async () => {
    updateSession();
  });

  pi.on("session_shutdown", async () => {
    header = null;
  });

  pi.registerCommand("reset-header", {
    description: "恢复 pi 内置头部",
    handler: async (_args, ctx) => {
      ctx.ui.setHeader(undefined);
      ctx.ui.notify("已恢复内置头部", "info");
    },
  });
}
