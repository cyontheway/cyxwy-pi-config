/**
 * Session Message Extension
 *
 * 跨 session 发消息：/msg <session短id或名字> <消息内容>
 * 实现：pi.exec 跑独立 pi 进程 `pi --session <id> -p "<消息>"`，目标 session 的 AI 回复直接打印到 stdout。
 * 结果通过 appendEntry + registerEntryRenderer 渲染，不进入主 LLM 上下文。
 *
 * 与 cross-session-msg skill 配合：skill 是 AI 主动调用（补问/交接/补记），
 * 本命令是用户手动发消息（知道 session 号时最快）。
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { Box, Spacer, Text } from "@earendil-works/pi-tui";
import { getMarkdownTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ---------- 工具函数 ----------

/** 确定 pi 可执行文件的调用方式（与 roundtable 一致：TUI 下用 node + 入口脚本，否则用 pi 命令） */
function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}
	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}
	return { command: "pi", args };
}

/** 从 session 文件提取显示名（读 session_info 事件，流式读取只找名字，不读全文件） */
function getSessionName(file: string): Promise<string> {
	return new Promise((resolve) => {
		let name = "";
		try {
			const rl = readline.createInterface({
				input: fs.createReadStream(file, { encoding: "utf8" }),
				crlfDelay: Infinity,
			});
			rl.on("line", (line) => {
				if (name) return; // 已找到就忽略后续行
				if (!line.trim()) return;
				try {
					const obj = JSON.parse(line);
					if (obj?.type === "session_info" && obj.name?.trim()) {
						name = obj.name.trim();
						rl.close();
					}
				} catch { /* ignore */ }
			});
			rl.on("close", () => resolve(name));
			rl.on("error", () => resolve(name));
		} catch {
			resolve(name);
		}
	});
}

/** 生成 session 目录名：去掉开头 /，其余 / 换成 -，空格保留，前后加 -- */
function sessionDirName(cwd: string): string {
	return "--" + cwd.replace(/^\//, "").replace(/\//g, "-") + "--";
}

/** 列出当前 cwd 下的 session 文件（去掉 .jsonl） */
function listSessionFiles(cwd: string): string[] {
	const sessionDir = path.join(
		process.env.HOME || "",
		".pi", "agent", "sessions",
		sessionDirName(cwd),
	);
	try {
		return fs.readdirSync(sessionDir)
			.filter((f) => f.endsWith(".jsonl"))
			.sort()
			.reverse();
	} catch {
		return [];
	}
}

/** 解析参数：第一个 token 是 session 标识，剩余是消息 */
function parseArgs(args: string): { target: string; message: string } {
	const trimmed = args.trim();
	const idx = trimmed.indexOf(" ");
	if (idx === -1) return { target: trimmed, message: "" };
	return { target: trimmed.slice(0, idx).trim(), message: trimmed.slice(idx + 1).trim() };
}

/** 根据短 id 或名字匹配 session 文件（异步，名字匹配需读文件） */
async function findSessionFile(cwd: string, target: string): Promise<string | null> {
	const files = listSessionFiles(cwd);
	// 1. 短 id 前缀匹配（如 019fa965）
	const byId = files.find((f) => f.startsWith(target) || f.includes(target));
	if (byId) return byId;
	// 2/3. 名字精确/模糊匹配（需读文件，只找有名字的，找到即停）
	for (const f of files) {
		const name = await getSessionName(path.join(sessionDirOf(cwd, f), f));
		if (name === target || name.includes(target)) return f;
	}
	return null;
}

function sessionDirOf(cwd: string, _file: string): string {
	return path.join(
		process.env.HOME || "",
		".pi", "agent", "sessions",
		sessionDirName(cwd),
	);
}

/** 用 spawn 跑 pi --session <短id> -p <msg>（参数对齐 bash 工具：detached + env + windowsHide） */
async function sendToSession(pi: ExtensionAPI, cwd: string, sessionFile: string, message: string): Promise<{ output: string; error: string | null }> {
	// --session 只接受短 id（文件名里 019fa965 那一段），不接受完整文件名
	const shortId = sessionFile.match(/_[0-9a-f]{8}/)?.[0]?.slice(1);
	if (!shortId) {
		return { output: "", error: `无法从 ${sessionFile} 提取短 id` };
	}
	return new Promise((resolve) => {
		const args = ["--session", shortId, "-p", message];
		let proc;
		try {
			const invocation = getPiInvocation(args);
			proc = spawn(invocation.command, invocation.args, {
				cwd,
				detached: process.platform !== "win32",
				env: process.env,
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
			});
		} catch (err: any) {
			// debug：输出调用信息帮助定位 EBADF
			const debug = { cwd, execPath: process.execPath, argv1: process.argv[1], args: JSON.stringify(args) };
			resolve({ output: "", error: `spawn 失败: ${err?.message || err} | ${JSON.stringify(debug)}` });
			return;
		}
		let stdout = "";
		let stderr = "";
		proc.stdout?.on("data", (d) => (stdout += d.toString()));
		proc.stderr?.on("data", (d) => (stderr += d.toString()));
		proc.on("close", () => {
			resolve({ output: stdout.trim(), error: stderr.trim() || null });
		});
		proc.on("error", (err) => {
			resolve({ output: "", error: err.message });
		});
	});
}

// ---------- 渲染 ----------

interface MsgEntryData {
	target: string;
	targetName?: string;
	message: string;
	status: "running" | "done" | "error";
	output?: string;
	error?: string;
}

// ---------- Extension 主体 ----------

export default function sessionMsgExtension(pi: ExtensionAPI) {
	const mdTheme = getMarkdownTheme();

	pi.registerEntryRenderer("session-msg", (entry, { expanded }, theme) => {
		const data = entry.data as MsgEntryData;
		const display = data.targetName ? `${data.target} (${data.targetName})` : data.target;
		if (data.status === "running") {
			return new Box(1, 1, (text) => theme.bg("customMessageBg", text),
				new Text(theme.fg("warning", "⏳") + ` ${theme.fg("accent", `[→ ${display}]`)}` + theme.fg("dim", " 发送中...")));
		}
		const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
		let header = theme.fg("toolTitle", `[→ ${display}]`);
		if (data.status === "error") header += ` ${theme.fg("error", "[出错] 未送达")}`;
		else header += ` ${theme.fg("success", "[已送达]")}`;
		box.addChild(new Text(header, 0, 0));
		box.addChild(new Text(theme.fg("dim", `你：${data.message}`), 0, 0));
		box.addChild(new Spacer(1));
		if (data.error) {
			box.addChild(new Text(theme.fg("error", data.error), 0, 0));
		} else if (data.output) {
			box.addChild(new Text(theme.fg("dim", `回复（${data.output.length} 字）：`), 0, 0));
			if (expanded) {
				box.addChild(new Text(theme.fg("toolOutput", data.output), 0, 0));
			} else {
				const lines = data.output.split("\n").slice(0, 6).join("\n");
				box.addChild(new Text(theme.fg("toolOutput", lines), 0, 0));
			}
		} else {
			box.addChild(new Text(theme.fg("dim", "(空回复)"), 0, 0));
		}
		return box;
	});

	pi.registerCommand("msg", {
		description: "给指定 session 发消息：/msg <session短id或名字> <消息>，回复打印在此处",
		getArgumentCompletions: async (prefix: string): Promise<AutocompleteItem[] | null> => {
			const files = listSessionFiles(process.cwd());
			// 并行读取所有 session 名字（流式，只找 session_info），全部列出
			const items: AutocompleteItem[] = await Promise.all(files.map(async (f) => {
				const shortId = f.match(/_[0-9a-f]{8}/)?.[0]?.slice(1) || f.replace(/\.jsonl$/, "");
				const name = await getSessionName(path.join(sessionDirOf(process.cwd(), f), f));
				const label = name ? `${shortId} (${name})` : shortId;
				return { value: shortId, label, description: f.replace(/\.jsonl$/, "") };
			}));
			const filtered = items.filter((i) => i.value.startsWith(prefix) || i.label.includes(prefix));
			// 不匹配时返回 null 让补全列表关闭（否则列表一直挂着，回车被拦截发不出去）
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const { target, message } = parseArgs(args);
			if (!target || !message) {
				ctx.ui.notify("用法：/msg <session短id或名字> <消息>。Tab 可补全 session", "info");
				return;
			}
			const sessionFile = await findSessionFile(ctx.cwd, target);
			if (!sessionFile) {
				ctx.ui.notify(`找不到 session "${target}"，Tab 查看可用列表`, "error");
				return;
			}
			const fullPath = path.join(sessionDirOf(ctx.cwd, sessionFile), sessionFile);
			const targetName = (await getSessionName(fullPath)) || undefined;
			const baseData: MsgEntryData = { target, targetName, message, status: "running" };
			pi.appendEntry("session-msg", baseData);

			const result = await sendToSession(pi, ctx.cwd, fullPath, message);

			pi.appendEntry("session-msg", {
				...baseData,
				status: result.error ? "error" : "done",
				output: result.output,
				error: result.error,
			});
		},
	});
}
