/**
 * Session Header — 把 session name 嵌进编辑器顶部边框（粗斜体金色）
 *
 * 替代之前的 widget 方案，通过自定义编辑器在 top border 中渲染名字，
 * 避免 widget 区域与编辑框之间的间距。
 */

import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

const PREFIX = "˖⁺‧₊˚ ";
// 金色粗斜体
const GOLD = "\x1b[1;3;38;2;240;198;116m";
const RESET = "\x1b[0m";

class SessionNameEditor extends CustomEditor {
  private _sessionName = "";

  setSessionName(name: string) {
    this._sessionName = name;
  }

  render(width: number): string[] {
    const lines = super.render(width);
    // 只替换普通的 top border（scrollOffset === 0 时）
    if (this._sessionName && lines.length > 0 && (this as any).scrollOffset === 0) {
      const styled = `${GOLD}${PREFIX}${this._sessionName}${RESET}`;
      const styledWidth = visibleWidth(PREFIX + this._sessionName);
      const remaining = width - styledWidth - 1; // -1 for space before name
      if (remaining >= 1) {
        lines[0] = (this as any).borderColor("─".repeat(remaining)) + " " + styled;
      }
    }
    return lines;
  }
}

export default function (pi: ExtensionAPI) {
  let editor: SessionNameEditor | null = null;

  function updateName() {
    const name = pi.getSessionName();
    if (editor) {
      editor.setSessionName(name || "");
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setEditorComponent((tui, theme, kb) => {
      editor = new SessionNameEditor(tui, theme, kb);
      updateName();
      return editor;
    });
    // 如果 session_start 时名字还没设置，等一会再试
    setTimeout(updateName, 100);
  });

  pi.on("session_info_changed", async () => {
    updateName();
  });

  pi.on("session_shutdown", async () => {
    editor = null;
  });
}
