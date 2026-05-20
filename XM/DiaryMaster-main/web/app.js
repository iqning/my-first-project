const fileTreeEl = document.getElementById("file-tree");
const panelTreeEl = document.getElementById("panel-tree");
const fileContextMenuEl = document.getElementById("file-context-menu");
const textContextMenuEl = document.getElementById("text-context-menu");
const btnNewFile = document.getElementById("btn-new-file");
const btnNewFolder = document.getElementById("btn-new-folder");
const editorEl = document.getElementById("editor");
const diffViewEl = document.getElementById("diff-view");
const editorPreviewEl = document.getElementById("editor-preview");
const currentFileLabel = document.getElementById("current-file-label");
const btnSave = document.getElementById("btn-save");
const btnViewEdit = document.getElementById("btn-view-edit");
const btnViewPreview = document.getElementById("btn-view-preview");
const btnViewDiff = document.getElementById("btn-view-diff");
const panelEditorEl = document.getElementById("panel-editor");
const EDITOR_VIEW_MODE_KEY = "diarymaster-editor-view-mode";
const chatMessagesEl = document.getElementById("chat-messages");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const btnSend = document.getElementById("btn-send");
const btnNewSession = document.getElementById("btn-new-session");
const sessionTabsEl = document.getElementById("session-tabs");
const appTooltipEl = document.getElementById("app-tooltip");
const btnSettings = document.getElementById("btn-settings");
const btnSettingsClose = document.getElementById("btn-settings-close");
const settingsOverlay = document.getElementById("settings-overlay");

/** @type {{ pendingId: string, resolve: (approved: boolean) => void } | null} */
let inlineConfirmWaiter = null;
const settingsForm = document.getElementById("settings-form");
const settingsApiKeyInput = document.getElementById("settings-api-key");
const settingsApiKeyHint = document.getElementById("settings-api-key-hint");
const btnSettingsClearKey = document.getElementById("btn-settings-clear-key");
let appTooltipAnchor = null;
const sessionHistoryListEl = document.getElementById("session-history-list");
const panelHistoryEl = document.getElementById("panel-history");
const btnSessionHistory = document.getElementById("btn-session-history");
const resizeHandleHistory = document.querySelector('[data-resize="chat-history"]');
const layoutEl = document.getElementById("app-layout");
const sessionContextRingEl = document.getElementById("session-context-ring");
const modelPickerEl = document.getElementById("model-picker");
const modelPickerTrigger = document.getElementById("model-picker-trigger");
const modelPickerLabel = document.getElementById("model-picker-label");
const modelPickerMenu = document.getElementById("model-picker-menu");
let composerModelId = "";
const thinkingToggleEl = document.getElementById("thinking-toggle");
const CONTEXT_RING_R = 8;
const CONTEXT_RING_C = 2 * Math.PI * CONTEXT_RING_R;
const MODEL_STORAGE_KEY = "diarymaster-model-id";
const THINKING_STORAGE_KEY = "diarymaster-thinking-enabled";
const LAYOUT_STORAGE_KEY = "diarymaster-layout-v1";
const TABS_STORAGE_KEY = "diarymaster-open-tabs";
const HISTORY_OPEN_STORAGE_KEY = "diarymaster-history-open";
const THEME_STORAGE_KEY = "diarymaster-theme";

/** 将旧版 localStorage 键一次性迁移到 diarymaster-*（若存在） */
function migrateLocalStorageKeys() {
  const pairs = [
    [MODEL_STORAGE_KEY, "deepnote-model-id"],
    [THINKING_STORAGE_KEY, "deepnote-thinking-enabled"],
    [LAYOUT_STORAGE_KEY, "deepnote-layout-v1"],
    [TABS_STORAGE_KEY, "deepnote-open-tabs"],
    [THEME_STORAGE_KEY, "deepnote-theme"],
  ];
  try {
    for (const [current, old] of pairs) {
      if (!localStorage.getItem(current) && localStorage.getItem(old)) {
        localStorage.setItem(current, localStorage.getItem(old));
      }
    }
  } catch {
    /* ignore */
  }
}

/** 从 localStorage 读取单项配置。 */
function readStorageItem(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

let modelsCatalog = [];
let defaultModelId = "deepseek-v4-flash";

let currentFile = null;
let viewMode = "edit";
/** @type {"edit"|"preview"} 全局显示偏好，切换文件时保持 */
let editorViewPreference = "edit";
let fileSnapshots = {};
let currentDiff = null;
let sessionId = null;
let sessionTurn = 0;
let sessionChanges = [];
let selectedChangeId = null;
/** @type {Array<object>} */
let chatLog = [];
/** @type {Array<object>} */
let sessionsList = [];
/** @type {string[]} */
let openTabIds = [];
let historyPanelOpen = false;

/** @type {ReturnType<typeof setTimeout> | null} */
let previewSyncTimer = null;

/** 懒加载 HTML→Markdown 转换器。 */
function getTurndownService() {
  if (typeof TurndownService === "undefined") return null;
  if (!getTurndownService._instance) {
    getTurndownService._instance = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      emDelimiter: "*",
    });
  }
  return getTurndownService._instance;
}

/** 预览区是否仅为空占位。 */
function isEditorPreviewPlaceholder() {
  return Boolean(editorPreviewEl?.querySelector(".editor-preview-empty"));
}

/** 判断可编辑预览 HTML 是否实质为空。 */
function isBlankPreviewHtml(html) {
  const trimmed = (html || "").trim();
  return (
    !trimmed ||
    trimmed === "<br>" ||
    trimmed === "<p><br></p>" ||
    trimmed === "<p></p>"
  );
}

/** 将可编辑预览区的 HTML 写回 textarea（不重新渲染预览）。 */
function syncPreviewHtmlToEditor() {
  if (!editorPreviewEl) return;
  if (isEditorPreviewPlaceholder()) {
    editorEl.value = "";
    return;
  }
  const html = editorPreviewEl.innerHTML;
  if (isBlankPreviewHtml(html)) {
    editorEl.value = "";
    return;
  }
  const turndown = getTurndownService();
  editorEl.value = turndown
    ? turndown.turndown(html)
    : editorPreviewEl.innerText || "";
}

/** 防抖：预览输入时同步到隐藏 textarea。 */
function schedulePreviewSync() {
  if (viewMode !== "preview") return;
  if (previewSyncTimer) clearTimeout(previewSyncTimer);
  previewSyncTimer = setTimeout(() => {
    previewSyncTimer = null;
    syncPreviewHtmlToEditor();
  }, 200);
}

/** 聚焦空预览时替换为可编辑段落。 */
function onEditorPreviewFocusIn() {
  if (viewMode !== "preview" || !editorPreviewEl) return;
  if (!isEditorPreviewPlaceholder()) return;
  editorPreviewEl.innerHTML = "<p></p>";
  editorPreviewEl.contentEditable = "true";
}

/** 根据 textarea 渲染预览 HTML。 */
function refreshEditorPreview() {
  if (!editorPreviewEl) return;
  const text = editorEl.value;
  if (!text.trim()) {
    editorPreviewEl.innerHTML =
      '<p class="editor-preview-empty">暂无内容。点击此处开始输入。</p>';
    return;
  }
  editorPreviewEl.innerHTML = renderMarkdownToHtml(text);
}

/** 进入可编辑预览：渲染并开启 contenteditable。 */
function mountEditablePreview() {
  if (!editorPreviewEl) return;
  refreshEditorPreview();
  editorPreviewEl.contentEditable = "true";
  editorPreviewEl.setAttribute("role", "textbox");
  editorPreviewEl.setAttribute("aria-multiline", "true");
}

/** 离开预览前写回 textarea 并关闭编辑。 */
function unmountEditablePreview() {
  if (previewSyncTimer) {
    clearTimeout(previewSyncTimer);
    previewSyncTimer = null;
  }
  syncPreviewHtmlToEditor();
  if (!editorPreviewEl) return;
  editorPreviewEl.contentEditable = "false";
  editorPreviewEl.removeAttribute("role");
  editorPreviewEl.removeAttribute("aria-multiline");
}

/** 同步「编辑 / 预览 / 变更」三档互斥高亮（与 viewMode 一致）。 */
function syncEditorViewSwitchUI() {
  const mode = viewMode;
  const hasDiff = Boolean(currentDiff);

  btnViewEdit?.classList.toggle("active", mode === "edit");
  btnViewPreview?.classList.toggle("active", mode === "preview");
  btnViewDiff?.classList.toggle("active", mode === "diff");

  btnViewEdit?.setAttribute("aria-pressed", mode === "edit" ? "true" : "false");
  btnViewPreview?.setAttribute("aria-pressed", mode === "preview" ? "true" : "false");
  btnViewDiff?.setAttribute("aria-pressed", mode === "diff" ? "true" : "false");

  if (btnViewDiff) {
    btnViewDiff.hidden = !hasDiff;
    btnViewDiff.disabled = !hasDiff || !currentFile;
  }

  if (panelEditorEl) panelEditorEl.dataset.viewMode = mode;
}

/** 按全局偏好显示编辑区（退出 Diff 时用）。 */
function applyContentViewFromPreference() {
  setViewMode(editorViewPreference);
}

/** 切换显示模式：编辑 / 预览 / 变更（三档互斥）。 */
function setEditorDisplayMode(mode) {
  if (mode === "diff") {
    if (!currentDiff) return;
    setViewMode("diff");
    return;
  }

  editorViewPreference = mode === "preview" ? "preview" : "edit";
  try {
    localStorage.setItem(EDITOR_VIEW_MODE_KEY, editorViewPreference);
  } catch {
    /* ignore */
  }
  setViewMode(editorViewPreference);
}

/** 打开文件时决定显示编辑、预览或 Diff。 */
function resolveViewModeForOpen({ keepDiff = false } = {}) {
  if (keepDiff && currentDiff) return "diff";
  return editorViewPreference;
}

/** 切换编辑 / 预览 / Diff 视图。 */
function setViewMode(mode) {
  if (viewMode === "preview" && mode !== "preview") {
    unmountEditablePreview();
  }

  viewMode = mode;
  const isEdit = mode === "edit";
  const isPreview = mode === "preview";
  const isDiff = mode === "diff";

  editorEl.classList.toggle("hidden", !isEdit);
  if (editorPreviewEl) editorPreviewEl.classList.toggle("hidden", !isPreview);
  diffViewEl.classList.toggle("hidden", !isDiff);

  const readOnly = isDiff;
  btnSave.disabled = !currentFile || readOnly;

  if (isPreview) mountEditablePreview();
  syncEditorViewSwitchUI();
}

/** 更新编辑器顶栏（保存、变更档可见性）。 */
function updateEditorViewTabs() {
  if (!currentDiff && viewMode === "diff") applyContentViewFromPreference();
  else syncEditorViewSwitchUI();
}

/** 根据是否有 Diff 更新 Diff 标签可用状态。 */
function updateDiffTabState() {
  updateEditorViewTabs();
}

/** 渲染左右对比的 Diff 视图。 */
function renderDiff(oldText, newText) {
  if (typeof Diff === "undefined") {
    diffViewEl.textContent = "未加载 diff 库，请检查网络。";
    return { added: 0, removed: 0 };
  }

  const parts = Diff.diffLines(oldText || "", newText || "");
  diffViewEl.innerHTML = "";
  let added = 0;
  let removed = 0;
  let newLineNo = 1;

  for (const part of parts) {
    const lines = part.value.split("\n");
    if (lines.length && lines[lines.length - 1] === "") lines.pop();

    for (const line of lines) {
      const row = document.createElement("div");
      row.className = "diff-line";

      const gutter = document.createElement("span");
      gutter.className = "diff-gutter";
      const sign = document.createElement("span");
      sign.className = "diff-sign";
      const text = document.createElement("span");
      text.className = "diff-text";
      text.textContent = line;

      if (part.added) {
        row.classList.add("added");
        sign.textContent = "+";
        gutter.textContent = String(newLineNo++);
        added += 1;
      } else if (part.removed) {
        row.classList.add("removed");
        sign.textContent = "-";
        gutter.textContent = "";
        removed += 1;
      } else {
        row.classList.add("unchanged");
        sign.textContent = " ";
        gutter.textContent = String(newLineNo++);
      }

      row.appendChild(gutter);
      row.appendChild(sign);
      row.appendChild(text);
      diffViewEl.appendChild(row);
    }
  }

  return { added, removed };
}

/** 显示指定变更的 Diff 并切换到 Diff 模式。 */
function showDiff(oldText, newText, changeId = null) {
  currentDiff = { oldText, newText, changeId };
  renderDiff(oldText, newText);
  updateDiffTabState();
  setViewMode("diff");
  selectedChangeId = changeId;
  renderChat();
}

/** 清空 Diff 状态并回到编辑模式。 */
function clearDiff() {
  currentDiff = null;
  selectedChangeId = null;
  diffViewEl.innerHTML = "";
  updateDiffTabState();
  renderChat();
}

/** 格式化文件变更元信息为展示文案。 */
function formatChangeMeta(c) {
  const srcMap = { agent: "Agent", manual: "手动", rollback: "回退" };
  const src = srcMap[c.source] || c.source;
  const oldN = c.old_line_count ?? "?";
  const newN = c.new_line_count ?? "?";
  return { src, lines: `${oldN}→${newN} 行` };
}

/** 构建单条文件变更的 DOM 行。 */
function buildChangeRow(c) {
  const row = document.createElement("div");
  row.className = "chat-change-row";
  if (c.id === selectedChangeId) row.classList.add("active");
  row.dataset.changeId = c.id;

  const { src, lines } = formatChangeMeta(c);
  const info = document.createElement("span");
  info.className = "chat-change-info";
  info.textContent = `${c.path} · ${src} · ${lines}`;

  const actions = document.createElement("span");
  actions.className = "chat-change-actions";

  const btnView = document.createElement("button");
  btnView.type = "button";
  btnView.className = "btn-link";
  btnView.textContent = "查看变更";
  btnView.addEventListener("click", () => viewChange(c.id));

  actions.appendChild(btnView);
  row.appendChild(info);
  row.appendChild(actions);
  return row;
}

/** 构建一轮对话的文件变更卡片 DOM。 */
function createChangeBlockElement(turn, changes, { compact = false } = {}) {
  const block = document.createElement("div");
  block.className = "msg msg-changes";
  block.dataset.turn = String(turn);

  const title = document.createElement("div");
  title.className = "chat-change-title";
  title.textContent = compact ? "文件变更" : `第 ${turn} 轮 · 文件变更`;

  const list = document.createElement("div");
  list.className = "chat-change-list";
  for (const c of changes) {
    list.appendChild(buildChangeRow(normalizeChange(c)));
  }

  block.appendChild(title);
  block.appendChild(list);
  return block;
}

/** 规范化后端返回的变更对象为前端结构。 */
function normalizeChange(c) {
  const oldText = c.old_content ?? "";
  const newText = c.new_content ?? "";
  return {
    id: c.id,
    turn: c.turn,
    path: c.path,
    source: c.source || "agent",
    old_line_count: c.old_line_count ?? (oldText ? oldText.split("\n").length : 0),
    new_line_count: c.new_line_count ?? (newText ? newText.split("\n").length : 0),
    old_content: c.old_content,
    new_content: c.new_content,
  };
}

/** 从 chat_log 计算当前最大轮次号。 */
function maxTurnFromChatLog(log) {
  let max = 0;
  for (const item of log) {
    const t = item.turn;
    if (t != null) max = Math.max(max, Number(t));
  }
  return max;
}

/** 计算下一条消息应使用的轮次号。 */
function nextChatTurn() {
  return Math.max(sessionTurn, maxTurnFromChatLog(chatLog)) + 1;
}

/** 将 chat_log 按轮次分组为 UI 渲染结构。 */
function groupChatLogIntoTurns(log) {
  const preamble = [];
  const byTurn = new Map();

  for (const item of log) {
    if (item.type === "message" && (item.role === "system" || item.turn == null)) {
      preamble.push(item);
      continue;
    }
    if (item.type === "message") {
      const t = item.turn;
      if (!byTurn.has(t)) byTurn.set(t, { turn: t, messages: [], changes: [] });
      byTurn.get(t).messages.push(item);
    } else if (item.type === "changes") {
      const t = item.turn;
      if (!byTurn.has(t)) byTurn.set(t, { turn: t, messages: [], changes: [] });
      for (const c of item.changes || []) {
        byTurn.get(t).changes.push(normalizeChange(c));
      }
    }
  }

  const turns = [...byTurn.keys()]
    .sort((a, b) => a - b)
    .map((t) => byTurn.get(t));
  return { preamble, turns };
}

/** 配置 marked 渲染器选项。 */
function configureMarkdownRenderer() {
  if (typeof marked === "undefined") return;
  marked.setOptions({
    gfm: true,
    breaks: true,
    headerIds: false,
    mangle: false,
  });
}
configureMarkdownRenderer();

/** 将 Markdown 文本转为 HTML。 */
function renderMarkdownToHtml(text) {
  if (!text) return "";
  if (typeof marked === "undefined") {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");
  }
  const raw = marked.parse(text);
  if (typeof DOMPurify !== "undefined") {
    return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
  }
  return raw;
}

/** Agent 回复用 Markdown；用户消息保持纯文本 */
function setMessageBody(el, text, role) {
  if (!text) return;
  if (role === "assistant") {
    el.classList.add("markdown-body");
    el.innerHTML = renderMarkdownToHtml(text);
  } else {
    el.classList.remove("markdown-body");
    el.textContent = text;
  }
}

const TOOL_LABELS = {
  list_files: "list_files",
  read_file: "read_file",
  edit_file: "edit_file",
  write_file: "write_file",
  generate_title: "generate_title",
  agent: "agent",
};

/** 合并历史与进行中的 assistant 步骤列表。 */
function effectiveAssistantSteps(item) {
  const steps = item.steps ? [...item.steps] : [];
  if (!item.reasoning) return steps;
  if (steps.some((s) => s.kind === "reasoning")) return steps;
  return [
    {
      id: `reasoning-${item.turn || "hist"}`,
      kind: "reasoning",
      status: "done",
      label: "思考过程",
      detail: item.reasoning,
    },
    ...steps,
  ];
}

/** 按步骤 id 合并去重步骤列表。 */
function mergeStepsById(steps) {
  const order = [];
  const map = new Map();
  for (const s of steps || []) {
    if (!s || !s.id) continue;
    if (!map.has(s.id)) order.push(s.id);
    map.set(s.id, s);
  }
  return order.map((id) => map.get(id));
}

/** 返回步骤状态对应的图标字符。 */
function stepStatusIcon(status) {
  if (status === "running") return "◌";
  if (status === "error") return "✕";
  return "✓";
}

/** 将步骤分为进行中与已完成两组。 */
function partitionSteps(steps) {
  const merged = mergeStepsById(steps);
  const header = merged.filter((s) => s.kind === "reply_status");
  const main = merged.filter((s) => s.kind !== "reply_status");
  return { main, header };
}

/** 判断步骤流是否已全部结束。 */
function isStepsFlowComplete(steps) {
  const { header } = partitionSteps(steps);
  return header.some(
    (s) =>
      s.kind === "reply_status" && (s.status === "done" || s.status === "error")
  );
}

/** 完成后默认折叠；进行中始终展开 */
function resolveStepsCollapsed(item) {
  if (item._pending) return false;
  const steps = item.steps || [];
  const { main } = partitionSteps(steps);
  if (!main.length || !isStepsFlowComplete(steps)) return false;
  if (item.stepsCollapsed === undefined) return true;
  return Boolean(item.stepsCollapsed);
}

/** 创建单条 Agent 步骤的 DOM 行。 */
function createAgentStepRow(step) {
  const row = document.createElement("div");
  const kind = step.kind || "tool";
  const tool = step.tool ? ` agent-step-tool-${step.tool}` : "";
  row.className = `agent-step agent-step-${kind} agent-step-${step.status || "done"}${tool}`;
  if (kind === "llm") row.classList.add("agent-step-llm");
  if (kind === "reasoning") row.classList.add("agent-step-reasoning");
  if (kind === "reply_status") row.classList.add("agent-step-reply-status");
  row.dataset.stepId = step.id;

  const icon = document.createElement("span");
  icon.className = "agent-step-icon";
  icon.textContent = stepStatusIcon(step.status);

  const body = document.createElement("span");
  body.className = "agent-step-body";

  const label = document.createElement("span");
  label.className = "agent-step-label";
  let labelText = step.label || "";
  if (step.tool && TOOL_LABELS[step.tool]) {
    labelText = `[${step.tool}] ${labelText}`;
  }
  label.textContent = labelText;
  body.appendChild(label);

  if (step.detail && (step.status !== "running" || kind === "reasoning")) {
    const detail = document.createElement("span");
    detail.className = "agent-step-detail";
    detail.textContent = step.detail;
    body.appendChild(detail);
  }

  row.appendChild(icon);
  row.appendChild(body);
  return row;
}

/** 构建 Agent 步骤列表容器 DOM。 */
function buildAgentStepsElement(
  steps,
  { active = false, collapsed = false, onToggle = null } = {}
) {
  const wrap = document.createElement("div");
  wrap.className = "agent-steps";
  const { main, header } = partitionSteps(steps);
  if (!main.length && !header.length && active) {
    const row = document.createElement("div");
    row.className = "agent-step agent-step-thinking agent-step-running";
    row.innerHTML =
      '<span class="agent-step-icon">◌</span><span class="agent-step-label">思考中…</span>';
    wrap.appendChild(row);
    return wrap;
  }
  if (header.length) {
    const canToggle = Boolean(onToggle) && main.length > 0;
    const headerWrap = document.createElement("div");
    headerWrap.className = "agent-steps-header";
    if (canToggle) {
      headerWrap.classList.add("agent-steps-toggle");
      headerWrap.setAttribute("role", "button");
      headerWrap.tabIndex = 0;
      headerWrap.setAttribute("aria-expanded", collapsed ? "false" : "true");
      headerWrap.dataset.tooltip = collapsed ? "点击展开执行过程" : "点击折叠执行过程";

      const chevron = document.createElement("span");
      chevron.className = "agent-steps-chevron";
      chevron.setAttribute("aria-hidden", "true");
      chevron.textContent = collapsed ? "▸" : "▾";
      headerWrap.appendChild(chevron);

      const activateToggle = (e) => {
        if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onToggle();
      };
      headerWrap.addEventListener("click", activateToggle);
      headerWrap.addEventListener("keydown", activateToggle);
    }

    const headerInner = document.createElement("div");
    headerInner.className = "agent-steps-header-inner";
    for (const step of header) {
      headerInner.appendChild(createAgentStepRow(step));
    }
    headerWrap.appendChild(headerInner);
    wrap.appendChild(headerWrap);
  }

  if (main.length) {
    const body = document.createElement("div");
    body.className = "agent-steps-body";
    for (const step of main) {
      body.appendChild(createAgentStepRow(step));
    }
    wrap.appendChild(body);
  }

  if (collapsed && main.length) {
    wrap.classList.add("agent-steps-collapsed");
  }

  return wrap;
}

/** 查找进行中的 assistant 占位消息。 */
function findPendingAssistant(pendingId) {
  return chatLog.find((m) => m._pending === pendingId);
}

/** 更新或插入一条 Agent 步骤到占位消息。 */
function upsertAgentStep(pendingId, step) {
  const msg = findPendingAssistant(pendingId);
  if (!msg) return;
  if (!msg.steps) msg.steps = [];
  const idx = msg.steps.findIndex((s) => s.id === step.id);
  if (idx >= 0) msg.steps[idx] = step;
  else msg.steps.push(step);
  renderChat();
}

/** 完成 assistant 占位消息并写入最终回复。 */
function finalizePendingAssistant(pendingId, { text, steps, reasoning, usage }) {
  const msg = findPendingAssistant(pendingId);
  if (!msg) return;
  delete msg._pending;
  if (text != null) msg.text = text;
  if (steps) msg.steps = steps;
  if (reasoning) msg.reasoning = reasoning;
  if (usage) msg.usage = usage;
  if (isStepsFlowComplete(msg.steps || [])) {
    msg.stepsCollapsed = true;
  }
  renderChat();
}

/** 将单条消息 DOM 追加到聊天区。 */
function appendMessageElement(parent, item) {
  const div = document.createElement("div");
  div.className = `msg ${item.role}`;
  if (item._pending) div.classList.add("pending");

  const hasSteps =
    item.role === "assistant" &&
    (item.steps?.length || item.reasoning || item._pending);
  if (hasSteps) {
    const steps = effectiveAssistantSteps(item);
    const collapsed = resolveStepsCollapsed(item);
    const canToggle =
      !item._pending && isStepsFlowComplete(steps) && partitionSteps(steps).main.length > 0;
    div.appendChild(
      buildAgentStepsElement(steps, {
        active: Boolean(item._pending),
        collapsed,
        onToggle: canToggle
          ? () => {
              item.stepsCollapsed = !resolveStepsCollapsed(item);
              renderChat();
            }
          : null,
      })
    );
    const textEl = document.createElement("div");
    textEl.className = "msg-text";
    const bodyText =
      item.text ||
      (item._pending && !(item.steps && item.steps.length) ? "等待 Agent…" : "");
    if (bodyText) {
      setMessageBody(textEl, bodyText, item.role);
      div.appendChild(textEl);
    }
  } else if (item.text) {
    if (item.role === "assistant") {
      const textEl = document.createElement("div");
      textEl.className = "msg-text";
      setMessageBody(textEl, item.text, item.role);
      div.appendChild(textEl);
    } else {
      div.textContent = item.text;
    }
  }

  const confirmBar = buildInlineConfirmBar(item);
  if (confirmBar) div.appendChild(confirmBar);

  const usageFooter = buildMessageUsageFooter(item);
  if (usageFooter) div.appendChild(usageFooter);

  parent.appendChild(div);
}

/** 构造消息底部的内联危险操作确认条。 */
function buildInlineConfirmBar(item) {
  const req = item._confirmRequest;
  if (!req || item.role !== "assistant") return null;

  const bar = document.createElement("div");
  bar.className = "msg-inline-confirm";
  bar.setAttribute("role", "group");
  bar.setAttribute(
    "aria-label",
    req.tool === "delete_path" ? "确认删除" : "确认操作"
  );

  const text = document.createElement("p");
  text.className = "msg-inline-confirm-text";
  const brief =
    req.tool === "delete_path"
      ? `删除「${req.path || req.label}」？不可恢复。`
      : req.detail || req.message || req.label || "是否继续？";
  text.textContent = brief;
  bar.appendChild(text);

  const actions = document.createElement("div");
  actions.className = "msg-inline-confirm-actions";

  const btnCancel = document.createElement("button");
  btnCancel.type = "button";
  btnCancel.className = "msg-inline-confirm-btn";
  btnCancel.textContent = "取消";
  btnCancel.addEventListener("click", () => resolveInlineToolConfirm(false));

  const btnOk = document.createElement("button");
  btnOk.type = "button";
  btnOk.className = "msg-inline-confirm-btn msg-inline-confirm-btn--danger";
  btnOk.textContent = "确认";
  btnOk.addEventListener("click", () => resolveInlineToolConfirm(true));

  actions.appendChild(btnCancel);
  actions.appendChild(btnOk);
  bar.appendChild(actions);
  return bar;
}

/** 结束内联确认等待（由确认条按钮触发）。 */
function resolveInlineToolConfirm(approved) {
  if (!inlineConfirmWaiter) return;
  const { pendingId, resolve } = inlineConfirmWaiter;
  inlineConfirmWaiter = null;
  const msg = findPendingAssistant(pendingId);
  if (msg) delete msg._confirmRequest;
  renderChat();
  resolve(approved);
}

/** 根据 chatLog 重绘整个聊天区。 */
function renderChat() {
  chatMessagesEl.innerHTML = "";
  const { preamble, turns } = groupChatLogIntoTurns(chatLog);

  for (const item of preamble) {
    appendMessageElement(chatMessagesEl, item);
  }

  for (const block of turns) {
    const section = document.createElement("div");
    section.className = "chat-turn-block";
    section.dataset.turn = String(block.turn);

    const divider = document.createElement("hr");
    divider.className = "chat-turn-divider";
    section.appendChild(divider);

    const header = document.createElement("div");
    header.className = "chat-turn-header";

    const hasPending = block.messages.some((m) => m._pending);
    const label = document.createElement("span");
    label.className = "chat-turn-label";
    label.textContent = hasPending ? `第 ${block.turn} 轮 · 进行中` : `第 ${block.turn} 轮`;

    if (!hasPending) {
      const btnRollback = document.createElement("button");
      btnRollback.type = "button";
      btnRollback.className = "btn-turn-rollback";
      btnRollback.textContent = "退回";
      btnRollback.dataset.tooltip = `回退到第 ${block.turn} 轮之前（含对话与文件变更）`;
      btnRollback.addEventListener("click", () => rollbackToTurn(block.turn));
      header.appendChild(btnRollback);
    }
    header.appendChild(label);
    section.appendChild(header);

    for (const item of block.messages) {
      appendMessageElement(section, item);
    }

    if (block.changes.length) {
      section.appendChild(createChangeBlockElement(block.turn, block.changes, { compact: true }));
    }

    chatMessagesEl.appendChild(section);
  }

  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

/** 向 chatLog 追加一条 user/assistant 消息。 */
function pushMessage(role, text, turn = null) {
  const entry = { type: "message", role, text };
  if (turn != null) entry.turn = turn;
  chatLog.push(entry);
  renderChat();
}

/** 向 chatLog 追加一轮文件变更块。 */
function pushChangeBlock(turn, changes) {
  if (!changes || !changes.length) return;
  const normalized = changes.map(normalizeChange);
  chatLog.push({ type: "changes", turn, changes: normalized });
  renderChat();
}

/** 用 session.changes 同步 chatLog 中的变更块。 */
function syncChatLogChangesFromSession() {
  const validIds = new Set(sessionChanges.map((c) => c.id));
  chatLog = chatLog
    .map((item) => {
      if (item.type !== "changes") return item;
      const filtered = item.changes.filter((c) => validIds.has(c.id));
      if (!filtered.length) return null;
      return { ...item, changes: filtered.map((c) => {
        const fresh = sessionChanges.find((s) => s.id === c.id);
        return fresh ? { ...c, ...fresh } : c;
      }) };
    })
    .filter(Boolean);
  renderChat();
}

/** 为历史轮次重建文件变更卡片。 */
function rebuildHistoricalChangeBlocks() {
  if (chatLog.length > 0) return;
  const byTurn = new Map();
  for (const c of sessionChanges) {
    if (!byTurn.has(c.turn)) byTurn.set(c.turn, []);
    byTurn.get(c.turn).push(c);
  }
  const turns = [...byTurn.keys()].sort((a, b) => a - b);
  for (const turn of turns) {
    pushChangeBlock(turn, byTurn.get(turn));
  }
}

/** 处理回退 API 返回并刷新 UI。 */
async function handleRollbackResult(data) {
  clearDiff();
  await loadSession();
  await loadFileTree();
  const restored = data.restored_files || {};
  const paths = Object.keys(restored);
  const path =
    (data.path && paths.includes(data.path) ? data.path : null) ||
    (currentFile && paths.includes(currentFile) ? currentFile : null) ||
    paths[0];
  if (path) {
    const content = restored[path] ?? data.content ?? "";
    await openFile(path, { keepDiff: false });
    editorEl.value = content;
    fileSnapshots[path] = content;
  }
  applyContentViewFromPreference();
}

/** 请求回退到指定轮次之前。 */
async function rollbackToTurn(turn) {
  const msg =
    `确定回退到第 ${turn} 轮之前？\n` +
    `将撤销第 ${turn} 轮及之后的全部对话与文件变更，并恢复相关笔记内容。`;
  if (!confirm(msg)) return;

  const res = await fetch(`/api/session/turns/${turn}/rollback`, { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    alert("回退失败: " + (data.detail || res.statusText));
    return;
  }
  await handleRollbackResult(data);
}

/** 查看某条变更的 Diff。 */
async function viewChange(changeId) {
  const res = await fetch(`/api/session/changes/${encodeURIComponent(changeId)}`);
  if (!res.ok) {
    alert("无法加载变更记录");
    return;
  }
  const data = await res.json();
  if (!isValidWorkspacePath(data.path)) {
    alert("变更记录缺少有效文件路径");
    return;
  }
  if (!fileExistsInTree(data.path)) {
    alert(`文件已不存在于工作区：${data.path}`);
    return;
  }
  if (currentFile !== data.path) {
    await openFile(data.path, { keepDiff: true });
  }
  showDiff(data.old_content, data.new_content, changeId);
}

/** 获取当前 Session 标题。 */
function getCurrentSessionTitle() {
  const s = sessionsList.find((x) => x.id === sessionId);
  return s?.title?.trim() || "新对话";
}

/** 格式化 token 数为千分位展示。 */
function formatTokenCount(n) {
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** 精确展示 token 数（用于单轮用量脚注）。 */
function formatTokenCountExact(n) {
  return (Number(n) || 0).toLocaleString("zh-CN");
}

/** 从 usage 取上下文窗口 token（与圆环一致）。 */
function contextTokensFromUsage(usage) {
  if (!usage) return 0;
  const ctx = Number(usage.context_prompt_tokens);
  if (ctx > 0) return ctx;
  return Number(usage.prompt_tokens) || 0;
}

/** 解析 usage 中的分次模型调用列表。 */
function getUsageCallRows(usage) {
  if (!usage || typeof usage !== "object") return [];
  if (Array.isArray(usage.calls) && usage.calls.length) {
    return usage.calls.map((c, i) => ({
      index: Number(c.index) || i + 1,
      prompt: Number(c.prompt_tokens) || 0,
      completion: Number(c.completion_tokens) || 0,
      total:
        Number(c.total_tokens) ||
        (Number(c.prompt_tokens) || 0) + (Number(c.completion_tokens) || 0),
    }));
  }
  return [];
}

/** 汇总一轮 usage 的展示用数字。 */
function summarizeTurnUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const prompt = Number(usage.prompt_tokens) || 0;
  const completion = Number(usage.completion_tokens) || 0;
  const storedTotal = Number(usage.total_tokens) || 0;
  const partsSum = prompt + completion;
  const contextPeak = contextTokensFromUsage(usage);
  const calls = getUsageCallRows(usage);
  const modelCalls = calls.length || Number(usage.model_calls) || 0;

  if (partsSum <= 0 && storedTotal <= 0 && prompt <= 0) return null;

  const legacyMismatch =
    storedTotal > partsSum + 10 &&
    !usage.context_prompt_tokens &&
    !calls.length;

  let total = partsSum || storedTotal;
  if (legacyMismatch) total = storedTotal;

  return {
    prompt,
    completion,
    total,
    contextPeak,
    modelCalls,
    calls,
    legacyMismatch,
    source: usage.source || "api",
  };
}

/** 格式化单次模型调用的 token 行。 */
function formatUsageCallLine(call, { isPeak = false } = {}) {
  const peakNote = isPeak ? " · 上下文最高" : "";
  return `#${call.index}  输入 ${formatTokenCountExact(call.prompt)} + 输出 ${formatTokenCountExact(call.completion)} = ${formatTokenCountExact(call.total)}${peakNote}`;
}

/** 构造 assistant 消息底部的 token 用量条（含分次明细）。 */
function buildMessageUsageFooter(item) {
  if (item.role !== "assistant" || item._pending) return null;
  const summary = summarizeTurnUsage(item.usage);
  if (!summary) return null;

  const wrap = document.createElement("div");
  wrap.className = "msg-usage";
  wrap.setAttribute("role", "note");

  const sourceLabel =
    summary.source === "estimate" ? "字符估算" : "API 计量";

  const summaryEl = document.createElement("div");
  summaryEl.className = "msg-usage-summary";

  const parts = [
    `<span class="msg-usage-label">本轮 token</span>`,
    `<span class="msg-usage-total">合计 ${formatTokenCountExact(summary.total)}</span>`,
  ];

  if (summary.prompt > 0 || summary.completion > 0) {
    parts.push(
      `<span class="msg-usage-parts">（输入 ${formatTokenCountExact(summary.prompt)} + 输出 ${formatTokenCountExact(summary.completion)}）</span>`
    );
  }

  if (summary.modelCalls > 0) {
    parts.push(
      `<span class="msg-usage-calls-count">· ${summary.modelCalls} 次模型调用</span>`
    );
  } else if (summary.legacyMismatch) {
    parts.push(`<span class="msg-usage-calls-count">· 多次模型调用</span>`);
  }

  if (
    summary.contextPeak > 0 &&
    summary.source === "api" &&
    !summary.legacyMismatch
  ) {
    parts.push(
      `<span class="msg-usage-context">· 上下文峰值 ${formatTokenCountExact(summary.contextPeak)}</span>`
    );
  }

  parts.push(`<span class="msg-usage-source">· ${sourceLabel}</span>`);
  summaryEl.innerHTML = parts.join("");

  wrap.appendChild(summaryEl);

  if (summary.calls.length > 0) {
    const peakPrompt = Math.max(...summary.calls.map((c) => c.prompt));
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "msg-usage-toggle";
    toggle.setAttribute("aria-expanded", "false");
    toggle.textContent = `分次明细（${summary.calls.length}）`;

    const list = document.createElement("ol");
    list.className = "msg-usage-calls hidden";

    for (const call of summary.calls) {
      const li = document.createElement("li");
      li.className = "msg-usage-call";
      li.textContent = formatUsageCallLine(call, {
        isPeak: call.prompt === peakPrompt && peakPrompt > 0,
      });
      list.appendChild(li);
    }

    toggle.addEventListener("click", () => {
      const open = list.classList.toggle("hidden");
      toggle.setAttribute("aria-expanded", open ? "false" : "true");
      toggle.textContent = open
        ? `分次明细（${summary.calls.length}）`
        : `收起明细（${summary.calls.length}）`;
    });

    wrap.appendChild(toggle);
    wrap.appendChild(list);
  } else if (summary.legacyMismatch) {
    const hint = document.createElement("p");
    hint.className = "msg-usage-hint";
    hint.textContent =
      "该条为旧版统计，无分次记录；新发一轮对话后可查看每次调用的输入/输出。";
    wrap.appendChild(hint);
  }

  return wrap;
}

/** 更新底栏上下文占用圆环。 */
function updateContextRing(ctx) {
  if (!sessionContextRingEl) return;
  const progress = sessionContextRingEl.querySelector(".context-ring-progress");
  if (!ctx?.limit_tokens || !progress) {
    sessionContextRingEl.classList.add("hidden");
    delete sessionContextRingEl.dataset.tooltip;
    return;
  }

  const pct = Math.min(100, Math.max(0, Number(ctx.percent) || 0));
  const filled = (CONTEXT_RING_C * pct) / 100;
  progress.setAttribute("stroke-dasharray", `${filled} ${CONTEXT_RING_C}`);

  const used = formatTokenCount(ctx.used_tokens);
  const limit = formatTokenCount(ctx.limit_tokens);
  const sourceNote =
    ctx.used_tokens === 0
      ? ""
      : ctx.is_estimate
        ? " · 字符估算"
        : ctx.source === "api"
          ? " · API 计量"
          : "";
  const modelNote = ctx.model ? ` · ${ctx.model}` : "";

  sessionContextRingEl.dataset.tooltip =
    ctx.used_tokens === 0
      ? `尚未占用上下文 · 发送首条消息后显示${modelNote}`
      : `${pct}% 上下文已用 · ${used} / ${limit} tokens${sourceNote}${modelNote}`;
  sessionContextRingEl.dataset.tooltipPlacement = "above";

  sessionContextRingEl.setAttribute(
    "aria-label",
    `上下文已用 ${pct}%，约 ${used} / ${limit} tokens`
  );
  sessionContextRingEl.classList.remove("hidden", "ctx-warn", "ctx-critical");
  if (pct >= 95) sessionContextRingEl.classList.add("ctx-critical");
  else if (pct >= 80) sessionContextRingEl.classList.add("ctx-warn");
}

/** 更新 Session 元信息与上下文圆环。 */
function updateSessionMeta(_sessions, _activeId, contextUsage) {
  if (contextUsage) updateContextRing(contextUsage);
}

/** 获取当前选中的模型 id。 */
function getSelectedModelId() {
  if (composerModelId) return composerModelId;
  try {
    return (
      readStorageItem(MODEL_STORAGE_KEY) || defaultModelId
    );
  } catch {
    return defaultModelId;
  }
}

/** 设置输入区模型并可选持久化。 */
function setComposerModelId(modelId, { persist = true } = {}) {
  const id = modelId || defaultModelId;
  composerModelId = id;
  if (persist) {
    try {
      localStorage.setItem(MODEL_STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }
  const spec = modelsCatalog.find((m) => m.id === id);
  if (modelPickerLabel) {
    modelPickerLabel.textContent = spec?.label || id;
  }
  if (modelPickerMenu) {
    modelPickerMenu.querySelectorAll(".model-picker-option").forEach((el) => {
      const selected = el.dataset.id === id;
      el.setAttribute("aria-selected", selected ? "true" : "false");
    });
  }
  syncThinkingToggleForModel(id);
}

/** 打开或关闭模型选择下拉。 */
function setModelPickerOpen(open) {
  if (!modelPickerEl || !modelPickerTrigger || !modelPickerMenu) return;
  const isOpen = Boolean(open);
  if (isOpen) hideAppTooltip();
  modelPickerEl.classList.toggle("is-open", isOpen);
  modelPickerTrigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
  modelPickerMenu.classList.toggle("hidden", !isOpen);
}

/** 切换模型选择下拉显示状态。 */
function toggleModelPicker() {
  setModelPickerOpen(!modelPickerEl?.classList.contains("is-open"));
}

/** 读取是否开启思考模式。 */
function isThinkingEnabled() {
  if (thinkingToggleEl) return thinkingToggleEl.checked;
  try {
    return readStorageItem(THINKING_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** 按模型能力同步思考开关可用状态。 */
function syncThinkingToggleForModel(modelId) {
  if (!thinkingToggleEl || !modelPickerEl) return;
  const spec = modelsCatalog.find((m) => m.id === modelId);
  const supported = spec?.supports_thinking !== false;
  thinkingToggleEl.disabled = !supported;
  if (!supported) thinkingToggleEl.checked = false;
}

/** 从 API 刷新当前 Session 上下文占用。 */
async function refreshContextUsage() {
  const modelId = getSelectedModelId();
  const res = await fetch(
    `/api/session/context-usage?model_id=${encodeURIComponent(modelId)}`
  );
  if (!res.ok) return;
  const ctx = await res.json();
  updateContextRing(ctx);
}

/** 用 chat done 事件中的 usage 更新圆环。 */
function applyContextUsageFromDone(usage) {
  const used = contextTokensFromUsage(usage);
  if (!used) {
    refreshContextUsage();
    return;
  }
  const modelId = getSelectedModelId();
  const spec = modelsCatalog.find((m) => m.id === modelId);
  const limit = spec?.context_limit || used * 2;
  const pct = Math.min(100, Math.round((used / limit) * 1000) / 10);
  updateContextRing({
    used_tokens: used,
    limit_tokens: limit,
    percent: pct,
    model: spec?.label || modelId,
    model_id: modelId,
    source: usage.source || "api",
    is_estimate: usage.source === "estimate",
  });
}

/** 加载可选模型列表。 */
async function loadModelsCatalog() {
  const res = await fetch("/api/models");
  if (!res.ok) return;
  const data = await res.json();
  modelsCatalog = data.models || [];
  defaultModelId = data.default_model_id || defaultModelId;

  let saved = defaultModelId;
  try {
    saved =
      readStorageItem(MODEL_STORAGE_KEY) || defaultModelId;
  } catch {
    /* ignore */
  }
  if (!modelsCatalog.some((m) => m.id === saved)) saved = defaultModelId;

  if (modelPickerMenu) {
    modelPickerMenu.innerHTML = "";
    for (const m of modelsCatalog) {
      const li = document.createElement("li");
      li.className = "model-picker-option";
      li.setAttribute("role", "option");
      li.dataset.id = m.id;
      li.textContent = m.label || m.id;
      li.addEventListener("click", (e) => {
        e.stopPropagation();
        setComposerModelId(m.id);
        setModelPickerOpen(false);
        refreshContextUsage();
      });
      modelPickerMenu.appendChild(li);
    }
  }

  setComposerModelId(saved, { persist: false });
}

/** 初始化输入区模型与思考偏好。 */
function initComposerPrefs() {
  if (!thinkingToggleEl) return;

  try {
    thinkingToggleEl.checked =
      readStorageItem(THINKING_STORAGE_KEY) === "1";
  } catch {
    thinkingToggleEl.checked = false;
  }

  if (modelPickerTrigger) {
    modelPickerTrigger.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleModelPicker();
    });
  }

  document.addEventListener("click", (e) => {
    if (!modelPickerEl?.classList.contains("is-open")) return;
    if (modelPickerEl.contains(e.target)) return;
    setModelPickerOpen(false);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setModelPickerOpen(false);
  });

  thinkingToggleEl.addEventListener("change", () => {
    try {
      localStorage.setItem(
        THINKING_STORAGE_KEY,
        thinkingToggleEl.checked ? "1" : "0"
      );
    } catch {
      /* ignore */
    }
  });
}

/** 格式化 Session 标题展示。 */
function formatSessionTitle(s) {
  return (s?.title || "").trim() || "新对话";
}

/** 从 localStorage 恢复已打开文件标签。 */
function loadOpenTabs() {
  try {
    const raw = readStorageItem(TABS_STORAGE_KEY);
    openTabIds = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(openTabIds)) openTabIds = [];
  } catch {
    openTabIds = [];
  }
}

/** 将已打开文件标签写入 localStorage。 */
function saveOpenTabs() {
  try {
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(openTabIds));
  } catch {
    /* ignore */
  }
}

/** 确保某文件在标签栏中打开。 */
function ensureTabOpen(id) {
  if (!id || openTabIds.includes(id)) return;
  openTabIds.push(id);
  saveOpenTabs();
}

/** 移除已不存在的文件标签。 */
function pruneOpenTabs() {
  const valid = new Set((sessionsList || []).map((s) => s.id));
  openTabIds = openTabIds.filter((id) => valid.has(id));
  if (sessionId && !openTabIds.includes(sessionId)) {
    openTabIds.push(sessionId);
  }
  if (!openTabIds.length && sessionId) openTabIds.push(sessionId);
  saveOpenTabs();
}

/** 关闭文件标签并切换活动文件。 */
function closeTab(id, ev) {
  ev?.stopPropagation();
  ev?.preventDefault();
  const idx = openTabIds.indexOf(id);
  if (idx < 0) return;
  openTabIds.splice(idx, 1);
  if (!openTabIds.length && sessionId) {
    openTabIds.push(sessionId);
  }
  saveOpenTabs();
  if (id === sessionId) {
    const next = openTabIds[Math.min(idx, openTabIds.length - 1)] || openTabIds[0];
    if (next && next !== sessionId) activateSession(next);
    else renderSessionTabs();
  } else {
    renderSessionTabs();
  }
}

/** 格式化 Session 创建时间为展示文案。 */
function formatSessionDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/** 隐藏全局悬浮提示。 */
function hideAppTooltip() {
  if (!appTooltipEl) return;
  appTooltipEl.classList.add("hidden");
  appTooltipEl.setAttribute("aria-hidden", "true");
  if (appTooltipAnchor) {
    appTooltipAnchor.removeAttribute("aria-describedby");
    appTooltipAnchor = null;
  }
}

/** 根据锚点元素定位悬浮提示。 */
function layoutAppTooltip(anchor, placement) {
  if (!appTooltipEl || !anchor) return;
  const gap = 8;
  const margin = 8;
  const rect = anchor.getBoundingClientRect();
  appTooltipEl.classList.remove("app-tooltip-above", "app-tooltip-below");
  appTooltipEl.classList.add(placement === "above" ? "app-tooltip-above" : "app-tooltip-below");
  appTooltipEl.classList.remove("hidden");
  const tipRect = appTooltipEl.getBoundingClientRect();
  let left = rect.left + (rect.width - tipRect.width) / 2;
  let top =
    placement === "above" ? rect.top - gap - tipRect.height : rect.bottom + gap;
  left = Math.max(margin, Math.min(left, window.innerWidth - tipRect.width - margin));
  top = Math.max(margin, Math.min(top, window.innerHeight - tipRect.height - margin));
  appTooltipEl.style.left = `${Math.round(left)}px`;
  appTooltipEl.style.top = `${Math.round(top)}px`;
  const anchorCenterX = rect.left + rect.width / 2;
  appTooltipEl.style.setProperty("--arrow-x", `${Math.round(anchorCenterX - left)}px`);
}

/** 在锚点旁显示悬浮提示。 */
function showAppTooltip(anchor, text, placement = "below") {
  if (!appTooltipEl || !anchor || !text) return;
  if (modelPickerEl?.classList.contains("is-open") && modelPickerEl.contains(anchor)) return;
  hideAppTooltip();
  appTooltipAnchor = anchor;
  appTooltipEl.textContent = text;
  appTooltipEl.setAttribute("aria-hidden", "false");
  layoutAppTooltip(anchor, placement);
  anchor.setAttribute("aria-describedby", "app-tooltip");
}

/** 从事件目标解析 tooltip 宿主元素。 */
function tooltipHostFromTarget(target) {
  if (!target?.closest) return null;
  return target.closest("[data-tooltip]");
}

/** 将原生 title 迁移为自定义 tooltip。 */
function migrateNativeTitles(root = document) {
  root.querySelectorAll("[title]").forEach((el) => {
    const native = el.getAttribute("title")?.trim();
    if (!native) return;
    if (!el.dataset.tooltip) el.dataset.tooltip = native;
    el.removeAttribute("title");
  });
}

/** 初始化全局 tooltip 行为。 */
function initAppTooltip() {
  if (!appTooltipEl) return;
  migrateNativeTitles();

  document.addEventListener("mouseover", (e) => {
    const host = tooltipHostFromTarget(e.target);
    if (!host?.dataset.tooltip || host.contains(e.relatedTarget)) return;
    const placement = host.dataset.tooltipPlacement || "below";
    showAppTooltip(host, host.dataset.tooltip, placement);
  });

  document.addEventListener("mouseout", (e) => {
    const host = tooltipHostFromTarget(e.target);
    if (!host) return;
    const rel = e.relatedTarget;
    if (rel && host.contains(rel)) return;
    if (appTooltipAnchor === host) hideAppTooltip();
  });

  document.addEventListener("focusin", (e) => {
    const host = tooltipHostFromTarget(e.target);
    if (!host?.dataset.tooltip) return;
    showAppTooltip(host, host.dataset.tooltip, host.dataset.tooltipPlacement || "below");
  });

  document.addEventListener("focusout", (e) => {
    const host = tooltipHostFromTarget(e.target);
    if (host && appTooltipAnchor === host) hideAppTooltip();
  });

  window.addEventListener("scroll", hideAppTooltip, { passive: true, capture: true });
  window.addEventListener("resize", hideAppTooltip);
}

/** 渲染顶栏 Session 标签。 */
function renderSessionTabs() {
  if (!sessionTabsEl) return;
  hideAppTooltip();
  sessionTabsEl.innerHTML = "";
  const active = sessionId;
  for (const id of openTabIds) {
    const s = sessionsList.find((x) => x.id === id);
    if (!s) continue;
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "session-tab" + (id === active ? " active" : "");
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", id === active ? "true" : "false");
    tab.dataset.id = id;
    tab.setAttribute("aria-label", formatSessionTitle(s));

    const title = document.createElement("span");
    title.className = "session-tab-title";
    title.textContent = formatSessionTitle(s);

    if (s.change_count > 0) {
      const badge = document.createElement("span");
      badge.className = "session-tab-badge";
      badge.textContent = String(s.change_count);
      badge.dataset.tooltip = `${s.change_count} 条文件变更`;
      tab.appendChild(title);
      tab.appendChild(badge);
    } else {
      tab.appendChild(title);
    }

    const closeBtn = document.createElement("span");
    closeBtn.className = "session-tab-close";
    closeBtn.setAttribute("role", "button");
    closeBtn.setAttribute("aria-label", "关闭标签");
    closeBtn.textContent = "×";

    tab.appendChild(closeBtn);

    tab.addEventListener("click", () => {
      if (id !== sessionId) activateSession(id);
    });
    closeBtn.addEventListener("click", (e) => closeTab(id, e));

    sessionTabsEl.appendChild(tab);
  }
}

/** 渲染历史 Session 侧栏列表。 */
function renderHistoryList() {
  if (!sessionHistoryListEl) return;
  sessionHistoryListEl.innerHTML = "";
  const items = [...(sessionsList || [])].sort((a, b) =>
    (b.created_at || "").localeCompare(a.created_at || "")
  );
  for (const s of items) {
    const li = document.createElement("li");
    li.className = "session-history-item" + (s.id === sessionId ? " active" : "");
    li.dataset.id = s.id;

    const titleEl = document.createElement("div");
    titleEl.className = "session-history-title";
    titleEl.textContent = formatSessionTitle(s);

    const meta = document.createElement("div");
    meta.className = "session-history-meta";
    const parts = [];
    if (s.turn) parts.push(`${s.turn} 轮`);
    const when = formatSessionDate(s.created_at);
    if (when) parts.push(when);
    meta.textContent = parts.join(" · ") || s.id;

    const main = document.createElement("button");
    main.type = "button";
    main.className = "session-history-main";
    main.appendChild(titleEl);
    main.appendChild(meta);
    main.addEventListener("click", () => selectSessionFromHistory(s.id));

    const actions = document.createElement("div");
    actions.className = "session-history-actions";

    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "session-history-action icon-btn";
    renameBtn.dataset.tooltip = "重命名";
    renameBtn.setAttribute("aria-label", "重命名对话");
    renameBtn.textContent = "✎";
    renameBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      renameSession(s.id);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "session-history-action session-history-delete icon-btn";
    deleteBtn.dataset.tooltip = "删除对话";
    deleteBtn.setAttribute("aria-label", "删除对话");
    deleteBtn.textContent = "×";
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteSession(s.id);
    });

    actions.appendChild(renameBtn);
    actions.appendChild(deleteBtn);

    li.appendChild(main);
    li.appendChild(actions);
    sessionHistoryListEl.appendChild(li);
  }
}

/** 从历史列表切换 Session。 */
async function selectSessionFromHistory(id) {
  ensureTabOpen(id);
  if (id !== sessionId) await activateSession(id);
  else syncSessionsUI();
}

/** 删除指定 Session。 */
async function deleteSession(targetId) {
  const res = await fetch(`/api/session/${encodeURIComponent(targetId)}`, {
    method: "DELETE",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    alert("删除失败: " + (data.detail || res.statusText));
    return;
  }

  openTabIds = openTabIds.filter((id) => id !== targetId);
  saveOpenTabs();

  clearDiff();
  applySessionPayload(data);
  await loadFileTree();
  await reopenCurrentFileAfterTreeLoad();
}

/** 重命名指定 Session。 */
async function renameSession(targetId) {
  const s = sessionsList.find((x) => x.id === targetId);
  const current = formatSessionTitle(s);
  const next = prompt("会话名称", current);
  if (next == null) return;
  const title = next.trim();
  if (!title) {
    alert("标题不能为空");
    return;
  }
  const res = await fetch(`/api/session/${encodeURIComponent(targetId)}/title`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    alert("重命名失败: " + (data.detail || res.statusText));
    return;
  }
  if (data.sessions) {
    applySessionsList(data.sessions, data.active_id || sessionId);
  } else {
    await loadSession();
  }
}

/** 打开或关闭历史侧栏。 */
function setHistoryPanelOpen(open) {
  historyPanelOpen = Boolean(open);
  if (!layoutEl) return;

  layoutEl.classList.toggle("history-open", historyPanelOpen);
  if (panelHistoryEl) panelHistoryEl.classList.toggle("hidden", !historyPanelOpen);
  if (resizeHandleHistory) {
    resizeHandleHistory.classList.toggle("hidden", !historyPanelOpen);
  }
  if (btnSessionHistory) {
    btnSessionHistory.classList.toggle("active", historyPanelOpen);
    btnSessionHistory.setAttribute("aria-pressed", historyPanelOpen ? "true" : "false");
  }

  if (historyPanelOpen) {
    let w = readCssPx(layoutEl, "--col-history", 300);
    if (w < 200) w = 300;
    layoutEl.style.setProperty("--col-history", `${Math.round(w)}px`);
  } else {
    layoutEl.style.setProperty("--col-history", "0px");
  }

  try {
    localStorage.setItem(HISTORY_OPEN_STORAGE_KEY, historyPanelOpen ? "1" : "0");
  } catch {
    /* ignore */
  }

  renderHistoryList();
  clampLayoutWidths();
}

/** 切换历史侧栏显示。 */
function toggleHistoryPanel() {
  setHistoryPanelOpen(!historyPanelOpen);
}

/** 应用 sessions 列表与激活 id 到 UI。 */
function applySessionsList(sessions, activeId, contextUsage) {
  sessionsList = sessions || [];
  const active = activeId || sessionId;
  pruneOpenTabs();
  ensureTabOpen(active);
  renderSessionTabs();
  renderHistoryList();
  updateSessionMeta(sessionsList, active, contextUsage);
}

/** 同步 Session 相关 UI 组件。 */
function syncSessionsUI() {
  applySessionsList(sessionsList, sessionId);
}

/** 切换 Session 后同步 Diff 状态。 */
function syncDiffWithSession() {
  if (!currentDiff?.changeId) return;
  const stillExists = sessionChanges.some((c) => c.id === currentDiff.changeId);
  if (!stillExists) {
    clearDiff();
    if (currentFile) applyContentViewFromPreference();
  }
}

/** 应用 /api/session 返回的会话数据。 */
function applySessionPayload(data) {
  sessionId = data.id || data.session_id;
  sessionTurn = Number(data.turn) || 0;
  sessionChanges = data.changes || [];
  if (Array.isArray(data.chat_log)) {
    chatLog = data.chat_log;
    sessionTurn = Math.max(sessionTurn, maxTurnFromChatLog(chatLog));
    renderChat();
  } else {
    chatLog = [];
    renderChat();
  }
  syncDiffWithSession();
  if (data.sessions) {
    applySessionsList(data.sessions, data.active_id || sessionId);
  } else {
    syncSessionsUI();
  }
  refreshContextUsage();
}

/** 加载当前激活 Session。 */
async function loadSession() {
  const res = await fetch("/api/session");
  if (!res.ok) return;
  const data = await res.json();
  applySessionPayload(data);
}

/** 激活指定 Session 并刷新界面。 */
async function activateSession(targetId) {
  if (!targetId || targetId === sessionId) {
    ensureTabOpen(targetId);
    syncSessionsUI();
    return;
  }
  ensureTabOpen(targetId);
  const res = await fetch(`/api/session/${encodeURIComponent(targetId)}/activate`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert("切换 Session 失败: " + (err.detail || res.statusText));
    return;
  }
  const data = await res.json();
  clearDiff();
  applySessionPayload(data);
  await loadFileTree();
  await reopenCurrentFileAfterTreeLoad();
}

/** 文件树加载后尝试重新打开当前文件，否则打开第一个文件。 */
async function reopenCurrentFileAfterTreeLoad() {
  reconcileEditorWithFileTree();
  if (currentFile && fileExistsInTree(currentFile)) {
    await openFile(currentFile, { keepDiff: false });
    return;
  }
  const firstFile = fileTreeEl?.querySelector("li.file-tree-file");
  if (firstFile?.dataset.path) {
    await openFile(firstFile.dataset.path, { silent: true });
  }
}

/** 新建 Session 并切换过去。 */
async function newSession() {
  const res = await fetch("/api/session/new", { method: "POST" });
  if (!res.ok) {
    alert("新建 Session 失败");
    return;
  }
  clearDiff();
  await loadSession();
}

/** 规范化工作区相对路径。 */
function normalizeWorkspacePath(raw) {
  return String(raw || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
}

/** 在文件树中展开并滚动到指定文件。 */
function revealFileInTree(path) {
  if (!fileTreeEl || !path) return;
  const fileLi = [...fileTreeEl.querySelectorAll(".file-tree-file")].find(
    (li) => li.dataset.path === path
  );
  if (!fileLi) return;
  let dir = fileLi.closest(".file-tree-dir");
  while (dir) {
    dir.classList.remove("collapsed");
    dir.setAttribute("aria-expanded", "true");
    const parentItem = dir.parentElement?.closest(".file-tree-dir");
    dir = parentItem || null;
  }
}

/** 高亮文件树中的当前文件。 */
function highlightFileInTree(path) {
  document.querySelectorAll(".file-tree-file").forEach((li) => {
    li.classList.toggle("active", li.dataset.path === path);
  });
}

const FILE_TREE_INDENT_PX = 16;

/**
 * 构建文件树一行。
 * 文件夹：缩进 + ▸ + 图标 + 名称
 * 文件：缩进 + 标记（·，占 ▸ 列，无空白箭头槽）+ 名称 —— 与同级文件夹左缘对齐
 */
function buildFileTreeRow(depth, { isDir, icon, name }) {
  const row = document.createElement("div");
  row.className = isDir ? "file-tree-row file-tree-row--dir" : "file-tree-row file-tree-row--file";

  const indent = document.createElement("span");
  indent.className = "file-tree-indent";
  indent.setAttribute("aria-hidden", "true");
  if (depth > 0) indent.style.width = `${depth * FILE_TREE_INDENT_PX}px`;
  row.appendChild(indent);

  if (isDir) {
    const chevronEl = document.createElement("span");
    chevronEl.className = "file-tree-chevron";
    chevronEl.setAttribute("aria-hidden", "true");
    chevronEl.textContent = "▸";
    row.appendChild(chevronEl);

    const iconEl = document.createElement("span");
    iconEl.className = "file-tree-icon";
    iconEl.setAttribute("aria-hidden", "true");
    iconEl.textContent = icon;
    row.appendChild(iconEl);
  } else {
    const lead = document.createElement("span");
    lead.className = "file-tree-lead";
    lead.setAttribute("aria-hidden", "true");
    lead.textContent = icon;
    row.appendChild(lead);
  }

  const nameEl = document.createElement("span");
  nameEl.className = "file-tree-name";
  nameEl.textContent = name;
  row.appendChild(nameEl);

  return row;
}

/** 递归渲染文件树节点 DOM；depth 为层级（0 = workspace 根）。 */
function renderFileTreeNodes(nodes, parentEl, depth = 0) {
  for (const node of nodes || []) {
    const li = document.createElement("li");

    if (node.type === "dir") {
      li.className = "file-tree-item file-tree-dir collapsed";
      li.dataset.path = node.path || "";
      li.setAttribute("role", "treeitem");
      li.setAttribute("aria-expanded", "false");
      const row = buildFileTreeRow(depth, {
        isDir: true,
        icon: "▤",
        name: node.name,
      });
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        const collapsed = li.classList.toggle("collapsed");
        li.setAttribute("aria-expanded", collapsed ? "false" : "true");
      });
      const childUl = document.createElement("ul");
      childUl.className = "file-tree-children";
      childUl.setAttribute("role", "group");
      renderFileTreeNodes(node.children || [], childUl, depth + 1);
      li.appendChild(row);
      li.appendChild(childUl);
    } else {
      li.className = "file-tree-item file-tree-file";
      li.setAttribute("role", "treeitem");
      li.dataset.path = node.path;
      if (node.path === currentFile) li.classList.add("active");
      const row = buildFileTreeRow(depth, {
        isDir: false,
        icon: "·",
        name: node.name,
      });
      row.addEventListener("click", () => openFile(node.path));
      li.appendChild(row);
    }
    parentEl.appendChild(li);
  }
}

/** 从 API 加载并渲染工作区文件树。 */
async function loadFileTree() {
  if (!fileTreeEl) return;
  const res = await fetch("/api/files");
  if (!res.ok) return;
  const data = await res.json();
  fileTreeEl.innerHTML = "";
  const tree = data.tree || [];
  if (!tree.length) {
    const empty = document.createElement("li");
    empty.className = "file-tree-empty";
    empty.textContent = "暂无文件。点击 + 新建笔记，或 ▤ 新建文件夹。";
    fileTreeEl.appendChild(empty);
    return;
  }
  renderFileTreeNodes(tree, fileTreeEl);
  reconcileEditorWithFileTree();
  if (currentFile && fileExistsInTree(currentFile)) {
    highlightFileInTree(currentFile);
    revealFileInTree(currentFile);
  }
}

/** 将用户输入的路径与父目录合并为工作区相对路径。 */
function resolveWorkspaceRelativePath(input, baseDir) {
  let path = normalizeWorkspacePath(input);
  if (!path) return "";
  const base = normalizeWorkspacePath(baseDir);
  if (base && !path.includes("/")) path = `${base}/${path}`;
  return path;
}

/** 从右键目标解析：父目录、选中路径、类型（file/dir/null）。 */
function resolveFileTreeContextTarget(target) {
  const item = target?.closest?.(".file-tree-item");
  if (!item) return { baseDir: "", path: "", type: null };
  if (item.classList.contains("file-tree-file")) {
    const path = item.dataset.path || "";
    const slash = path.lastIndexOf("/");
    return {
      baseDir: slash >= 0 ? path.slice(0, slash) : "",
      path,
      type: "file",
    };
  }
  if (item.classList.contains("file-tree-dir")) {
    const path = item.dataset.path || "";
    return { baseDir: path, path, type: "dir" };
  }
  return { baseDir: "", path: "", type: null };
}

/** 在工作区新建文件；baseDir 为可选父目录（右键菜单传入）。 */
async function createWorkspaceFile(baseDir = "") {
  const suggested = baseDir
    ? `${normalizeWorkspacePath(baseDir)}/新笔记.md`
    : "新笔记.md";
  const raw = window.prompt(
    "新建文件路径（相对 workspace）\n例如：2025-05-20.md 或 notes/日记.md",
    suggested
  );
  if (raw == null) return;
  let path = resolveWorkspaceRelativePath(raw, baseDir);
  if (!path) return;
  const base = path.split("/").pop() || "";
  if (!/\.\w+$/.test(base)) path += ".md";

  const res = await fetch("/api/files/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content: "" }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    alert("新建文件失败: " + (data.detail || res.statusText));
    return;
  }
  await loadFileTree();
  await openFile(data.path || path);
}

/** 在工作区新建文件夹；baseDir 为可选父目录（右键菜单传入）。 */
async function createWorkspaceFolder(baseDir = "") {
  const suggested = baseDir
    ? `${normalizeWorkspacePath(baseDir)}/新建文件夹`
    : "新建文件夹";
  const raw = window.prompt(
    "新建文件夹路径（相对 workspace）\n例如：notes 或 notes/周报",
    suggested
  );
  if (raw == null) return;
  const path = resolveWorkspaceRelativePath(raw, baseDir);
  if (!path) return;

  const res = await fetch("/api/files/mkdir", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    alert("新建文件夹失败: " + (data.detail || res.statusText));
    return;
  }
  await loadFileTree();
  revealFileInTree(data.path || path);
}

/** 删除工作区文件或文件夹。 */
async function deleteWorkspaceItem(path, type) {
  if (!path) return;
  const label = type === "dir" ? "文件夹" : "文件";
  const msg =
    type === "dir"
      ? `确定删除文件夹「${path}」及其全部内容？\n此操作不可撤销。`
      : `确定删除文件「${path}」？\n此操作不可撤销。`;
  if (!window.confirm(msg)) return;

  const res = await fetch(`/api/files/${encodeURIComponent(path)}`, {
    method: "DELETE",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    alert(`删除${label}失败: ` + (data.detail || res.statusText));
    return;
  }

  const deleted = data.path || path;
  if (
    currentFile === deleted ||
    (type === "dir" &&
      currentFile &&
      (currentFile === deleted || currentFile.startsWith(deleted + "/")))
  ) {
    clearEditorSelection();
  }
  await loadFileTree();
}

/** 重命名工作区文件或文件夹。 */
async function renameWorkspaceItem(path) {
  if (!path) return;
  const oldName = path.split("/").pop() || path;
  const parentDir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const newName = window.prompt(`重命名「${oldName}」`, oldName);
  if (!newName || newName === oldName) return;

  // 如果旧名有扩展名但新名没有，自动补上
  const oldDot = oldName.lastIndexOf(".");
  let finalName = newName;
  if (oldDot >= 0 && newName.lastIndexOf(".") <= 0) {
    finalName = newName + oldName.slice(oldDot);
  }

  const dest = parentDir ? `${parentDir}/${finalName}` : finalName;
  try {
    const res = await fetch("/api/files/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: path, destination: dest }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert("重命名失败: " + (data.detail || res.statusText));
      return;
    }
    const newPath = data.path || dest;
    if (currentFile === path) {
      currentFile = newPath;
      currentFileLabel.textContent = newPath;
    }
    await loadFileTree();
    revealFileInTree(newPath);
  } catch (err) {
    alert("重命名失败: " + (err.message || err));
  }
}

/** 初始化左侧文件面板交互。 */
function initFilePanel() {
  btnNewFile?.addEventListener("click", () => createWorkspaceFile());
  btnNewFolder?.addEventListener("click", () => createWorkspaceFolder());
}

let fileContextBaseDir = "";
let fileContextTargetPath = "";
let fileContextTargetType = null;

// 文件剪贴板（内存中，仅在当前页面会话有效）
let fileClipboard = null; // { source: string, type: 'copy'|'cut' }

/** 关闭文件树右键菜单。 */
function hideFileContextMenu() {
  fileContextMenuEl?.classList.add("hidden");
}

/** 在光标处显示文件树右键菜单。 */
function showFileContextMenu(clientX, clientY, ctx) {
  if (!fileContextMenuEl) return;
  fileContextBaseDir = ctx.baseDir || "";
  fileContextTargetPath = ctx.path || "";
  fileContextTargetType = ctx.type || null;

  const onTarget = Boolean(fileContextTargetPath);
  fileContextMenuEl.dataset.mode = onTarget ? "target" : "blank";

  const targetSection = fileContextMenuEl.querySelector(
    '[data-menu-section="target"]'
  );
  if (targetSection) targetSection.hidden = !onTarget;

  // 剪贴板粘贴：仅在剪贴板有内容时可用
  const pasteBtn = fileContextMenuEl.querySelector('[data-action="paste-file"]');
  if (pasteBtn) pasteBtn.disabled = !fileClipboard;

  const deleteBtn = fileContextMenuEl.querySelector('[data-action="delete"]');
  if (deleteBtn && onTarget) {
    deleteBtn.textContent =
      fileContextTargetType === "dir" ? "删除文件夹…" : "删除文件…";
  }

  fileContextMenuEl.classList.remove("hidden");
  const pad = 8;
  const rect = fileContextMenuEl.getBoundingClientRect();
  let x = clientX;
  let y = clientY;
  if (x + rect.width > window.innerWidth - pad) {
    x = Math.max(pad, window.innerWidth - rect.width - pad);
  }
  if (y + rect.height > window.innerHeight - pad) {
    y = Math.max(pad, window.innerHeight - rect.height - pad);
  }
  fileContextMenuEl.style.left = `${x}px`;
  fileContextMenuEl.style.top = `${y}px`;
}

/** 将文件路径放入剪贴板（复制模式）。 */
function copyFileToClipboard(path) {
  if (!path) return;
  fileClipboard = { source: path, type: "copy" };
}

/** 将文件路径放入剪贴板（剪切模式）。 */
function cutFileToClipboard(path) {
  if (!path) return;
  fileClipboard = { source: path, type: "cut" };
}

/** 收集文件树中所有文件路径。 */
function collectFileTreePaths() {
  if (!fileTreeEl) return [];
  return [...fileTreeEl.querySelectorAll(".file-tree-file")].map(
    (li) => li.dataset.path || ""
  );
}

/** 为粘贴操作生成不冲突的目标路径。 */
function generatePasteDest(source, destDir, opType) {
  const sourceName = source.split("/").pop() || source;
  const baseDir = destDir ? normalizeWorkspacePath(destDir) : "";
  const existingPaths = collectFileTreePaths();

  const dotIdx = sourceName.lastIndexOf(".");
  const stem = dotIdx >= 0 ? sourceName.slice(0, dotIdx) : sourceName;
  const ext = dotIdx >= 0 ? sourceName.slice(dotIdx) : "";

  function build(candidateName) {
    return baseDir ? `${baseDir}/${candidateName}` : candidateName;
  }

  // 剪切：优先使用原名，仅冲突时才加后缀
  if (opType === "cut") {
    const original = build(sourceName);
    if (!existingPaths.includes(original) && original !== source) {
      return original;
    }
  }

  // 复制 / 剪切冲突：逐次生成副本名
  let suffix = ` - 副本${ext}`;
  let counter = 2;
  while (true) {
    const candidate = build(`${stem}${suffix}`);
    if (!existingPaths.includes(candidate) && candidate !== source) {
      return candidate;
    }
    suffix = ` - 副本 (${counter})${ext}`;
    counter++;
  }
}

/** 从剪贴板粘贴文件到目标目录。 */
async function pasteFileFromClipboard(destDir) {
  if (!fileClipboard) return;
  const { source, type } = fileClipboard;

  const opLabel = type === "cut" ? "移动" : "复制";
  const endpoint = type === "cut" ? "/api/files/move" : "/api/files/copy";
  const dest = generatePasteDest(source, destDir, type);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, destination: dest }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(`${opLabel}失败: ` + (data.detail || res.statusText));
      return;
    }
    if (type === "cut") fileClipboard = null;
    await loadFileTree();
    revealFileInTree(data.path || dest);
  } catch (err) {
    alert(`${opLabel}失败: ` + (err.message || err));
  }
}

// ---- 文本右键菜单 ----

let textContextTargetEl = null;

/** 关闭文本右键菜单。 */
function hideTextContextMenu() {
  textContextMenuEl?.classList.add("hidden");
  textContextTargetEl = null;
}

/** 在光标处显示文本右键菜单。 */
function showTextContextMenu(clientX, clientY, targetEl) {
  if (!textContextMenuEl) return;
  textContextTargetEl = targetEl || null;

  const isEditable =
    targetEl &&
    (targetEl.tagName === "TEXTAREA" ||
     targetEl.tagName === "INPUT" ||
     targetEl.isContentEditable);

  const hasSelection = isEditable
    ? (targetEl.selectionStart !== undefined
        ? targetEl.selectionStart !== targetEl.selectionEnd
        : window.getSelection().toString().length > 0)
    : window.getSelection().toString().length > 0;

  const copyBtn = textContextMenuEl.querySelector('[data-action="text-copy"]');
  const cutBtn = textContextMenuEl.querySelector('[data-action="text-cut"]');
  const pasteBtn = textContextMenuEl.querySelector('[data-action="text-paste"]');
  if (copyBtn) copyBtn.disabled = !hasSelection;
  if (cutBtn) cutBtn.disabled = !hasSelection || !isEditable;
  if (pasteBtn) pasteBtn.disabled = !isEditable;

  textContextMenuEl.classList.remove("hidden");
  const pad = 8;
  const rect = textContextMenuEl.getBoundingClientRect();
  let x = clientX;
  let y = clientY;
  if (x + rect.width > window.innerWidth - pad) {
    x = Math.max(pad, window.innerWidth - rect.width - pad);
  }
  if (y + rect.height > window.innerHeight - pad) {
    y = Math.max(pad, window.innerHeight - rect.height - pad);
  }
  textContextMenuEl.style.left = `${x}px`;
  textContextMenuEl.style.top = `${y}px`;
}

/** 执行文本复制。 */
function execTextCopy(el) {
  if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start !== end) {
      navigator.clipboard.writeText(el.value.substring(start, end)).catch(() => {
        document.execCommand("copy");
      });
    }
  } else {
    const sel = window.getSelection();
    if (sel.toString()) {
      navigator.clipboard.writeText(sel.toString()).catch(() => {
        document.execCommand("copy");
      });
    }
  }
}

/** 执行文本剪切。 */
function execTextCut(el) {
  if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start !== end) {
      navigator.clipboard.writeText(el.value.substring(start, end)).then(() => {
        el.setRangeText("", start, end, "end");
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }).catch(() => {
        document.execCommand("cut");
      });
    }
  } else if (el && el.isContentEditable) {
    navigator.clipboard.writeText(window.getSelection().toString()).then(() => {
      document.execCommand("delete");
    }).catch(() => {
      document.execCommand("cut");
    });
  }
}

/** 执行文本粘贴。 */
function execTextPaste(el) {
  if (!el) return;
  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
    el.focus();
    navigator.clipboard.readText().then((text) => {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      el.setRangeText(text, start, end, "end");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }).catch(() => {
      document.execCommand("paste");
    });
  } else if (el.isContentEditable) {
    el.focus();
    navigator.clipboard.readText().then((text) => {
      document.execCommand("insertText", false, text);
    }).catch(() => {
      document.execCommand("paste");
    });
  }
}

/** 初始化文本区域右键菜单（编辑器、聊天输入框、聊天消息区、预览区）。 */
function initTextContextMenu() {
  if (!textContextMenuEl) return;

  const textAreas = [editorEl, chatInput, editorPreviewEl, chatMessagesEl].filter(Boolean);

  textAreas.forEach((el) => {
    el.addEventListener("contextmenu", (e) => {
      e.stopPropagation();
      hideAppTooltip();
      hideFileContextMenu();
      hideTextContextMenu();
      showTextContextMenu(e.clientX, e.clientY, el);
    });
  });

  // 处理菜单项点击
  textContextMenuEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn || btn.hidden || btn.closest("[hidden]")) return;
    e.stopPropagation();
    const action = btn.dataset.action;
    const targetEl = textContextTargetEl;
    hideTextContextMenu();
    if (action === "text-copy") execTextCopy(targetEl);
    else if (action === "text-cut") execTextCut(targetEl);
    else if (action === "text-paste") execTextPaste(targetEl);
  });

  // 全局关闭
  document.addEventListener("click", (e) => {
    if (textContextMenuEl.classList.contains("hidden")) return;
    if (textContextMenuEl.contains(e.target)) return;
    hideTextContextMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideTextContextMenu();
  });
  window.addEventListener("resize", () => {
    hideTextContextMenu();
  });
}

/** 文件树区域右键：新建文件 / 新建文件夹。 */
function initFileTreeContextMenu() {
  if (!panelTreeEl || !fileContextMenuEl) return;

  panelTreeEl.addEventListener("contextmenu", (e) => {
    if (!panelTreeEl.contains(e.target)) return;
    hideAppTooltip();
    hideFileContextMenu();
    hideTextContextMenu();
    const ctx = resolveFileTreeContextTarget(e.target);
    showFileContextMenu(e.clientX, e.clientY, ctx);
  });

  fileContextMenuEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn || btn.hidden || btn.closest("[hidden]")) return;
    e.stopPropagation();
    const base = fileContextBaseDir;
    const targetPath = fileContextTargetPath;
    const targetType = fileContextTargetType;
    hideFileContextMenu();
    const action = btn.dataset.action;
    if (action === "new-file") createWorkspaceFile(base);
    else if (action === "new-folder") createWorkspaceFolder(base);
    else if (action === "copy-file") copyFileToClipboard(targetPath);
    else if (action === "cut-file") cutFileToClipboard(targetPath);
    else if (action === "paste-file") pasteFileFromClipboard(base);
    else if (action === "rename") renameWorkspaceItem(targetPath);
    else if (action === "delete") deleteWorkspaceItem(targetPath, targetType);
  });

  document.addEventListener("click", (e) => {
    if (fileContextMenuEl.classList.contains("hidden")) return;
    if (fileContextMenuEl.contains(e.target)) return;
    hideFileContextMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideFileContextMenu();
  });
  window.addEventListener("resize", hideFileContextMenu);
  panelTreeEl.addEventListener("scroll", hideFileContextMenu, true);
}

/** 初始化右键菜单锁定逻辑。 */
function initContextMenuLock() {
  document.addEventListener(
    "contextmenu",
    (e) => {
      e.preventDefault();
    },
    { capture: true }
  );
}

/** 是否为可用的工作区相对路径。 */
function isValidWorkspacePath(path) {
  return Boolean(path && String(path) !== "undefined");
}

/** 判断路径是否仍在左侧文件树中（与磁盘 list_tree 一致）。 */
function fileExistsInTree(path) {
  if (!fileTreeEl || !isValidWorkspacePath(path)) return false;
  return [...fileTreeEl.querySelectorAll(".file-tree-file")].some(
    (li) => li.dataset.path === path
  );
}

/** 清空编辑器选中状态（文件已删除或路径无效时）。 */
function clearEditorSelection() {
  currentFile = null;
  editorEl.value = "";
  currentFileLabel.textContent = "未选择文件";
  clearDiff();
  btnSave.disabled = true;
  updateEditorViewTabs();
  document.querySelectorAll(".file-tree-file").forEach((li) => {
    li.classList.remove("active");
  });
}

/** 文件树刷新后：当前打开的文件若已不在树中则重置 UI。 */
function reconcileEditorWithFileTree() {
  if (!currentFile) return;
  if (fileExistsInTree(currentFile)) return;
  clearEditorSelection();
}

/** 从 API 读取文件内容。 */
async function fetchFileContent(path) {
  if (!isValidWorkspacePath(path)) {
    throw new Error("无效的文件路径");
  }
  const res = await fetch(`/api/files/${encodeURIComponent(path)}`);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      detail = await res.text().catch(() => detail);
    }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return (await res.json()).content;
}

/** 打开文件到编辑器并更新标签。 */
async function openFile(path, options = {}) {
  if (!isValidWorkspacePath(path)) return;
  const { keepDiff = false, silent = false } = options;
  let content;
  try {
    content = await fetchFileContent(path);
  } catch (e) {
    if (currentFile === path) clearEditorSelection();
    if (!silent) alert("读取失败: " + e.message);
    return;
  }

  currentFile = path;
  editorEl.value = content;
  currentFileLabel.textContent = path;
  fileSnapshots[path] = content;

  if (!keepDiff) clearDiff();

  highlightFileInTree(path);
  revealFileInTree(path);

  updateEditorViewTabs();
  setViewMode(resolveViewModeForOpen({ keepDiff }));
}

/** 将文件内容应用为该路径最新变更版本。 */
async function applyLatestChangeForFile(path, changes) {
  if (!isValidWorkspacePath(path) || !fileExistsInTree(path)) {
    alert(`文件已不存在于工作区：${path || "（路径无效）"}`);
    return;
  }
  const forFile = changes.filter((c) => c.path === path);
  if (!forFile.length) return;
  const latest = forFile[forFile.length - 1];
  let oldContent = latest.old_content;
  let newContent = latest.new_content;
  if (oldContent === undefined || newContent === undefined) {
    const detail = await fetch(`/api/session/changes/${latest.id}`).then((r) => r.json());
    oldContent = detail.old_content;
    newContent = detail.new_content;
  }
  await openFile(path, { keepDiff: true });
  editorEl.value = newContent;
  fileSnapshots[path] = newContent;
  showDiff(oldContent, newContent, latest.id);
}

/** 保存当前编辑器内容到工作区。 */
async function saveFile() {
  if (!currentFile) return;
  if (viewMode === "preview") syncPreviewHtmlToEditor();
  const before = editorEl.value;
  btnSave.disabled = true;
  const res = await fetch(`/api/files/${encodeURIComponent(currentFile)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: before, record_change: true }),
  });
  btnSave.disabled = false;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert("保存失败: " + (err.detail || res.statusText));
    return;
  }

  const data = await res.json();
  fileSnapshots[currentFile] = before;

  await loadSession();

  if (data.change) {
    await applyLatestChangeForFile(currentFile, [data.change]);
  }
}

/** 提交用户对危险工具确认的回应。 */
async function submitToolConfirm(confirmId, approved) {
  const res = await fetch("/api/chat/tool-confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm_id: confirmId, approved }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || res.statusText);
  }
}

/** 在右侧对话气泡内展示危险操作确认，返回用户是否批准。 */
function showInlineToolConfirm(pendingId, event) {
  return new Promise((resolve) => {
    const msg = findPendingAssistant(pendingId);
    if (!msg) {
      resolve(false);
      return;
    }
    msg._confirmRequest = event;
    inlineConfirmWaiter = { pendingId, resolve };
    renderChat();
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  });
}

/** 消费 SSE 聊天流并更新 UI。 */
async function consumeChatStream(response, pendingId, pendingTurn) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let donePayload = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";
    for (const part of parts) {
      const line = part
        .split("\n")
        .find((l) => l.startsWith("data:"));
      if (!line) continue;
      const jsonText = line.slice(5).trim();
      if (!jsonText) continue;
      let event;
      try {
        event = JSON.parse(jsonText);
      } catch {
        continue;
      }
      if (event.type === "step") {
        upsertAgentStep(pendingId, event);
      } else if (event.type === "confirm") {
        const approved = await showInlineToolConfirm(pendingId, event);
        await submitToolConfirm(event.confirm_id, approved);
      } else if (event.type === "error") {
        throw new Error(event.detail || "Agent 错误");
      } else if (event.type === "session_title") {
        if (event.sessions) {
          applySessionsList(event.sessions, event.active_id || sessionId);
        }
      } else if (event.type === "done") {
        donePayload = event;
        finalizePendingAssistant(pendingId, {
          text: event.reply,
          steps: event.steps,
          reasoning: event.reasoning,
          usage: event.usage,
        });
        if (event.usage) applyContextUsageFromDone(event.usage);
        if (event.session_title && event.sessions) {
          applySessionsList(event.sessions, event.active_id || sessionId);
        }
      }
    }
  }
  return donePayload;
}

/** 一轮对话结束后刷新会话与文件状态。 */
async function afterChatDone(data) {
  sessionId = data.session_id;
  sessionTurn = data.turn ?? sessionTurn;
  await loadSession();
  await loadFileTree();

  if (data.written_files && data.written_files.length) {
    const written = data.written_files.filter((p) => isValidWorkspacePath(p));
    const focus =
      currentFile && written.includes(currentFile) && fileExistsInTree(currentFile)
        ? currentFile
        : written.find((p) => fileExistsInTree(p)) || null;

    if (focus && data.changes && data.changes.length) {
      await applyLatestChangeForFile(focus, data.changes);
    } else if (focus) {
      clearDiff();
      await openFile(focus);
      applyContentViewFromPreference();
    }
  } else {
    syncDiffWithSession();
  }
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;

  chatInput.value = "";
  btnSend.disabled = true;
  const pendingTurn = nextChatTurn();
  pushMessage("user", message, pendingTurn);

  const pendingId = "pending-" + Date.now();
  chatLog.push({
    type: "message",
    role: "assistant",
    text: "",
    steps: [],
    turn: pendingTurn,
    _pending: pendingId,
  });
  renderChat();

  try {
    const res = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        current_file: currentFile,
        model_id: getSelectedModelId(),
        thinking_enabled: isThinkingEnabled(),
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      chatLog = chatLog.filter((item) => item._pending !== pendingId);
      renderChat();
      pushMessage("assistant", "错误: " + (data.detail || res.statusText), pendingTurn);
      return;
    }

    const donePayload = await consumeChatStream(res, pendingId, pendingTurn);
    if (!donePayload) {
      chatLog = chatLog.filter((item) => item._pending !== pendingId);
      renderChat();
      pushMessage("assistant", "错误: 未收到完整响应", pendingTurn);
      return;
    }

    await afterChatDone(donePayload);
  } catch (err) {
    chatLog = chatLog.filter((item) => item._pending !== pendingId);
    renderChat();
    pushMessage("assistant", "请求失败: " + err.message, pendingTurn);
  } finally {
    btnSend.disabled = false;
  }
});

btnSave.addEventListener("click", saveFile);

/** 初始化编辑 / 预览 / 变更三档切换。 */
function initEditorViewMode() {
  const saved = readStorageItem(EDITOR_VIEW_MODE_KEY);
  editorViewPreference = saved === "preview" ? "preview" : "edit";
  btnViewEdit?.addEventListener("click", () => setEditorDisplayMode("edit"));
  btnViewPreview?.addEventListener("click", () => setEditorDisplayMode("preview"));
  btnViewDiff?.addEventListener("click", () => setEditorDisplayMode("diff"));
  editorPreviewEl?.addEventListener("input", schedulePreviewSync);
  editorPreviewEl?.addEventListener("focusin", onEditorPreviewFocusIn);
  syncEditorViewSwitchUI();
}

btnSessionHistory?.addEventListener("click", () => toggleHistoryPanel());

btnNewSession.addEventListener("click", async () => {
  await newSession();
});

const VALID_THEMES = ["dark", "blossom"];

/** 打开或关闭设置弹层。 */
function setSettingsOpen(open) {
  if (!settingsOverlay) return;
  const on = Boolean(open);
  settingsOverlay.classList.toggle("hidden", !on);
  settingsOverlay.setAttribute("aria-hidden", on ? "false" : "true");
  if (on) {
    hideAppTooltip();
    loadSettingsIntoForm();
    settingsApiKeyInput?.focus();
  }
}

/** 加载 API Key 配置状态到设置表单。 */
async function loadSettingsIntoForm() {
  if (!settingsApiKeyInput || !settingsApiKeyHint) return;
  settingsApiKeyInput.value = "";
  try {
    const res = await fetch("/api/settings");
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json();
    if (data.configured && data.masked) {
      settingsApiKeyHint.textContent = `已配置：${data.masked}（留空并保存则不会修改；点「清除密钥」可删除）`;
      settingsApiKeyHint.className = "settings-hint ok";
      settingsApiKeyInput.placeholder = "输入新密钥以替换…";
    } else {
      settingsApiKeyHint.textContent = "尚未配置 API Key，对话将无法调用模型。";
      settingsApiKeyHint.className = "settings-hint warn";
      settingsApiKeyInput.placeholder = "sk-…";
    }
  } catch {
    settingsApiKeyHint.textContent = "无法读取设置状态";
    settingsApiKeyHint.className = "settings-hint warn";
  }
}

/** 保存或清除 API Key 到后端。 */
async function saveSettingsApiKey(apiKey) {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || res.statusText || "保存失败");
  }
  return data;
}

/** 绑定设置弹层相关事件。 */
function initSettings() {
  if (!settingsOverlay || !settingsForm) return;

  btnSettings?.addEventListener("click", () => setSettingsOpen(true));
  btnSettingsClose?.addEventListener("click", () => setSettingsOpen(false));
  settingsOverlay.addEventListener("click", (e) => {
    if (e.target === settingsOverlay) setSettingsOpen(false);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && settingsOverlay && !settingsOverlay.classList.contains("hidden")) {
      setSettingsOpen(false);
    }
  });

  btnSettingsClearKey?.addEventListener("click", async () => {
    if (!confirm("确定清除本机保存的 API Key？")) return;
    try {
      await saveSettingsApiKey("");
      settingsApiKeyInput.value = "";
      await loadSettingsIntoForm();
    } catch (err) {
      alert("清除失败: " + (err.message || err));
    }
  });

  settingsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = settingsApiKeyInput?.value?.trim() || "";
    const hasExisting =
      settingsApiKeyHint?.classList.contains("ok");
    if (!value && !hasExisting) {
      alert("请粘贴 DeepSeek API Key");
      return;
    }
    if (!value) {
      setSettingsOpen(false);
      return;
    }
    try {
      await saveSettingsApiKey(value);
      settingsApiKeyInput.value = "";
      await loadSettingsIntoForm();
      setSettingsOpen(false);
    } catch (err) {
      alert("保存失败: " + (err.message || err));
    }
  });
}

/** 初始化主题切换与持久化。 */
function initTheme() {
  const root = document.documentElement;
  const buttons = document.querySelectorAll(".theme-btn[data-theme]");
  if (!buttons.length) return;

  function apply(theme) {
    const next = VALID_THEMES.includes(theme) ? theme : "dark";
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    buttons.forEach((btn) => {
      const on = btn.dataset.theme === next;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  const saved = readStorageItem(THEME_STORAGE_KEY);
  apply(saved || root.getAttribute("data-theme") || "dark");

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => apply(btn.dataset.theme));
  });
}

/** 将数值限制在 [min, max] 范围内。 */
function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/** 从布局元素 CSS 变量读取像素值。 */
function readCssPx(layoutEl, name, fallback) {
  const raw = getComputedStyle(layoutEl).getPropertyValue(name).trim();
  if (!raw) return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** 将侧栏宽度持久化到 localStorage。 */
function saveLayoutWidths(treePx, chatPx, historyPx) {
  try {
    const payload = {
      tree: Math.round(treePx),
      chat: Math.round(chatPx),
    };
    if (historyPx != null && historyPx > 0) {
      payload.history = Math.round(historyPx);
    }
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota */
  }
}

/** 返回历史侧栏当前宽度（关闭时为 0）。 */
function historyPanelWidthPx() {
  if (!layoutEl || !historyPanelOpen) return 0;
  return readCssPx(layoutEl, "--col-history", 0);
}

/** 返回当前可见的拖拽分隔条数量。 */
function layoutHandleCount() {
  let n = 2;
  if (historyPanelOpen) n += 1;
  return n;
}

/** 限制三栏布局宽度在合理范围。 */
function clampLayoutWidths() {
  if (!layoutEl) return;
  const treeMin = readCssPx(layoutEl, "--tree-min", 160);
  const treeMax = readCssPx(layoutEl, "--tree-max", 420);
  const chatMin = readCssPx(layoutEl, "--chat-min", 300);
  const chatMax = Math.min(
    readCssPx(layoutEl, "--chat-max", 720),
    Math.floor(window.innerWidth * 0.55)
  );
  const historyMin = readCssPx(layoutEl, "--history-min", 220);
  const historyMax = readCssPx(layoutEl, "--history-max", 480);
  const editorMin = readCssPx(layoutEl, "--editor-min", 280);
  const handleWidth = 5;
  const handles = layoutHandleCount() * handleWidth;

  const tree = readCssPx(layoutEl, "--col-tree", 240);
  const chat = readCssPx(layoutEl, "--col-chat", 400);
  let history = historyPanelWidthPx();

  const maxTree = clamp(
    layoutEl.clientWidth - chat - history - editorMin - handles,
    treeMin,
    treeMax
  );
  const maxChat = clamp(
    layoutEl.clientWidth - tree - history - editorMin - handles,
    chatMin,
    chatMax
  );
  const maxHistory = historyPanelOpen
    ? clamp(
        layoutEl.clientWidth - tree - chat - editorMin - handles,
        historyMin,
        historyMax
      )
    : 0;

  layoutEl.style.setProperty("--col-tree", `${clamp(tree, treeMin, maxTree)}px`);
  layoutEl.style.setProperty("--col-chat", `${clamp(chat, chatMin, maxChat)}px`);
  if (historyPanelOpen) {
    layoutEl.style.setProperty(
      "--col-history",
      `${clamp(history, historyMin, maxHistory)}px`
    );
  }
}

/** 初始化侧栏拖拽调整宽度。 */
function initLayoutResize() {
  if (!layoutEl) return;

  const treeMin = readCssPx(layoutEl, "--tree-min", 160);
  const treeMax = readCssPx(layoutEl, "--tree-max", 420);
  const chatMin = readCssPx(layoutEl, "--chat-min", 300);
  const chatMax = Math.min(
    readCssPx(layoutEl, "--chat-max", 720),
    Math.floor(window.innerWidth * 0.55)
  );
  const historyMin = readCssPx(layoutEl, "--history-min", 220);
  const historyMax = readCssPx(layoutEl, "--history-max", 480);
  const editorMin = readCssPx(layoutEl, "--editor-min", 280);
  const handleWidth = 5;

  let saved = {};
  try {
    saved = JSON.parse(
      readStorageItem(LAYOUT_STORAGE_KEY) || "{}"
    );
  } catch {
    saved = {};
  }
  if (saved.tree) layoutEl.style.setProperty("--col-tree", `${saved.tree}px`);
  if (saved.chat) layoutEl.style.setProperty("--col-chat", `${saved.chat}px`);
  if (saved.history) {
    layoutEl.style.setProperty("--col-history", `${saved.history}px`);
  }

  function persistLayout() {
    const tree = readCssPx(layoutEl, "--col-tree", 240);
    const chat = readCssPx(layoutEl, "--col-chat", 400);
    const history = historyPanelOpen ? readCssPx(layoutEl, "--col-history", 300) : 0;
    saveLayoutWidths(tree, chat, historyPanelOpen ? history : null);
  }

  function maxTreeWidth() {
    const chat = readCssPx(layoutEl, "--col-chat", 400);
    const history = historyPanelWidthPx();
    return clamp(
      layoutEl.clientWidth - chat - history - editorMin - layoutHandleCount() * handleWidth,
      treeMin,
      treeMax
    );
  }

  function maxChatWidth() {
    const tree = readCssPx(layoutEl, "--col-tree", 240);
    const history = historyPanelWidthPx();
    return clamp(
      layoutEl.clientWidth - tree - history - editorMin - layoutHandleCount() * handleWidth,
      chatMin,
      chatMax
    );
  }

  function maxHistoryWidth() {
    const tree = readCssPx(layoutEl, "--col-tree", 240);
    const chat = readCssPx(layoutEl, "--col-chat", 400);
    return clamp(
      layoutEl.clientWidth - tree - chat - editorMin - layoutHandleCount() * handleWidth,
      historyMin,
      historyMax
    );
  }

  function onPointerDown(e, mode) {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.classList.add("dragging");
    document.body.classList.add("layout-resizing");

    const startX = e.clientX;
    const startTree = readCssPx(layoutEl, "--col-tree", 240);
    const startChat = readCssPx(layoutEl, "--col-chat", 400);
    const startHistory = readCssPx(layoutEl, "--col-history", 300);

    function onMove(ev) {
      const dx = ev.clientX - startX;
      if (mode === "tree-editor") {
        const next = clamp(startTree + dx, treeMin, maxTreeWidth());
        layoutEl.style.setProperty("--col-tree", `${next}px`);
      } else if (mode === "editor-chat") {
        const next = clamp(startChat - dx, chatMin, maxChatWidth());
        layoutEl.style.setProperty("--col-chat", `${next}px`);
      } else if (mode === "chat-history") {
        const next = clamp(startHistory - dx, historyMin, maxHistoryWidth());
        layoutEl.style.setProperty("--col-history", `${next}px`);
      }
    }

    function onUp() {
      handle.classList.remove("dragging");
      document.body.classList.remove("layout-resizing");
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      persistLayout();
    }

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  }

  layoutEl.querySelectorAll(".resize-handle").forEach((handle) => {
    const mode = handle.dataset.resize;
    if (!mode) return;
    handle.addEventListener("pointerdown", (e) => onPointerDown(e, mode));
  });

  window.addEventListener("resize", () => clampLayoutWidths());
}

(async function init() {
  migrateLocalStorageKeys();
  loadOpenTabs();
  initContextMenuLock();
  initTheme();
  initSettings();
  initFilePanel();
  initFileTreeContextMenu();
  initTextContextMenu();
  initEditorViewMode();
  initLayoutResize();
  initAppTooltip();
  initComposerPrefs();
  await loadModelsCatalog();
  await loadSession();
  if (readStorageItem(HISTORY_OPEN_STORAGE_KEY) === "1") {
    setHistoryPanelOpen(true);
  }
  await loadFileTree();
  await reopenCurrentFileAfterTreeLoad();
})();
