/**
 * API 速度监控：在底部状态栏显示 LLM 请求的速度
 *
 * 通过 ctx.ui.setStatus("api-speed", ...) 写入 footer，status-footer.ts
 * 第二行的扩展状态区会自动显示。
 *
 * 逻辑：
 * - 流式请求中：滑动窗口（3s）估算实时速度（delta 字符近似 token，中英混排）
 * - 请求结束：用 message_end 的真实 usage tokens / 总耗时，显示平均速度
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const UPDATE_INTERVAL = 250; // ms，setStatus 节流
const WINDOW_MS = 3000;      // 滑动窗口时长

// 模块级状态（扩展生命周期内共享）
let active = false;
let startTime = 0;
let accTokens = 0;          // 本次请求累计估算 token
let lastUpdate = 0;
let lastDisplay = "";        // 上次请求结束后的显示，空闲时保留

/** 滑动窗口：{[时间戳, 估算token]} */
let window: { t: number; toks: number }[] = [];

/** 粗略估算 token 数：中文/全角约 1 token，ASCII 约 3.5 字符 1 token */
function estimateTokenCount(text: string): number {
  let ascii = 0, wide = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) < 128) ascii++;
    else wide++;
  }
  return wide + ascii / 3.5;
}

function pushWindow(toks: number, now: number) {
  window.push({ t: now, toks });
  while (window.length > 0 && now - window[0].t > WINDOW_MS) window.shift();
}

function windowSpeed(now: number): number {
  if (window.length === 0) return 0;
  const total = window.reduce((s, w) => s + w.toks, 0);
  const dur = (now - window[0].t) / 1000;
  return dur > 0.1 ? total / dur : 0;
}

function fmtSpeed(tokPerSec: number): string {
  if (!isFinite(tokPerSec) || tokPerSec <= 0) return "";
  if (tokPerSec >= 100) return `${Math.round(tokPerSec)}`;
  return tokPerSec.toFixed(1);
}

export default function (pi: ExtensionAPI) {
  /** 写速度：共享到 globalThis（供 session-header 读取）+ setStatus（触发重绘） */
  function updateSpeed(ctx: { ui: { setStatus(k: string, t: string | undefined): void } }, text: string | undefined) {
    (globalThis as any).__piApiSpeed = text;
    ctx.ui.setStatus("api-speed", text);
  }

  pi.on("message_start", async (event, ctx) => {
    if (event.message.role !== "assistant") return;
    active = true;
    startTime = Date.now();
    accTokens = 0;
    lastUpdate = 0;
    window = [];
    updateSpeed(ctx, "⚡ 等待中");
  });

  pi.on("message_update", async (event, ctx) => {
    if (!active) return;
    const ev = event.assistantMessageEvent;
    if (ev.type !== "text_delta" && ev.type !== "thinking_delta" && ev.type !== "toolcall_delta") return;

    const toks = estimateTokenCount(ev.delta);
    accTokens += toks;
    const now = Date.now();
    pushWindow(toks, now);

    // 节流：至少 250ms 才更新一次状态
    if (now - lastUpdate < UPDATE_INTERVAL) return;
    lastUpdate = now;

    const speed = windowSpeed(now);
    const label = fmtSpeed(speed);
    if (!label) return;
    updateSpeed(ctx, `⚡ ${label} tok/s`);
  });

  pi.on("message_end", async (event, ctx) => {
    if (event.message.role !== "assistant") return;
    const elapsed = (Date.now() - startTime) / 1000;
    const usage = event.message.usage;
    const total = usage ? usage.input + usage.output + usage.cacheRead + usage.cacheWrite : 0;

    let display: string;
    if (total > 0 && elapsed > 0.1) {
      const avg = total / elapsed;
      display = `⚡ ${fmtSpeed(avg)} tok/s · ${elapsed.toFixed(1)}s`;
    } else {
      const avg = accTokens / Math.max(elapsed, 0.1);
      display = `⚡ ${fmtSpeed(avg)} tok/s · ${elapsed.toFixed(1)}s`;
    }
    lastDisplay = display;
    updateSpeed(ctx, display);
    active = false;
  });

  // 流式中断（Esc / 错误）兜底：回到上次完成状态
  pi.on("turn_end", async (_event, ctx) => {
    if (!active) return;
    active = false;
    updateSpeed(ctx, lastDisplay || undefined);
  });
}
