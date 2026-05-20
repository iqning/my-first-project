"""
DiaryMaster FastAPI 入口：静态前端、工作区文件、Session、Agent 流式对话、设置。

各路由函数 docstring 说明 HTTP 用途；业务逻辑在 agent / session_store / workspace_fs。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

_APP_ROOT = Path(__file__).resolve().parent.parent
if str(_APP_ROOT) not in sys.path:
    sys.path.insert(0, str(_APP_ROOT))

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend import agent, workspace_fs
from backend.config import WEB_DIR, api_key_status, bootstrap_api_key_from_disk, set_api_key
from backend.context_usage import get_session_context_usage
from backend.model_registry import default_model_id, list_models, validate_model_id
from backend.session_store import store
from backend.tool_confirm import resolve_confirmation

app = FastAPI(title="DiaryMaster")


class ChatRequest(BaseModel):
    """POST /api/chat 与 /api/chat/stream 的请求体。"""

    message: str
    current_file: str | None = None
    model_id: str | None = None
    thinking_enabled: bool = False


class ToolConfirmRequest(BaseModel):
    """POST /api/chat/tool-confirm：响应 Agent 危险工具确认弹窗。"""

    confirm_id: str
    approved: bool


class ChatResponse(BaseModel):
    """非流式对话的响应体。"""

    reply: str
    written_files: list[str]
    session_id: str
    turn: int
    changes: list[dict]


class FileCreateRequest(BaseModel):
    """POST /api/files/create：新建 workspace 文件。"""

    path: str
    content: str = ""


class DirCreateRequest(BaseModel):
    """POST /api/files/mkdir：新建文件夹。"""

    path: str


class FileWriteRequest(BaseModel):
    """（保留）文件写入请求体。"""

    content: str


class ManualSaveRequest(BaseModel):
    """PUT /api/files/{path}：编辑器保存。"""

    content: str
    record_change: bool = True


class FileTransferRequest(BaseModel):
    """POST /api/files/copy / move：复制/移动工作区文件。"""

    source: str
    destination: str


class SessionTitleRequest(BaseModel):
    """PATCH /api/session/{id}/title：重命名会话。"""

    title: str


class SettingsUpdateRequest(BaseModel):
    """PUT /api/settings：保存或清除 API Key。"""

    api_key: str = ""


@app.on_event("startup")
def _on_startup() -> None:
    """应用启动：从 user_settings 注入 API Key 到环境变量。"""
    bootstrap_api_key_from_disk()


@app.get("/api/settings")
def api_get_settings():
    """读取 API Key 配置状态（脱敏）。"""
    return api_key_status()


@app.put("/api/settings")
def api_update_settings(body: SettingsUpdateRequest):
    """保存或清除 DeepSeek API Key，并清空 Agent 缓存。"""
    from backend.agent import clear_agent_cache

    set_api_key(body.api_key)
    clear_agent_cache()
    return {"ok": True, **api_key_status()}


@app.get("/api/models")
def api_list_models():
    """列出可选模型（V4 Flash / Pro 等）。"""
    return {"models": list_models(), "default_model_id": default_model_id()}


@app.get("/api/session/context-usage")
def api_session_context_usage(model_id: str | None = None):
    """当前 Session 上下文占用（圆环）；query model_id 指定上限模型。"""
    mid = validate_model_id(model_id)
    session = store.get_session()
    return get_session_context_usage(
        session.messages,
        mid,
        chat_log=session.chat_log,
    )


@app.get("/api/session")
def api_get_session():
    """当前激活 Session 的详情与 chat_log。"""
    info = agent.get_session_info()
    info["sessions"] = agent.list_sessions()
    info["active_id"] = store.active_id
    return info


@app.get("/api/sessions")
def api_list_sessions():
    """所有 Session 摘要列表。"""
    from backend.session_store import store

    return {
        "active_id": store.active_id,
        "sessions": store.list_sessions(),
    }


@app.post("/api/session/new")
def api_new_session():
    """新建空白 Session 并激活。"""
    from backend.session_store import store

    session_id = agent.new_session()
    store.append_chat_message("system", f"已新建 Session: {session_id}")
    return {
        "session_id": session_id,
        "ok": True,
        "sessions": store.list_sessions(),
    }


@app.post("/api/session/{session_id}/activate")
def api_activate_session(session_id: str):
    """切换激活 Session，返回其完整信息。"""
    from backend.session_store import store

    try:
        agent.switch_session(session_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    info = agent.get_session_info()
    info["sessions"] = store.list_sessions()
    info["active_id"] = store.active_id
    return info


@app.get("/api/session/changes")
def api_list_changes(path: str | None = None):
    """当前 Session 的文件变更摘要；可选按 path 过滤。"""
    from backend.session_store import store

    changes = store.list_changes(path)
    return {
        "session_id": store.get_session().id,
        "changes": [c.summary() for c in changes],
    }


@app.get("/api/session/changes/{change_id}")
def api_get_change(change_id: str):
    """单条变更详情（含 old/new 全文，供 diff）。"""
    change = agent.get_change(change_id)
    if change is None:
        raise HTTPException(status_code=404, detail="变更记录不存在")
    return change.to_dict()


@app.post("/api/session/turns/{turn}/rollback")
def api_rollback_turn(turn: int):
    """回退到指定轮次之前（含对话与文件）。"""
    try:
        from backend.session_store import store

        result = agent.rollback_turn(turn)
        n_changes = len(result.get("removed_change_ids") or [])
        n_chat = result.get("removed_chat_events") or 0
        store.append_chat_message(
            "system",
            f"已回退到第 {turn} 轮之前（撤销 {n_changes} 条变更、{n_chat} 段对话）",
        )
        return {
            "ok": True,
            "session_id": store.get_session().id,
            **result,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except workspace_fs.WorkspaceError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.post("/api/session/changes/{change_id}/rollback")
def api_rollback_change(change_id: str):
    """回退到某条变更所在轮次之前。"""
    try:
        from backend.session_store import store

        result = agent.rollback_change(change_id)
        turn = result.get("turn", 0)
        n_changes = len(result.get("removed_change_ids") or [])
        n_chat = result.get("removed_chat_events") or 0
        store.append_chat_message(
            "system",
            f"已回退到第 {turn} 轮之前（撤销 {n_changes} 条变更、{n_chat} 段对话）",
        )

        return {
            "ok": True,
            "session_id": store.get_session().id,
            **result,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except workspace_fs.WorkspaceError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.post("/api/session/rollback/latest")
def api_rollback_latest(path: str | None = None):
    """回退最近一次变更（可限定 path）。"""
    try:
        from backend.session_store import store

        result = agent.rollback_latest(path)
        turn = result.get("turn", 0)
        n_changes = len(result.get("removed_change_ids") or [])
        n_chat = result.get("removed_chat_events") or 0
        store.append_chat_message(
            "system",
            f"已回退到第 {turn} 轮之前（撤销 {n_changes} 条变更、{n_chat} 段对话）",
        )

        return {
            "ok": True,
            "session_id": store.get_session().id,
            **result,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except workspace_fs.WorkspaceError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.get("/api/files")
def api_list_files():
    """工作区文件扁平列表 + 树形结构（左侧文件栏）。"""
    return {"files": workspace_fs.list_files(), "tree": workspace_fs.list_tree()}


@app.post("/api/files/create")
def api_create_file(body: FileCreateRequest):
    """新建 workspace 文件。"""
    try:
        path = workspace_fs.create_file(body.path, body.content)
        return {"ok": True, "path": path}
    except workspace_fs.WorkspaceError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.post("/api/files/mkdir")
def api_create_directory(body: DirCreateRequest):
    """新建 workspace 文件夹。"""
    try:
        path = workspace_fs.create_directory(body.path)
        return {"ok": True, "path": path}
    except workspace_fs.WorkspaceError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.delete("/api/files/{path:path}")
def api_delete_path(path: str):
    """删除 workspace 文件或文件夹（目录递归删除）。"""
    try:
        deleted = workspace_fs.delete_path(path)
        return {"ok": True, "path": deleted}
    except workspace_fs.WorkspaceError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.post("/api/files/copy")
def api_copy_path(body: FileTransferRequest):
    """复制工作区文件或文件夹。"""
    try:
        result = workspace_fs.copy_path(body.source, body.destination)
        return {"ok": True, "path": result}
    except workspace_fs.WorkspaceError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.post("/api/files/move")
def api_move_path(body: FileTransferRequest):
    """移动/重命名工作区文件或文件夹。"""
    try:
        result = workspace_fs.move_path(body.source, body.destination)
        return {"ok": True, "path": result}
    except workspace_fs.WorkspaceError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.get("/api/files/{path:path}")
def api_read_file(path: str):
    """读取 workspace 文件内容。"""
    try:
        content = workspace_fs.read_file(path)
        return {"path": path, "content": content}
    except workspace_fs.WorkspaceError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.put("/api/files/{path:path}")
def api_write_file(path: str, body: ManualSaveRequest):
    """保存文件；可选记录 manual 变更到当前 Session。"""
    from backend.session_store import store

    try:
        old_content = ""
        try:
            old_content = workspace_fs.read_file(path)
        except workspace_fs.WorkspaceError:
            pass
        workspace_fs.write_file(path, body.content)
        change_dict = None
        if body.record_change and old_content != body.content:
            change = agent.record_manual_change(path, old_content, body.content)
            if change:
                change_dict = change.to_dict()
                store.append_chat_changes(change.turn, [change.id])

        if change_dict is None:
            store.append_chat_message("system", f"已保存 {path}")

        return {
            "path": path,
            "ok": True,
            "session_id": store.get_session().id,
            "change": change_dict,
        }
    except workspace_fs.WorkspaceError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


def _persist_chat_turn(user_text: str, done: dict) -> str | None:
    """把 chat_stream 的 done 事件写入 session chat_log（含 steps、变更 id）。返回自动生成的标题（若有）。"""
    from backend.session_store import store

    turn = done["turn"]
    store.append_chat_message("user", user_text, turn=turn)
    store.append_chat_message(
        "assistant",
        done.get("reply", ""),
        turn=turn,
        steps=done.get("steps"),
        reasoning=done.get("reasoning"),
        usage=done.get("usage"),
    )
    changes = done.get("changes") or []
    if changes:
        store.append_chat_changes(turn, [c["id"] for c in changes])
    return done.get("session_title")


@app.delete("/api/session/{session_id}")
def api_delete_session(session_id: str):
    """删除 Session（磁盘与内存）；若删的是当前则切换到其他 Session。"""
    try:
        active_id = agent.delete_session(session_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    info = agent.get_session_info()
    info["sessions"] = store.list_sessions()
    info["active_id"] = store.active_id
    return {
        "ok": True,
        "deleted_id": session_id,
        "active_id": active_id,
        **info,
    }


@app.patch("/api/session/{session_id}/title")
def api_set_session_title(session_id: str, body: SessionTitleRequest):
    """手动重命名 Session；之后不再被首轮自动标题覆盖。"""
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="标题不能为空")
    try:
        saved = store.set_session_title(title, manual=True, session_id=session_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return {
        "ok": True,
        "session_id": session_id,
        "title": saved,
        "sessions": store.list_sessions(),
        "active_id": store.active_id,
    }


@app.post("/api/chat", response_model=ChatResponse)
def api_chat(req: ChatRequest):
    """非流式对话（少用；前端主要用 stream）。"""
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="消息不能为空")
    try:
        user_text = req.message.strip()
        done = None
        mid = validate_model_id(req.model_id)
        for event in agent.chat_stream(
            user_text,
            req.current_file,
            model_id=mid,
            thinking_enabled=req.thinking_enabled,
        ):
            if event.get("type") == "done":
                done = event
            elif event.get("type") == "error":
                raise RuntimeError(event.get("detail", "Agent 调用失败"))
        if not done:
            raise RuntimeError("Agent 未返回结果")

        _persist_chat_turn(user_text, done)
        session = store.get_session()
        return ChatResponse(
            reply=done["reply"],
            written_files=done.get("written_files", []),
            session_id=session.id,
            turn=done["turn"],
            changes=done.get("changes", []),
        )
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Agent 调用失败: {e}") from e


@app.post("/api/chat/tool-confirm")
def api_chat_tool_confirm(body: ToolConfirmRequest):
    """用户确认或拒绝 Agent 发起的危险工具操作（须在同一条 SSE 连接进行中调用）。"""
    if not body.confirm_id.strip():
        raise HTTPException(status_code=400, detail="confirm_id 不能为空")
    if not resolve_confirmation(body.confirm_id.strip(), body.approved):
        raise HTTPException(
            status_code=404,
            detail="确认请求不存在或已过期（可能对话已结束）",
        )
    return {"ok": True, "approved": body.approved}


@app.post("/api/chat/stream")
def api_chat_stream(req: ChatRequest):
    """SSE：执行过程中推送 step，结束时推送 done 并持久化 Session。"""
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="消息不能为空")

    def generate():
        """SSE 生成器：逐条推送 chat_stream 事件。"""
        user_text = req.message.strip()
        try:
            mid = validate_model_id(req.model_id)
            for event in agent.chat_stream(
                user_text,
                req.current_file,
                model_id=mid,
                thinking_enabled=req.thinking_enabled,
            ):
                if event.get("type") == "done":
                    _persist_chat_turn(user_text, event)
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                if event.get("type") == "done" and event.get("session_title"):
                    yield (
                        "data: "
                        + json.dumps(
                            {
                                "type": "session_title",
                                "session_id": event.get("session_id"),
                                "title": event["session_title"],
                                "sessions": store.list_sessions(),
                                "active_id": store.active_id,
                            },
                            ensure_ascii=False,
                        )
                        + "\n\n"
                    )
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'detail': str(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/chat/reset")
def api_chat_reset():
    """兼容旧接口：等价于新建 Session。"""
    session_id = agent.new_session()
    return {"ok": True, "session_id": session_id}


@app.get("/")
def index():
    """返回前端单页 index.html。"""
    return FileResponse(WEB_DIR / "index.html")


app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")


if __name__ == "__main__":
    import uvicorn

    from backend.config import HOST, PORT

    print(f"DiaryMaster: http://{HOST}:{PORT}")
    uvicorn.run(app, host=HOST, port=PORT)
