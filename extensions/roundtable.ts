/**
 * /talk 与 /roundtable 命令扩展
 *
 * /talk <agent名> <消息>            点名指定 agent 单独回答，结果直接呈现在会话里
 * /roundtable <agent1,agent2,...> <议题>   多 agent 圆桌讨论：
 *   - 第一轮：各 agent 独立发表意见（并行）
 *   - 第二轮：互相看到对方意见后交叉回应（并行）
 *   - 第三轮：用默认模型当主持人输出结构化会议纪要
 *
 * 实现方式：复用 subagent 扩展的 agent 发现逻辑，spawn 独立 pi 进程执行每个 agent，
 * 结果通过 appendEntry + registerEntryRenderer 渲染成气泡样式，不进入主 LLM 上下文。
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { Box, Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { getMarkdownTheme, withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverAgents, type AgentConfig } from "./subagent/agents.ts";

const MAX_PARTICIPANTS = 4;
const MAX_PARALLEL = 4;

// ---------- 工具函数 ----------

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

function formatUsage(usage: { input: number; output: number; cost: number; turns: number }, model?: string): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (model) parts.push(model);
	return parts.join(" ");
}

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

async function writeSystemPromptToTemp(agent: AgentConfig): Promise<{ dir: string; file: string } | null> {
	const systemPrompt = agent.systemPrompt.trim();
	if (!systemPrompt) return null;
	const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-talk-"));
	const file = path.join(tmpDir, `prompt-${agent.name.replace(/[^\w.-]+/g, "_")}.md`);
	await withFileMutationQueue(file, async () => {
		await fs.promises.writeFile(file, systemPrompt, { encoding: "utf-8", mode: 0o600 });
	});
	return { dir: tmpDir, file };
}

interface AgentRunResult {
	agent: string;
	output: string;
	error?: string;
	exitCode: number;
	model?: string;
	usage: { input: number; output: number; cost: number; turns: number };
}

function getFinalAssistantText(messages: any[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") return part.text;
			}
		}
	}
	return "";
}

/**
 * spawn 一个独立 pi 进程执行任务。
 * agent 为 null 时用默认模型（不附加 system prompt），用于主持人总结轮。
 */
function runAgentProcess(
	cwd: string,
	agent: AgentConfig | null,
	displayName: string,
	task: string,
): Promise<AgentRunResult> {
	const args: string[] = ["--mode", "json", "-p", "--no-session"];
	if (agent?.model) args.push("--model", agent.model);
	if (agent?.tools && agent.tools.length > 0) args.push("--tools", agent.tools.join(","));

	const usage = { input: 0, output: 0, cost: 0, turns: 0 };
	const messages: any[] = [];
	let model: string | undefined = agent?.model;
	let stopReason: string | undefined;
	let errorMessage: string | undefined;
	let stderr = "";
	let tmp: { dir: string; file: string } | null = null;

	return (async () => {
		try {
			if (agent) {
				tmp = await writeSystemPromptToTemp(agent);
				if (tmp) args.push("--append-system-prompt", tmp.file);
			}
			args.push(`Task: ${task}`);

			const exitCode = await new Promise<number>((resolve) => {
				const invocation = getPiInvocation(args);
				const proc = spawn(invocation.command, invocation.args, {
					cwd,
					shell: false,
					stdio: ["ignore", "pipe", "pipe"],
				});
				let buffer = "";

				const processLine = (line: string) => {
					if (!line.trim()) return;
					let event: any;
					try {
						event = JSON.parse(line);
					} catch {
						return;
					}
					if (event.type === "message_end" && event.message) {
						const msg = event.message;
						messages.push(msg);
						if (msg.role === "assistant") {
							usage.turns++;
							const u = msg.usage;
							if (u) {
								usage.input += u.input || 0;
								usage.output += u.output || 0;
								usage.cost += u.cost?.total || 0;
							}
							if (msg.model) model = msg.model;
							if (msg.stopReason) stopReason = msg.stopReason;
							if (msg.errorMessage) errorMessage = msg.errorMessage;
						}
					}
				};

				proc.stdout.on("data", (data) => {
					buffer += data.toString();
					const lines = buffer.split("\n");
					buffer = lines.pop() || "";
					for (const line of lines) processLine(line);
				});
				proc.stderr.on("data", (data) => {
					stderr += data.toString();
				});
				proc.on("close", (code) => {
					if (buffer.trim()) processLine(buffer);
					resolve(code ?? 0);
				});
				proc.on("error", () => {
					resolve(1);
				});
			});

			const failed = exitCode !== 0 || stopReason === "error" || stopReason === "aborted";
			return {
				agent: displayName,
				output: getFinalAssistantText(messages),
				error: failed ? errorMessage || stderr || "(no output)" : undefined,
				exitCode,
				model,
				usage,
			};
		} finally {
			if (tmp) {
				try {
					fs.unlinkSync(tmp.file);
				} catch {
					/* ignore */
				}
				try {
					fs.rmdirSync(tmp.dir);
				} catch {
					/* ignore */
				}
			}
		}
	})();
}

// ---------- 参数解析 ----------

function parseTalkArgs(args: string): { agent?: string; message?: string } {
	const m = args.match(/^(\S+)\s+([\s\S]+)$/);
	if (!m) return {};
	return { agent: m[1], message: m[2].trim() };
}

function parseRoundtableArgs(args: string): { names: string[]; repeat: number; topic?: string } {
	// 语法：/roundtable <agent1,agent2,...> [xN] <议题>，xN 表示每个 agent 分身 N 份（最多 3）
	const m = args.match(/^(\S+)\s+(?:x(\d+)\s+)?([\s\S]+)$/);
	if (!m) return { names: [], repeat: 1 };
	const names = m[1]
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	const repeat = m[2] ? Math.min(Math.max(parseInt(m[2], 10) || 1, 1), 3) : 1;
	return { names, repeat, topic: m[3].trim() };
}

function parseDebateArgs(args: string): { names: string[]; topic?: string; turns?: number } {
	// 语法：/debate <agent1,agent2> <议题> [轮数]，轮数默认 4，上限 10
	const m = args.match(/^(\S+)\s+([\s\S]+)$/);
	if (!m) return { names: [] };
	const names = m[1]
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	let topic = m[2].trim();
	let turns: number | undefined;
	const tm = topic.match(/^(.*?)\s+(\d+)$/);
	if (tm) {
		topic = tm[1].trim();
		turns = parseInt(tm[2], 10);
	}
	if (turns !== undefined) turns = Math.min(Math.max(turns, 2), 10);
	return { names, topic, turns };
}

function agentCompletions(agents: AgentConfig[], prefix: string): AutocompleteItem[] | null {
	const items = agents.map((a) => ({ value: a.name, label: `${a.name} (${a.description})` }));
	const filtered = items.filter((i) => i.value.startsWith(prefix));
	return filtered.length > 0 ? filtered : null;
}

function getAgents(cwd: string): AgentConfig[] {
	return discoverAgents(cwd, "user").agents;
}

function listAgentNames(agents: AgentConfig[]): string {
	return agents.map((a) => `"${a.name}"`).join(", ") || "none";
}

// ---------- Entry 数据类型 ----------

interface TalkEntryData {
	kind: "talk";
	agent: string;
	model?: string;
	status: "running" | "done" | "error";
	message: string;
	output?: string;
	error?: string;
	usage?: string;
}

interface RoundResult {
	agent: string;
	output: string;
	error?: string;
	usage?: string;
}

interface RoundtableEntryData {
	kind: "roundtable";
	topic: string;
	status: "running" | "done";
	stage: string;
	rounds?: Array<{ label: string; results: RoundResult[] }>;
	summary?: string;
	summaryUsage?: string;
}

interface Participant {
	agent: AgentConfig;
	label: string;
}

interface TurnResult {
	agent: string;
	output: string;
	error?: string;
	usage?: string;
}

interface DebateEntryData {
	kind: "debate";
	topic: string;
	status: "running" | "done";
	stage: string;
	turns?: TurnResult[];
}

// ---------- 渲染器 ----------

function renderTalkEntry(data: TalkEntryData, expanded: boolean, theme: any, mdTheme: any) {
	if (data.status === "running") {
		const preview = data.message.length > 40 ? `${data.message.slice(0, 40)}...` : data.message;
		return new Text(theme.fg("warning", "⏳") + ` ${theme.fg("accent", data.agent)}` + theme.fg("dim", ` 正在回复：${preview}`), 0, 0);
	}
	const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
	let header =
		theme.fg("toolTitle", theme.bold(`💬 ${data.agent}`)) +
		theme.fg("muted", ` 回答「${data.message}」`);
	if (data.status === "error") header += ` ${theme.fg("error", "[出错]")}`;
	box.addChild(new Text(header, 0, 0));
	if (data.status === "error" && data.error) box.addChild(new Text(theme.fg("error", data.error), 0, 0));
	if (data.output) {
		box.addChild(new Spacer(1));
		if (expanded) {
			box.addChild(new Markdown(data.output.trim(), 0, 0, mdTheme));
		} else {
			const lines = data.output.trim().split("\n").slice(0, 6).join("\n");
			box.addChild(new Text(theme.fg("toolOutput", lines), 0, 0));
		}
	}
	if (data.usage) {
		box.addChild(new Spacer(1));
		box.addChild(new Text(theme.fg("dim", data.usage), 0, 0));
	}
	return box;
}

function renderRoundtableEntry(data: RoundtableEntryData, expanded: boolean, theme: any, mdTheme: any) {
	if (data.status === "running") {
		return new Text(theme.fg("warning", "⏳") + ` ${theme.fg("toolTitle", theme.bold("圆桌讨论"))}` + theme.fg("dim", ` ${data.stage}`), 0, 0);
	}
	const container = new Container();
	container.addChild(
		new Text(
			theme.fg("toolTitle", theme.bold("🏛 圆桌讨论")) +
				theme.fg("muted", ` 议题：${data.topic}`),
			0,
			0,
		),
	);
	if (data.rounds) {
		for (const round of data.rounds) {
			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("muted", `─── ${round.label} ───`), 0, 0));
			for (const r of round.results) {
				const icon = r.error ? theme.fg("error", "✗") : theme.fg("success", "✓");
				container.addChild(new Spacer(1));
				container.addChild(new Text(`${theme.fg("accent", r.agent)} ${icon}`, 0, 0));
				if (r.error) {
					container.addChild(new Text(theme.fg("error", r.error), 0, 0));
				} else if (expanded) {
					container.addChild(new Markdown(r.output.trim(), 0, 0, mdTheme));
				} else {
					const lines = r.output.trim().split("\n").slice(0, 5).join("\n");
					container.addChild(new Text(theme.fg("toolOutput", lines), 0, 0));
				}
				if (r.usage) container.addChild(new Text(theme.fg("dim", r.usage), 0, 0));
			}
		}
	}
	if (data.summary) {
		container.addChild(new Spacer(1));
		container.addChild(new Text(theme.fg("muted", "─── 主持人总结 ───"), 0, 0));
		if (expanded) {
			container.addChild(new Markdown(data.summary.trim(), 0, 0, mdTheme));
		} else {
			container.addChild(new Text(theme.fg("toolOutput", data.summary.trim().split("\n").slice(0, 8).join("\n")), 0, 0));
		}
		if (data.summaryUsage) container.addChild(new Text(theme.fg("dim", data.summaryUsage), 0, 0));
	}
	return container;
}

function renderDebateEntry(data: DebateEntryData, expanded: boolean, theme: any, mdTheme: any) {
	if (data.status === "running") {
		return new Text(theme.fg("warning", "⏳") + ` ${theme.fg("toolTitle", theme.bold("自由对辩"))}` + theme.fg("dim", ` ${data.stage}`), 0, 0);
	}
	const container = new Container();
	container.addChild(
		new Text(
			theme.fg("toolTitle", theme.bold("⚔️ 自由对辩")) + theme.fg("muted", ` 议题：${data.topic}`),
			0,
			0,
		),
	);
	if (data.turns) {
		data.turns.forEach((t, i) => {
			const icon = t.error ? theme.fg("error", "✗") : theme.fg("success", "✓");
			container.addChild(new Spacer(1));
			container.addChild(
				new Text(
					theme.fg("muted", `─── 第 ${i + 1} 轮 · `) + theme.fg("accent", t.agent) + ` ─── ${icon}`,
					0,
					0,
				),
			);
			if (t.error) {
				container.addChild(new Text(theme.fg("error", t.error), 0, 0));
			} else if (expanded) {
				container.addChild(new Markdown(t.output.trim(), 0, 0, mdTheme));
			} else {
				const lines = t.output.trim().split("\n").slice(0, 5).join("\n");
				container.addChild(new Text(theme.fg("toolOutput", lines), 0, 0));
			}
			if (t.usage) container.addChild(new Text(theme.fg("dim", t.usage), 0, 0));
		});
	}
	return container;
}

// ---------- 扩展入口 ----------

export default function (pi: ExtensionAPI) {
	const mdTheme = getMarkdownTheme();

	pi.registerEntryRenderer("talk-message", (entry, { expanded }, theme) => {
		return renderTalkEntry(entry.data as TalkEntryData, expanded, theme, mdTheme);
	});

	pi.registerEntryRenderer("roundtable-entry", (entry, { expanded }, theme) => {
		return renderRoundtableEntry(entry.data as RoundtableEntryData, expanded, theme, mdTheme);
	});

	pi.registerEntryRenderer("debate-entry", (entry, { expanded }, theme) => {
		return renderDebateEntry(entry.data as DebateEntryData, expanded, theme, mdTheme);
	});

	// ---- /talk 点名对话 ----
	pi.registerCommand("talk", {
		description: "点名与指定 agent 对话：/talk <agent名> <消息>",
		getArgumentCompletions: (prefix: string) => {
			return agentCompletions(getAgents(process.cwd()), prefix);
		},
		handler: async (args, ctx) => {
			const agents = getAgents(ctx.cwd);
			const { agent: agentName, message } = parseTalkArgs(args);

			if (!agentName || !message) {
				ctx.ui.notify(`用法：/talk <agent名> <消息>。可用 agent：${listAgentNames(agents)}`, "info");
				return;
			}
			const agent = agents.find((a) => a.name === agentName);
			if (!agent) {
				ctx.ui.notify(`找不到 agent "${agentName}"。可用：${listAgentNames(agents)}`, "error");
				return;
			}

			const baseData: TalkEntryData = { kind: "talk", agent: agent.name, model: agent.model, status: "running", message };
			pi.appendEntry("talk-message", baseData);

			const result = await runAgentProcess(ctx.cwd, agent, agent.name, message);

			pi.appendEntry("talk-message", {
				...baseData,
				status: result.error ? "error" : "done",
				output: result.output,
				error: result.error,
				usage: formatUsage(result.usage, result.model),
			});
		},
	});

	// ---- /roundtable 圆桌讨论 ----
	pi.registerCommand("roundtable", {
		description: "多 agent 圆桌讨论：/roundtable <agent1,agent2,...> <议题>",
		getArgumentCompletions: (prefix: string) => {
			return agentCompletions(getAgents(process.cwd()), prefix);
		},
		handler: async (args, ctx) => {
			const agents = getAgents(ctx.cwd);
			const { names, repeat, topic } = parseRoundtableArgs(args);

			if (names.length === 0 || !topic) {
				ctx.ui.notify(`用法：/roundtable <agent1,agent2,...> [xN] <议题>。可用 agent：${listAgentNames(agents)}`, "info");
				return;
			}

			// 展开参与者（支持同名分身，自动编号）
			const occurrences = new Map<string, number>();
			for (const n of names) occurrences.set(n, (occurrences.get(n) ?? 0) + 1);
			const participants: Participant[] = [];
			const unknownNames: string[] = [];
			for (const n of names) {
				const agent = agents.find((a) => a.name === n);
				if (!agent) {
					unknownNames.push(n);
					continue;
				}
				const total = (occurrences.get(n) ?? 1) * repeat;
				for (let i = 1; i <= repeat; i++) {
					participants.push({ agent, label: total > 1 ? `${n}#${i}` : n });
				}
			}
			if (participants.length === 0) {
				ctx.ui.notify(`找不到这些 agent：${names.join(", ")}。可用：${listAgentNames(agents)}`, "error");
				return;
			}
			if (unknownNames.length > 0) {
				ctx.ui.notify(`忽略找不到的 agent：${unknownNames.join(", ")}`, "warning");
			}
			if (participants.length > MAX_PARTICIPANTS) {
				ctx.ui.notify(`最多 ${MAX_PARTICIPANTS} 位参与者（含分身），当前 ${participants.length} 位`, "error");
				return;
			}
			const nameList = participants.map((p) => p.label).join(", ");
			const baseData: RoundtableEntryData = {
				kind: "roundtable",
				topic,
				status: "running",
				stage: `${nameList} 正在发表第一轮意见...`,
			};
			pi.appendEntry("roundtable-entry", baseData);

			const runRound = async (
				label: string,
				taskFor: (participant: Participant, context: string) => string,
				context: string,
				stageText: string,
			): Promise<{ label: string; results: RoundResult[] }> => {
				baseData.stage = stageText;
				pi.appendEntry("roundtable-entry", { ...baseData });
				const results = await Promise.all(
					participants.slice(0, MAX_PARALLEL).map(async (p) => {
						const r = await runAgentProcess(ctx.cwd, p.agent, p.label, taskFor(p, context));
						return {
							agent: p.label,
							output: r.output,
							error: r.error,
							usage: formatUsage(r.usage, r.model),
						} as RoundResult;
					}),
				);
				return { label, results };
			};

			// 第一轮：独立发表
			const round1 = await runRound(
				"第一轮 · 独立意见",
				(p, ctxText) =>
					`【圆桌讨论】议题：${ctxText}\n你是与会者【${p.label}】。` +
					(p.label.includes("#")
						? `你与同名分身共享同一人格设定，请独立作答，尽量给出与其他分身不同的视角。`
						: ``) +
					`请就上述议题发表你的独立分析意见：你的立场、核心观点与理由。直接输出意见内容，不要寒暄。`,
				topic,
				`${nameList} 正在发表第一轮意见...`,
			);

			// 第二轮：交叉互评
			const transcript1 = round1.results.map((r) => `【${r.agent}】\n${r.output}`).join("\n\n");
			const round2 = await runRound(
				"第二轮 · 交叉互评",
				(p, ctxText) =>
					`【圆桌讨论 · 第二轮】议题：${ctxText}\n\n以下是第一轮的全部意见：\n\n${transcript1}\n\n` +
					`其中【${p.label}】是你的第一轮意见，其余是其他与会者的意见。` +
					`请针对其他与会者的意见逐一做出回应（赞同、反对或补充），说明理由；也可以修正或补充你自己的立场。直接输出回应内容，不要寒暄。`,
				topic,
				`${nameList} 正在交叉互评...`,
			);

			// 第三轮：主持人总结（默认模型）
			baseData.stage = "主持人正在总结...";
			pi.appendEntry("roundtable-entry", { ...baseData });

			const transcript2 = round2.results.map((r) => `【${r.agent}】\n${r.output}`).join("\n\n");
			const summaryTask =
				`你是一场多 agent 圆桌讨论的主持人，请输出结构化的会议纪要，包含四部分：\n` +
				`1. 各方核心立场\n2. 共识点\n3. 分歧点\n4. 综合结论与建议\n\n` +
				`议题：${topic}\n\n【第一轮 · 独立意见】\n${transcript1}\n\n【第二轮 · 交叉互评】\n${transcript2}`;
			const summary = await runAgentProcess(ctx.cwd, null, "host", summaryTask);

			pi.appendEntry("roundtable-entry", {
				...baseData,
				status: "done",
				rounds: [round1, round2],
				summary: summary.output || summary.error,
				summaryUsage: formatUsage(summary.usage, summary.model),
			});
		},
	});

	// ---- /debate 自由对辩 ----
	pi.registerCommand("debate", {
		description: "双 agent 自由对辩：/debate <agent1,agent2> <议题> [轮数，默认4]",
		getArgumentCompletions: (prefix: string) => {
			return agentCompletions(getAgents(process.cwd()), prefix);
		},
		handler: async (args, ctx) => {
			const agents = getAgents(ctx.cwd);
			const { names, topic, turns } = parseDebateArgs(args);

			if (names.length === 0 || !topic) {
				ctx.ui.notify(`用法：/debate <agent1,agent2> <议题> [轮数]。可用 agent：${listAgentNames(agents)}`, "info");
				return;
			}

			const participants = names
				.map((n) => agents.find((a) => a.name === n))
				.filter((a): a is AgentConfig => Boolean(a));
			if (participants.length !== 2 || names.length !== 2) {
				ctx.ui.notify(`对辩需要恰好 2 位 agent，当前解析到 ${names.length} 位，可用：${listAgentNames(agents)}`, "error");
				return;
			}

			const [sideA, sideB] = participants;
			const roundCount = turns ?? 4;
			const baseData: DebateEntryData = {
				kind: "debate",
				topic,
				status: "running",
				stage: `第 1/${roundCount} 轮 · ${sideA.name} 发言中...`,
			};
			pi.appendEntry("debate-entry", baseData);

			const turnsData: TurnResult[] = [];
			let transcript = "";
			for (let i = 1; i <= roundCount; i++) {
				const speaker = i % 2 === 1 ? sideA : sideB;
				baseData.stage = `第 ${i}/${roundCount} 轮 · ${speaker.name} 发言中...`;
				pi.appendEntry("debate-entry", { ...baseData });

				const task =
					i === 1
						? `【自由对辩】议题：${topic}\n你是第一位发言人，请先亮明你的立场并给出核心论证。直接输出发言内容，不要寒暄。`
						: `【自由对辩】议题：${topic}\n\n以下是到目前为止的对话记录：\n\n${transcript}\n\n现在是你的发言轮次，请直接回应对方的观点：可以反驳、补充、让步，或提出新论据，继续推进讨论，不要复述已有内容。直接输出发言内容，不要寒暄。`;

				const r = await runAgentProcess(ctx.cwd, speaker, speaker.name, task);
				turnsData.push({
					agent: speaker.name,
					output: r.output,
					error: r.error,
					usage: formatUsage(r.usage, r.model),
				});
				transcript += `【${speaker.name}】\n${r.output}\n\n`;
			}

			pi.appendEntry("debate-entry", {
				...baseData,
				status: "done",
				turns: turnsData,
			});
		},
	});
}
