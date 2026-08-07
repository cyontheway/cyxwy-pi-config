/**
 * Ask User — AI 调用时弹选项列表让用户选择
 * SelectList 箭头导航 + 自定义输入兜底
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, Input, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "ask_user",
		label: "询问用户",
		description: "弹出一个选项列表让用户选择。需要 question（问题文字）和 options（选项数组）。",
		parameters: Type.Object({
			question: Type.String({ description: "显示给用户的问题" }),
			options: Type.Array(Type.String(), { description: "选项列表，2-8 个" }),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return {
					content: [{ type: "text", text: `请选择：${params.options.join(" / ")}` }],
					details: { selected: null },
				};
			}

			const CUSTOM_KEY = "__custom__";
			let picked = false;

			const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
				const container = new Container();

				function buildPicker() {
					container.clear();
					container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
					container.addChild(new Text(theme.fg("accent", theme.bold(params.question)), 1, 1));

					const items: SelectItem[] = [
						...params.options.map((opt, i) => ({
							value: opt,
							label: `${i + 1}. ${opt}`,
						})),
						{ value: CUSTOM_KEY, label: `${params.options.length + 1}. 其他（自定义）` },
					];

					const selectList = new SelectList(items, Math.min(items.length, 10), {
						selectedPrefix: (t) => theme.fg("accent", t),
						selectedText: (t) => theme.fg("accent", t),
						description: (t) => theme.fg("muted", t),
						scrollInfo: (t) => theme.fg("dim", t),
						noMatch: (t) => theme.fg("warning", t),
					});

					selectList.onSelect = (item) => {
						if (item.value === CUSTOM_KEY) {
							// 切换到输入模式
							buildInput();
							tui.requestRender();
						} else {
							done(item.value);
						}
					};
					selectList.onCancel = () => done(null);
					container.addChild(selectList);
					container.addChild(new Text(theme.fg("dim", "↑↓ 导航 • 回车选择 • esc 取消"), 1, 0));
					container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

					currentHandleInput = (data) => { selectList.handleInput(data); tui.requestRender(); };
				}

				function buildInput() {
					container.clear();
					container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
					container.addChild(new Text(theme.fg("accent", theme.bold(params.question)), 1, 1));

					// 保留选项参考
					const refText = params.options
						.map((opt, i) => theme.fg("dim", `  ${i + 1}. ${opt}`))
						.join("\n");
					container.addChild(new Text(refText, 1, 0));
					container.addChild(new Text(theme.fg("accent", "  自定义输入："), 1, 0));

					const input = new Input();
					input.onSubmit = (text) => done(text.trim() || null);
					input.onEscape = () => done(null);
					container.addChild(input);
					container.addChild(new Text(theme.fg("dim", "回车确认 • esc 取消"), 1, 0));
					container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

					currentHandleInput = (data) => { input.handleInput(data); tui.requestRender(); };
				}

				let currentHandleInput: (data: string) => void = () => {};

				buildPicker();

				return {
					render: (w) => container.render(w),
					invalidate: () => container.invalidate(),
					handleInput: (data) => { currentHandleInput(data); },
				};
			});

			return {
				content: [{ type: "text", text: result ? `选择了：${result}` : "已取消" }],
				details: { selected: result },
			};
		},
	});
}
