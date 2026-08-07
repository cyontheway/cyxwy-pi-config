/**
 * Git Checkpoint Before Overwrite — 文件被改前自动 checkpoint
 *
 * 在 write / edit / bash 调用前，拦截并判断是否值得 checkpoint，
 * 自动 git commit 当前版本，方便后续回滚。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync, appendFileSync } from "node:fs";

/** DEBUG: 调试日志 */
const DEBUG_LOG = "/tmp/pre-tool-debug.log";
function dbg(msg: string) {
  try { appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`); } catch {}
}

/** 文件内容超过此字符数视为值得 checkpoint */
const CONTENT_CHAR_THRESHOLD = 200;
/** bash 命令超过此字符数视为复杂操作 */
const BASH_CHAR_THRESHOLD = 300;

/** 提取 sed -i 或 sed -i'' 后面的文件路径 */
/** 同一 session 内，每个文件只 checkpoint 一次 */
const checkpointedFiles: Set<string> = new Set();
const SED_PATTERN = /sed\s+-i\w*\s+(?:\S+\s+)+['"]?([^'"]+\.\w+)['"]?/;
/** 提取 >> 或 > 重定向的目标文件 */
const REDIRECT_PATTERN = /(?:>>|>)\s*['"]?([^'";|& \t\n<>]+)['"]?\s*(?:$|[|&])/;

function extractBashTargets(command: string): string[] {
  const targets: string[] = [];
  const sedMatch = command.match(SED_PATTERN);
  if (sedMatch) targets.push(sedMatch[1]);
  // 只提取重定向的目标，不提取 >>（追加安全）
  const redirectMatch = command.match(/(?<!>)>\s*['"]?([^'";|& \t\n<>]+)['"]?\s*(?:$|[|&])/);
  if (redirectMatch) targets.push(redirectMatch[1]);
  return targets;
}

/** 获取文件内容字符数，文件不存在返回 0 */
async function getContentChars(filePath: string): Promise<number> {
  if (!existsSync(filePath)) return 0;
  const content = await readFile(filePath, "utf-8");
  return content.length;
}

/** 检查文件是否存在且达标，是则 checkpoint */
async function checkpointFile(
  filePath: string,
  ctx: any,
  pi: ExtensionAPI,
  label: string,
): Promise<void> {
  const absPath = filePath.startsWith("/") ? filePath : join(ctx.cwd, filePath);
  if (!existsSync(absPath)) { dbg(`checkpointFile: 文件不存在 ${absPath}`); return; }

  // 去重：同一 session 内每个文件只 checkpoint 一次
  if (checkpointedFiles.has(absPath)) { dbg(`checkpointFile: 已去重 ${absPath}`); return; }

  const charCount = await getContentChars(absPath);
  dbg(`checkpointFile: 字符数=${charCount}`);

  const { code: isRepo } = await pi.exec("git", ["rev-parse", "--is-inside-work-tree"], { timeout: 3000 });
  dbg(`checkpointFile: git rev-parse code=${isRepo}`);
  if (isRepo !== 0) return;

  const relPath = filePath.startsWith("/") ? filePath.replace(ctx.cwd + "/", "") : filePath;
  dbg(`checkpointFile: relPath=${relPath}, ctx.cwd=${ctx.cwd}`);

  // 变更检查：文件相对 HEAD 无变化（含未跟踪文件）则跳过，不标记
  // 修复：旧逻辑在 git 操作前就标记去重，commit 失败（nothing to commit）后
  // 文件被永久标记，后续真实修改全部失去 checkpoint 保护
  const { stdout: statusOut } = await pi.exec("git", ["status", "--porcelain", "--", relPath], { timeout: 5000 });
  if (!statusOut.trim()) {
    dbg(`checkpointFile: 无变更跳过 ${absPath}`);
    return;
  }

  const subject = `[pi] checkpoint[${label}]: ${relPath} (${charCount} chars)`;

  const { code: addCode } = await pi.exec("git", ["add", relPath], { timeout: 5000 });
  dbg(`checkpointFile: git add code=${addCode}`);
  if (addCode !== 0) return;

  const { code: commitCode } = await pi.exec("git", ["commit", "-m", subject], { timeout: 5000 });
  dbg(`checkpointFile: git commit code=${commitCode}`);
  if (commitCode !== 0) return;

  // 只有成功 checkpoint 后才标记去重；失败或跳过不标记，下次还能重试
  checkpointedFiles.add(absPath);

  if (ctx.hasUI) {
    ctx.ui.notify(`📌 checkpoint[${label}]: ${relPath}`, "info");
  }
}

export default function (pi: ExtensionAPI) {

  // session 退出时清空（新 session 重新计数）
  pi.on("session_shutdown", () => checkpointedFiles.clear());

  pi.on("tool_call", async (event, ctx) => {
    dbg(`tool_call 事件: toolName=${(event as any).toolName}`);
    // ── write：任何覆写都 checkpoint ──
    if (isToolCallEventType("write", event)) {
      const filePath = (event.input as any).path;
      dbg(`write 分支: path=${filePath}`);
      if (!filePath) return;
      await checkpointFile(filePath, ctx, pi, "write");
      return;
    }

    // ── edit：首次 edit 前 checkpoint，文件内容 >= 200 字符才触发 ──
    if (isToolCallEventType("edit", event)) {
      const filePath = event.input.path;
      if (!filePath) return;
      const absPath = filePath.startsWith("/") ? filePath : join(ctx.cwd, filePath);
      const contentChars = await getContentChars(absPath);
      if (contentChars >= CONTENT_CHAR_THRESHOLD) {
        await checkpointFile(filePath, ctx, pi, "edit");
      }
      return;
    }

    // ── bash：sed -i 或重定向 ──
    if (isToolCallEventType("bash", event)) {
      const command = event.input.command;
      if (!command) return;

      const targets = extractBashTargets(command);
      if (!targets.length) return;

      for (const target of targets) {
        const absPath = target.startsWith("/") ? target : join(ctx.cwd, target);
        const contentChars = await getContentChars(absPath);
        if (contentChars >= CONTENT_CHAR_THRESHOLD || command.length >= BASH_CHAR_THRESHOLD) {
          await checkpointFile(target, ctx, pi, "bash");
        }
      }
      return;
    }
  });
}
