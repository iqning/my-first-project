"""
Agent 执行步骤的发布机制（供 SSE / UI 时间线使用）。

chat_stream 注册 emitter 后，工具函数通过 publish_step 推送 step 事件；
未注册时 publish_step 静默，不影响逻辑。

注意：FastAPI StreamingResponse 可能在不同线程里迭代生成器，不能用
ContextVar.reset(token)。清理时只用 set(None)，并配合模块级回调兜底。
"""

from __future__ import annotations

import contextvars
import uuid
from collections.abc import Callable
from typing import Any

_emit: contextvars.ContextVar[Callable[[dict[str, Any]], None] | None] = contextvars.ContextVar(
    "agent_step_emit", default=None
)

# 与 ContextVar 同步，避免 LangChain / 线程池里 get 不到 emitter
_fallback_emitter: Callable[[dict[str, Any]], None] | None = None


def set_step_emitter(emitter: Callable[[dict[str, Any]], None] | None) -> None:
    """注册本轮对话的 step 回调（chat_stream 开始时调用）。"""
    global _fallback_emitter
    _fallback_emitter = emitter
    _emit.set(emitter)


def clear_step_emitter() -> None:
    """清除 emitter（chat_stream 的 finally 里调用，可跨线程安全）。"""
    global _fallback_emitter
    _fallback_emitter = None
    _emit.set(None)


def publish_step(step: dict[str, Any]) -> None:
    """若已注册 emitter，推送一条 type=step 的事件给前端。"""
    step = {**step, "type": "step"}
    emitter = _emit.get(None) or _fallback_emitter
    if emitter is not None:
        emitter(step)


def new_step_id() -> str:
    """生成步骤 id，同一步骤 running/done 共用此 id 以便 UI 更新。"""
    return str(uuid.uuid4())[:8]


def truncate_detail(text: str, limit: int = 200) -> str:
    """按字符数截断（用于 edit_file / write_file 等短反馈）。"""
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


READ_FILE_PREVIEW_LINES = 4
LIST_FILES_PREVIEW_COUNT = 8


def format_step_detail(tool: str | None, result: str) -> str:
    """
    生成 UI 步骤区展示的 detail（与返回给模型的完整 result 分离）。
    read_file / list_files 只显示少量预览行。
    """
    text = (result or "").strip()
    if not text:
        return ""
    if tool == "read_file":
        return _preview_read_file_detail(text)
    if tool == "list_files":
        return _preview_list_files_detail(text)
    return truncate_detail(text)


def _preview_read_file_detail(text: str) -> str:
    """生成 read_file 工具结果在步骤面板中的截断预览。"""
    lines = text.splitlines()
    body = lines
    if len(lines) >= 2 and lines[0].startswith("---") and lines[-1].strip() == "---":
        body = lines[1:-1]
    total = len(body)
    if total == 0:
        return "（空文件）"
    preview = "\n".join(body[:READ_FILE_PREVIEW_LINES])
    if total > READ_FILE_PREVIEW_LINES:
        preview += f"\n…（共 {total} 行，仅预览前 {READ_FILE_PREVIEW_LINES} 行）"
    else:
        preview += f"\n（共 {total} 行）"
    return preview


def _preview_list_files_detail(text: str) -> str:
    """生成 list_files 工具结果在步骤面板中的截断预览。"""
    if text.startswith("（"):
        return text
    paths = [p for p in text.splitlines() if p.strip()]
    if len(paths) <= LIST_FILES_PREVIEW_COUNT:
        return text
    head = "\n".join(paths[:LIST_FILES_PREVIEW_COUNT])
    return f"{head}\n…（共 {len(paths)} 个文件）"


def tool_result_status(result: str) -> str:
    """根据工具返回字符串判断步骤状态：含「失败/中止」则为 error，否则 done。"""
    if any(k in result for k in ("失败", "中止", "错误:")):
        return "error"
    return "done"
