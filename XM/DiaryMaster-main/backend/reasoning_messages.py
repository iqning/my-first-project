"""DeepSeek 思考模式：reasoning_content 的提取与 AIMessage 规范化。"""

from __future__ import annotations

from langchain_core.messages import AIMessage, BaseMessage


def extract_reasoning_content(msg: AIMessage) -> str:
    """从 AIMessage 取出思考链文本（DeepSeek reasoning_content）。"""
    ak = getattr(msg, "additional_kwargs", None) or {}
    if isinstance(ak, dict):
        rc = ak.get("reasoning_content")
        if rc:
            return rc if isinstance(rc, str) else str(rc)
    rm = getattr(msg, "response_metadata", None) or {}
    if isinstance(rm, dict):
        rc = rm.get("reasoning_content")
        if rc:
            return rc if isinstance(rc, str) else str(rc)
    return ""


def normalize_reasoning_on_messages(messages: list[BaseMessage]) -> None:
    """把 reasoning_content 写入 additional_kwargs，便于 LangChain 回传 API。"""
    for msg in messages:
        if not isinstance(msg, AIMessage):
            continue
        reasoning = extract_reasoning_content(msg)
        if not reasoning:
            continue
        ak = dict(msg.additional_kwargs or {})
        if ak.get("reasoning_content") != reasoning:
            ak["reasoning_content"] = reasoning
            msg.additional_kwargs = ak


def ai_message_from_chat_log(
    text: str,
    *,
    reasoning: str | None = None,
) -> AIMessage:
    """从 chat_log 条目构建 AIMessage（含可选 reasoning_content）。"""
    kwargs: dict = {}
    if reasoning and reasoning.strip():
        kwargs["additional_kwargs"] = {"reasoning_content": reasoning.strip()}
    return AIMessage(content=text, **kwargs)
