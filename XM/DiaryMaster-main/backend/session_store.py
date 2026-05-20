"""
多 Session 持久化：对话 chat_log、文件变更 FileChange、轮次 turn。

数据目录：data/sessions/*.json、data/active_session.txt（均在 .gitignore）。
"""

from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.config import APP_ROOT

SESSIONS_DIR = APP_ROOT / "data" / "sessions"
ACTIVE_ID_FILE = APP_ROOT / "data" / "active_session.txt"


@dataclass
class FileChange:
    """一条文件内容变更记录（Agent 或用户保存产生，可回退）。"""

    id: str
    turn: int
    path: str
    old_content: str
    new_content: str
    source: str  # agent | manual | rollback
    created_at: str
    rollback_of: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """完整序列化（含 old/new 全文，供持久化）。"""
        return asdict(self)

    def summary(self) -> dict[str, Any]:
        """摘要信息（不含全文，供 API 列表与 UI）。"""
        old_lines = (self.old_content or "").splitlines()
        new_lines = (self.new_content or "").splitlines()
        return {
            "id": self.id,
            "turn": self.turn,
            "path": self.path,
            "source": self.source,
            "created_at": self.created_at,
            "old_line_count": len(old_lines),
            "new_line_count": len(new_lines),
            "rollback_of": self.rollback_of,
        }


@dataclass
class Session:
    """单个对话 Session：标题、轮次、LangChain messages、变更与 chat_log。"""

    id: str
    created_at: str = ""
    title: str = ""
    title_locked: bool = False  # 用户手动改名后为 True，不再自动覆盖标题
    messages: list = field(default_factory=list)
    changes: list[FileChange] = field(default_factory=list)
    turn: int = 0
    chat_log: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """供列表/顶栏展示的 Session 摘要。"""
        return {
            "id": self.id,
            "title": self.title or self.id,
            "created_at": self.created_at,
            "turn": self.turn,
            "change_count": len(self.changes),
            "changes": [c.summary() for c in self.changes],
        }


def _now_iso() -> str:
    """当前 UTC 时间的 ISO 字符串。"""
    return datetime.now(timezone.utc).isoformat()


class SessionStore:
    """多 Session 管理：内存 + 本地 JSON 持久化（data/sessions/）。"""

    def __init__(self) -> None:
        """从磁盘加载所有 Session，若无则新建一个。"""
        self._sessions: dict[str, Session] = {}
        self._active_id: str = ""
        SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
        ACTIVE_ID_FILE.parent.mkdir(parents=True, exist_ok=True)
        self._load_all_from_disk()
        if not self._sessions:
            self.new_session()
        else:
            saved = self._read_active_id()
            if saved and saved in self._sessions:
                self._active_id = saved
            else:
                self._active_id = sorted(
                    self._sessions.values(),
                    key=lambda s: s.created_at,
                )[-1].id
            self._write_active_id()

    @property
    def active_id(self) -> str:
        """当前激活的 Session id。"""
        return self._active_id

    @property
    def _session(self) -> Session:
        """当前激活的 Session 对象（内部用）。"""
        return self._sessions[self._active_id]

    def _create_session_obj(self) -> Session:
        """生成未持久化的新 Session 对象。"""
        return Session(
            id=str(uuid.uuid4())[:8],
            created_at=_now_iso(),
            title="新对话",
        )

    def get_session(self) -> Session:
        """返回当前激活的 Session。"""
        return self._session

    def list_sessions(self) -> list[dict[str, Any]]:
        """所有 Session 摘要列表（含 is_active），按创建时间倒序。"""
        items = sorted(
            self._sessions.values(),
            key=lambda s: s.created_at,
            reverse=True,
        )
        return [
            {
                **s.to_dict(),
                "is_active": s.id == self._active_id,
            }
            for s in items
        ]

    def new_session(self) -> Session:
        """新建 Session 并设为当前激活，写入磁盘。"""
        session = self._create_session_obj()
        self._sessions[session.id] = session
        self._active_id = session.id
        self._persist(session)
        self._write_active_id()
        return session

    def switch_session(self, session_id: str) -> Session:
        """切换激活 Session（仅改 active_id，不重新加载磁盘）。"""
        if session_id not in self._sessions:
            raise ValueError(f"Session 不存在: {session_id}")
        self._active_id = session_id
        self._write_active_id()
        return self._session

    def delete_session(self, session_id: str) -> str:
        """删除 Session（内存 + 磁盘）。返回删除后的 active session id。"""
        if session_id not in self._sessions:
            raise ValueError(f"Session 不存在: {session_id}")

        path = SESSIONS_DIR / f"{session_id}.json"
        del self._sessions[session_id]
        if path.is_file():
            path.unlink()

        if not self._sessions:
            return self.new_session().id

        if self._active_id == session_id:
            latest = sorted(
                self._sessions.values(),
                key=lambda s: s.created_at,
                reverse=True,
            )[0]
            self._active_id = latest.id
            self._write_active_id()

        return self._active_id

    def _touch(self) -> None:
        """持久化当前激活 Session。"""
        self._persist(self._session)

    def _persist(self, session: Session) -> None:
        """将指定 Session 写入 data/sessions/{id}.json。"""
        path = SESSIONS_DIR / f"{session.id}.json"
        data = {
            "id": session.id,
            "created_at": session.created_at,
            "title": session.title,
            "title_locked": session.title_locked,
            "turn": session.turn,
            "chat_log": session.chat_log,
            "changes": [c.to_dict() for c in session.changes],
        }
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def _read_active_id(self) -> str | None:
        """从 active_session.txt 读取上次激活的 id。"""
        if not ACTIVE_ID_FILE.is_file():
            return None
        text = ACTIVE_ID_FILE.read_text(encoding="utf-8").strip()
        return text or None

    def _write_active_id(self) -> None:
        """把当前 active_id 写入 active_session.txt。"""
        ACTIVE_ID_FILE.write_text(self._active_id, encoding="utf-8")

    def _load_all_from_disk(self) -> None:
        """启动时加载 data/sessions 下全部 JSON。"""
        for path in SESSIONS_DIR.glob("*.json"):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                session = self._session_from_json(data)
                self._sessions[session.id] = session
                self.rebuild_agent_messages_for(session)
            except (json.JSONDecodeError, OSError, TypeError, KeyError):
                continue

    def _session_from_json(self, data: dict[str, Any]) -> Session:
        """把磁盘 JSON 反序列化为 Session（messages 稍后由 chat_log 重建）。"""
        changes = [
            FileChange(**c) for c in data.get("changes", [])
        ]
        return Session(
            id=data["id"],
            created_at=data.get("created_at") or _now_iso(),
            title=data.get("title", ""),
            title_locked=bool(data.get("title_locked")),
            turn=int(data.get("turn") or 0),
            chat_log=list(data.get("chat_log") or []),
            changes=changes,
            messages=[],
        )

    def rebuild_agent_messages_for(self, session: Session) -> None:
        """从 chat_log 重建 session.messages（供 Agent 继续对话）。"""
        from langchain_core.messages import HumanMessage

        from backend.reasoning_messages import ai_message_from_chat_log

        msgs: list = []
        for event in session.chat_log:
            if event.get("type") != "message":
                continue
            role = event.get("role")
            text = (event.get("text") or "").strip()
            if not text or role == "system":
                continue
            if role == "user":
                msgs.append(HumanMessage(content=text))
            elif role == "assistant":
                reasoning = event.get("reasoning")
                msgs.append(
                    ai_message_from_chat_log(
                        text,
                        reasoning=reasoning if isinstance(reasoning, str) else None,
                    )
                )
        session.messages = msgs

    def rebuild_agent_messages_from_chat_log(self) -> None:
        """重建当前激活 Session 的 messages。"""
        self.rebuild_agent_messages_for(self._session)

    def begin_turn(self) -> int:
        """开始新一轮对话：turn += 1 并返回新轮次号。"""
        self._session.turn += 1
        return self._session.turn

    def record_change(
        self,
        path: str,
        old_content: str,
        new_content: str,
        *,
        source: str,
        turn: int | None = None,
        rollback_of: str | None = None,
    ) -> FileChange | None:
        """记录一条文件变更；内容相同则返回 None。"""
        if old_content == new_content:
            return None
        rel = path.replace("\\", "/").lstrip("/")
        change = FileChange(
            id=str(uuid.uuid4())[:8],
            turn=turn if turn is not None else self._session.turn,
            path=rel,
            old_content=old_content,
            new_content=new_content,
            source=source,
            created_at=_now_iso(),
            rollback_of=rollback_of,
        )
        self._session.changes.append(change)
        self._touch()
        return change

    def _index_of_change(self, change_id: str) -> int:
        """变更在 changes 列表中的下标，不存在返回 -1。"""
        for i, c in enumerate(self._session.changes):
            if c.id == change_id:
                return i
        return -1

    def _content_for_path_before_index(self, path: str, cut_idx: int) -> str:
        """回退计算：某路径在 cut_idx 之前应有的文件内容。"""
        prior = [c for c in self._session.changes[:cut_idx] if c.path == path]
        if prior:
            return prior[-1].new_content
        removed = [c for c in self._session.changes[cut_idx:] if c.path == path]
        if removed:
            return removed[0].old_content
        return ""

    def _truncate_chat_log_from_turn(self, cut_turn: int) -> int:
        """删除指定轮次及之后的对话与变更卡片（含该轮 user/assistant）。"""
        before = len(self._session.chat_log)
        kept: list[dict[str, Any]] = []
        for event in self._session.chat_log:
            t = event.get("turn")
            if t is not None and int(t) >= cut_turn:
                continue
            kept.append(event)
        self._session.chat_log = kept
        return before - len(kept)

    def rollback_to_turn(self, turn: int) -> dict[str, Any]:
        """回退到指定轮次之前：删除该轮及之后的对话与变更，并恢复相关文件。"""
        from backend import workspace_fs

        if turn < 1:
            raise ValueError("无效的轮次")

        to_remove = [c for c in self._session.changes if c.turn >= turn]
        has_later_chat = any(
            event.get("turn") is not None and int(event["turn"]) >= turn
            for event in self._session.chat_log
            if event.get("type") in ("message", "changes")
            and event.get("role") != "system"
        )
        if not to_remove and not has_later_chat:
            raise ValueError(f"第 {turn} 轮及之后没有可回退的内容")

        kept = [c for c in self._session.changes if c.turn < turn]
        paths_affected = {c.path for c in to_remove}

        restored_files: dict[str, str] = {}
        for path in paths_affected:
            prior = [c for c in kept if c.path == path]
            if prior:
                content = prior[-1].new_content
            else:
                removed_for_path = [c for c in to_remove if c.path == path]
                content = removed_for_path[0].old_content
            workspace_fs.write_file(path, content)
            restored_files[path] = content

        removed_ids = [c.id for c in to_remove]
        self._session.changes = kept
        removed_chat_events = self._truncate_chat_log_from_turn(turn)
        self.sync_chat_log_with_changes()
        self.rebuild_agent_messages_from_chat_log()

        max_turn = 0
        for event in self._session.chat_log:
            t = event.get("turn")
            if t is not None:
                max_turn = max(max_turn, int(t))
        self._session.turn = max_turn
        self._touch()

        primary_path = ""
        primary_content = ""
        if to_remove:
            primary_path = to_remove[0].path
            primary_content = restored_files.get(primary_path, to_remove[0].old_content)
        elif restored_files:
            primary_path = next(iter(restored_files))
            primary_content = restored_files[primary_path]

        return {
            "turn": turn,
            "path": primary_path,
            "content": primary_content,
            "restored_files": restored_files,
            "removed_change_ids": removed_ids,
            "removed_chat_events": removed_chat_events,
        }

    def rollback_to(self, change_id: str) -> dict[str, Any]:
        """回退到某条变更所在轮次之前（等价于 rollback_to_turn）。"""
        idx = self._index_of_change(change_id)
        if idx < 0:
            raise ValueError("变更记录不存在")
        target = self._session.changes[idx]
        result = self.rollback_to_turn(target.turn)
        result["rolled_back_change_id"] = change_id
        return result

    def rollback_latest(self, path: str | None = None) -> dict[str, Any]:
        """回退指定文件最近一次变更，或整个 Session 最后一轮。"""
        if path:
            rel = path.replace("\\", "/").lstrip("/")
            file_changes = [c for c in self._session.changes if c.path == rel]
            if not file_changes:
                raise ValueError(f"文件 {rel} 没有变更记录")
            return self.rollback_to_turn(file_changes[-1].turn)

        max_turn = 0
        for event in self._session.chat_log:
            t = event.get("turn")
            if t is not None:
                max_turn = max(max_turn, int(t))
        for c in self._session.changes:
            max_turn = max(max_turn, c.turn)
        if max_turn < 1:
            raise ValueError("当前 Session 没有可回退的轮次")
        return self.rollback_to_turn(max_turn)

    def get_change(self, change_id: str) -> FileChange | None:
        """按 id 查找变更（当前 Session）。"""
        for c in self._session.changes:
            if c.id == change_id:
                return c
        return None

    def list_changes(self, path: str | None = None) -> list[FileChange]:
        """列出变更；path 可选，仅该文件的变更。"""
        if not path:
            return list(self._session.changes)
        rel = path.replace("\\", "/").lstrip("/")
        return [c for c in self._session.changes if c.path == rel]

    def clear_messages(self) -> None:
        """清空当前 Session 的 LangChain messages（不删 chat_log）。"""
        self._session.messages = []

    def append_chat_message(
        self,
        role: str,
        text: str,
        turn: int | None = None,
        *,
        steps: list[dict[str, Any]] | None = None,
        reasoning: str | None = None,
        usage: dict[str, Any] | None = None,
    ) -> None:
        """追加一条对话消息到 chat_log（user/assistant/system）。"""
        entry: dict[str, Any] = {"type": "message", "role": role, "text": text}
        if turn is not None:
            entry["turn"] = turn
        if steps:
            entry["steps"] = steps
        if reasoning:
            entry["reasoning"] = reasoning
        if usage:
            entry["usage"] = usage
        self._session.chat_log.append(entry)
        self._touch()

    def set_session_title(
        self,
        title: str,
        *,
        manual: bool = False,
        session_id: str | None = None,
    ) -> str:
        """设置 Session 标题；manual=True 时标记为用户命名，后续不再自动改标题。"""
        sid = session_id or self._active_id
        if sid not in self._sessions:
            raise ValueError(f"Session 不存在: {sid}")
        cleaned = (title or "").strip()
        if not cleaned:
            raise ValueError("标题不能为空")
        session = self._sessions[sid]
        session.title = cleaned[:80]
        if manual:
            session.title_locked = True
        self._persist(session)
        return session.title

    def append_chat_changes(self, turn: int, change_ids: list[str]) -> None:
        """在 chat_log 中记录一轮产生的变更 id 列表。"""
        if not change_ids:
            return
        self._session.chat_log.append(
            {"type": "changes", "turn": turn, "change_ids": change_ids}
        )
        self._touch()

    def get_chat_log_for_api(self) -> list[dict[str, Any]]:
        """展开 chat_log 供前端渲染（changes 事件内嵌变更摘要）。"""
        result: list[dict[str, Any]] = []
        for event in self._session.chat_log:
            if event.get("type") == "changes":
                ids = event.get("change_ids") or []
                changes = []
                for cid in ids:
                    c = self.get_change(cid)
                    if c:
                        changes.append(c.summary())
                if changes:
                    result.append(
                        {
                            "type": "changes",
                            "turn": event.get("turn", 0),
                            "changes": changes,
                        }
                    )
            else:
                result.append(dict(event))
        return result

    def sync_chat_log_with_changes(self) -> None:
        """删除 chat_log 中已无效的 change_ids 引用（回退后调用）。"""
        valid = {c.id for c in self._session.changes}
        new_log: list[dict[str, Any]] = []
        for event in self._session.chat_log:
            if event.get("type") != "changes":
                new_log.append(event)
                continue
            ids = [i for i in (event.get("change_ids") or []) if i in valid]
            if ids:
                new_log.append({**event, "change_ids": ids})
        self._session.chat_log = new_log
        self._touch()


store = SessionStore()
