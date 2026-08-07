/**
 * Stash — 暂存/恢复输入框内容
 *
 * 类似 Claude Code 的 Ctrl+S 暂存草稿功能。
 *
 * 快捷键：
 *   Ctrl+S   — toggle：有内容则暂存，空编辑框则恢复
 *
 * 命令：
 *   /stash       — 暂存（同 Ctrl+S）
 *   /stash pop   — 恢复并清除 stash
 *   /stash clear — 删除 stash
 *   /stash show  — 显示 stash 内容预览
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile, writeFile, access, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const STASH_DIR = join(homedir(), ".pi");
const STASH_FILE = join(STASH_DIR, "stash.md");

async function stashExists(): Promise<boolean> {
  try {
    await access(STASH_FILE);
    return true;
  } catch {
    return false;
  }
}

async function readStash(): Promise<string> {
  try {
    return await readFile(STASH_FILE, "utf-8");
  } catch {
    return "";
  }
}

async function writeStash(content: string): Promise<void> {
  // Ensure .pi dir exists
  try {
    await access(STASH_DIR);
  } catch {
    await writeFile(join(STASH_DIR, ".keep"), "", "utf-8");
  }
  await writeFile(STASH_FILE, content, "utf-8");
}

async function deleteStash(): Promise<void> {
  try {
    await access(STASH_FILE);
    const { unlink } = await import("node:fs/promises");
    await unlink(STASH_FILE);
  } catch {
    // File doesn't exist, ignore
  }
}

export default function (pi: ExtensionAPI) {
  // Ctrl+S — toggle: stash if editor has content, restore if editor empty + stash exists
  pi.registerShortcut("ctrl+s", {
    description: "Stash/restore editor content",
    handler: async (ctx) => {
      const text = ctx.ui.getEditorText();

      // Editor has content → stash
      if (text) {
        await writeStash(text);
        ctx.ui.setEditorText("");
        ctx.ui.notify("✂️ Stashed! (Ctrl+S again to restore)", "info");
        return;
      }

      // Editor empty → try restore
      if (!(await stashExists())) {
        ctx.ui.notify("Nothing to stash — editor is empty", "warning");
        return;
      }

      const stashContent = await readStash();
      if (!stashContent) {
        ctx.ui.notify("Stash is empty", "warning");
        return;
      }
      ctx.ui.setEditorText(stashContent);
      ctx.ui.notify("📋 Stash restored (Ctrl+S to stash again)", "info");
    },
  });

  // /stash command
  pi.registerCommand("stash", {
    description: "Manage stashed content. Usage: /stash [pop|clear|show]",
    handler: async (args, ctx) => {
      const cmd = args.trim().toLowerCase();

      if (cmd === "pop") {
        if (!(await stashExists())) {
          ctx.ui.notify("No stash found", "warning");
          return;
        }
        const stashContent = await readStash();
        if (!stashContent) {
          ctx.ui.notify("Stash is empty", "warning");
          return;
        }
        ctx.ui.setEditorText(stashContent);
        await deleteStash();
        ctx.ui.notify("📋 Stash restored and cleared", "info");
        return;
      }

      if (cmd === "clear") {
        await deleteStash();
        ctx.ui.notify("🗑️ Stash cleared", "info");
        return;
      }

      if (cmd === "show") {
        if (!(await stashExists())) {
          ctx.ui.notify("No stash found", "warning");
          return;
        }
        const stashContent = await readStash();
        if (!stashContent) {
          ctx.ui.notify("Stash is empty", "warning");
          return;
        }
        const preview =
          stashContent.length > 200
            ? stashContent.slice(0, 200) + "..."
            : stashContent;
        ctx.ui.notify(`📄 Stash preview:\n${preview}`, "info");
        return;
      }

      // Default: stash save
      const text = ctx.ui.getEditorText();
      if (!text) {
        ctx.ui.notify("Nothing to stash — editor is empty", "warning");
        return;
      }
      await writeStash(text);
      ctx.ui.setEditorText("");
      ctx.ui.notify("✂️ Stashed! (Ctrl+S again or /stash pop to restore)", "info");
    },
  });
}
