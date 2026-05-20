"""Agent 危险工具执行前的人机确认（阻塞工具线程直至用户响应）。"""

from __future__ import annotations

import queue
import threading
import uuid
from dataclasses import dataclass, field
from typing import Any

@dataclass
class _PendingConfirm:
    """单次待确认请求。"""

    confirm_id: str
    tool: str
    label: str
    path: str | None
    detail: str
    event: threading.Event = field(default_factory=threading.Event)
    approved: bool = False


class ConfirmRegistry:
    """本轮对话的工具确认注册表（工具线程阻塞，SSE 线程推送 confirm 事件）。"""

    def __init__(self) -> None:
        """初始化确认队列与待处理表。"""
        self._lock = threading.Lock()
        self._pending: dict[str, _PendingConfirm] = {}
        self._out: queue.Queue[dict[str, Any]] = queue.Queue()

    def drain_events(self) -> list[dict[str, Any]]:
        """取出待推送给前端的 confirm 事件。"""
        items: list[dict[str, Any]] = []
        while True:
            try:
                items.append(self._out.get_nowait())
            except queue.Empty:
                break
        return items

    def wait_for_approval(
        self,
        *,
        tool: str,
        label: str,
        path: str | None = None,
        detail: str = "",
    ) -> bool:
        """阻塞直至用户确认或拒绝；先向 _out 放入 confirm 事件。"""
        confirm_id = uuid.uuid4().hex[:12]
        pending = _PendingConfirm(
            confirm_id=confirm_id,
            tool=tool,
            label=label,
            path=path,
            detail=detail,
        )
        with self._lock:
            self._pending[confirm_id] = pending

        self._out.put(
            {
                "type": "confirm",
                "confirm_id": confirm_id,
                "tool": tool,
                "label": label,
                "path": path,
                "detail": detail,
                "message": detail or label,
            }
        )

        pending.event.wait()
        with self._lock:
            self._pending.pop(confirm_id, None)
        return pending.approved

    def resolve(self, confirm_id: str, approved: bool) -> bool:
        """响应用户在前端的确认/拒绝。"""
        with self._lock:
            pending = self._pending.get(confirm_id)
        if not pending:
            return False
        pending.approved = approved
        pending.event.set()
        return True


_active_lock = threading.Lock()
_active_registry: ConfirmRegistry | None = None


def set_active_registry(registry: ConfirmRegistry | None) -> None:
    """设置当前进行中的 chat_stream 注册表。"""
    global _active_registry
    with _active_lock:
        _active_registry = registry


def get_active_registry() -> ConfirmRegistry | None:
    """获取当前进行中的注册表。"""
    with _active_lock:
        return _active_registry


def resolve_confirmation(confirm_id: str, approved: bool) -> bool:
    """供 API 调用：解析用户对某次 confirm 的选择。"""
    reg = get_active_registry()
    if not reg:
        return False
    return reg.resolve(confirm_id, approved)


def require_tool_confirmation(
    *,
    tool: str,
    label: str,
    path: str | None = None,
    detail: str = "",
) -> bool:
    """若本轮启用了确认注册表则等待用户；否则默认允许（非交互调用）。"""
    reg = get_active_registry()
    if reg is None:
        return True
    return reg.wait_for_approval(
        tool=tool,
        label=label,
        path=path,
        detail=detail,
    )
