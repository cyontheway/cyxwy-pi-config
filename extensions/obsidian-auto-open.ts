/**
 * Obsidian Auto-Open — edit/write 后自动在 Obsidian 中打开文件（火抛）
 * 对齐 CC PostToolUse hook 逻辑
 *
 * ⚠️ Fire-and-forget：不阻塞 tool_result 事件，避免 WebUI 卡死。
 * 如果当前没有运行的 Obsidian，提前退出，零开销。
 *
 * Changelog:
 *   2026-06-09 execSync → execAsync（解决 terminal pi 卡死）
 *   2026-06-19 添加日志 + 优化：顶层 catch、重试2次、导入修复
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { exec } from "node:child_process";
import { existsSync, appendFileSync } from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

const LOG = "/tmp/obsidian-auto-open.log";
const execAsync = promisify(exec);

function log(msg: string) {
	const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
	try {
		appendFileSync(LOG, `[${ts}] ${msg}\n`);
	} catch {
		// 日志失败不阻塞
	}
}

/**
 * 快速检测 Obsidian 是否正在运行（macOS）
 * 没跑就直接跳过，省掉无意义的超时等待
 */
async function isObsidianRunning(): Promise<boolean> {
	const start = Date.now();
	try {
		const { stdout } = await execAsync(
			'pgrep -q Obsidian && echo "running" || echo "not running"',
			{ timeout: 1000 },
		);
		const running = stdout.trim() === "running";
		log(`  pgrep: ${running ? "running" : "not running"} (${Date.now() - start}ms)`);
		return running;
	} catch (err: any) {
		log(`  pgrep error: ${err?.message ?? err} (${Date.now() - start}ms)`);
		return false;
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_result", (event) => {
		if (event.toolName !== "edit" && event.toolName !== "write") return;
		if (event.isError) return;

		const filePath = event.input?.path;
		if (!filePath || typeof filePath !== "string") return;
		if (!filePath.endsWith(".md")) return;

		log(`tool_result: ${event.toolName} | ${filePath}`);

		// 找 vault（从文件目录往上找 .obsidian）
		let dir = path.dirname(filePath);
		let vaultPath = "";
		while (dir !== "/" && dir !== process.env.HOME) {
			if (existsSync(path.join(dir, ".obsidian"))) {
				vaultPath = dir;
				break;
			}
			dir = path.dirname(dir);
		}
		if (!vaultPath) {
			log(`  skip: not in any vault`);
			return;
		}
		log(`  vault: ${vaultPath}`);

		const relPath = path.relative(vaultPath, filePath);
		log(`  relPath: ${relPath}`);

		// ⚡ 火抛：不阻塞 tool_result 事件
		setTimeout(() => {
			(async () => {
				log(`  --- attempt start ---`);

				// 先检查 Obsidian 是否在运行
				const running = await isObsidianRunning();
				if (!running) {
					log(`  skip: Obsidian not running`);
					return;
				}

				// 重试：新文件创建后 Obsidian 需要时间索引
				// 2 次 × 3s + 1 × 300ms ≈ 6.3s 极限，够用
				const MAX_RETRIES = 2;
				let lastError: string | null = null;
				for (let i = 0; i < MAX_RETRIES; i++) {
					const attemptStart = Date.now();
					if (i > 0) {
						await new Promise((r) => setTimeout(r, 300));
					}
					try {
						const { stdout } = await execAsync(
							`cd "${vaultPath}" && obsidian open path="${relPath}"`,
							{ timeout: 3000 },
						);
						const elapsed = Date.now() - attemptStart;
						const found = stdout.includes("not found");
						log(`  attempt ${i + 1}/${MAX_RETRIES}: ok (${elapsed}ms) stdout="${stdout.trim()}"`);
						if (!found) return;
						lastError = `stdout: ${stdout.trim()}`;
					} catch (err: any) {
						const elapsed = Date.now() - attemptStart;
						lastError = `${err?.message ?? err} (${elapsed}ms)`;
						log(`  attempt ${i + 1}/${MAX_RETRIES}: error ${lastError}`);
					}
				}
				log(`  --- all ${MAX_RETRIES} exhausted: ${lastError} ---`);
			})().catch((err: any) => {
				log(`  UNCAUGHT: ${err?.message ?? err}`);
			});
		}, 0);
	});
}
