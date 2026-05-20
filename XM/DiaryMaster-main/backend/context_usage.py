"""Session 上下文占用：优先 API usage_metadata，无数据时字符估算。"""

from __future__ import annotations

import json
from typing import Any

from langchain_core.messages import AIMessage

from backend.model_registry import default_model_id, get_model

TOOLS_AND_FRAME_OVERHEAD = 2_000


def estimate_tokens(text: str) -> int:
    """中英混合字符启发式估算 token 数（无官方 tokenizer 时的回退）。"""
    if not text:
        return 0
    cjk = sum(1 for c in text if "\u4e00" <= c <= "\u9fff")
    other = len(text) - cjk
    return max(1, int(cjk / 1.2 + other / 4))


def _content_to_str(content: Any) -> str:
    """把 LangChain message content（str 或多段块）转成纯文本。"""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict):
                if block.get("type") == "text":
                    parts.append(str(block.get("text", "")))
                else:
                    parts.append(json.dumps(block, ensure_ascii=False, default=str))
            else:
                parts.append(str(block))
        return "".join(parts)
    return str(content)


def estimate_message_tokens(msg: Any) -> int:
    """估算单条消息的 token（含 tool_calls 等附加字段）。"""
    text = _content_to_str(getattr(msg, "content", None))
    extra: list[str] = []
    for tc in getattr(msg, "tool_calls", None) or []:
        extra.append(json.dumps(tc, ensure_ascii=False, default=str))
    name = getattr(msg, "name", None)
    if name:
        extra.append(str(name))
    combined = text + ("\n" + "\n".join(extra) if extra else "")
    return estimate_tokens(combined) + 4


def _system_prompt_tokens() -> int:
    """系统提示词占用的估算 token。"""
    from backend.agent import SYSTEM_PROMPT

    return estimate_tokens(SYSTEM_PROMPT)


def estimate_session_context_tokens(messages: list[Any]) -> int:
    """根据 messages 列表估算送入模型的总 prompt token（含系统提示与工具开销）。"""
    total = _system_prompt_tokens() + TOOLS_AND_FRAME_OVERHEAD
    for msg in messages or []:
        total += estimate_message_tokens(msg)
    return total


def _usage_dict_from_metadata(raw: Any) -> dict[str, int] | None:
    """从 usage_metadata / token_usage 等原始结构解析统一 usage 字典。"""
    if raw is None:
        return None
    if hasattr(raw, "get") and callable(raw.get):
        d = raw
    elif hasattr(raw, "input_tokens"):
        d = {
            "input_tokens": getattr(raw, "input_tokens", 0) or 0,
            "output_tokens": getattr(raw, "output_tokens", 0) or 0,
            "total_tokens": getattr(raw, "total_tokens", 0) or 0,
        }
    elif isinstance(raw, dict):
        d = raw
    else:
        return None

    prompt = int(d.get("input_tokens") or d.get("prompt_tokens") or 0)
    completion = int(d.get("output_tokens") or d.get("completion_tokens") or 0)
    total = int(d.get("total_tokens") or (prompt + completion))
    if prompt <= 0 and total <= 0:
        return None
    return {
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "total_tokens": total,
    }


def extract_usage_from_ai_message(msg: AIMessage) -> dict[str, int] | None:
    """从 AIMessage 提取 prompt/completion/total tokens（API 计量）。"""
    usage = _usage_dict_from_metadata(getattr(msg, "usage_metadata", None))
    if usage:
        return usage
    meta = getattr(msg, "response_metadata", None) or {}
    if isinstance(meta, dict):
        return _usage_dict_from_metadata(
            meta.get("token_usage") or meta.get("usage")
        )
    return None


def normalize_turn_usage(
    prompt_tokens: int,
    completion_tokens: int = 0,
    *,
    source: str = "api",
    context_prompt_tokens: int | None = None,
    calls: list[dict[str, int]] | None = None,
) -> dict[str, Any]:
    """构造写入 chat_log 与 done 事件的 usage 字段（合计恒为输入+输出）。"""
    prompt = int(prompt_tokens)
    completion = int(completion_tokens)
    context = int(
        context_prompt_tokens if context_prompt_tokens is not None else prompt
    )
    out: dict[str, Any] = {
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "total_tokens": prompt + completion,
        "context_prompt_tokens": context,
        "source": source,
    }
    if calls:
        out["calls"] = calls
        out["model_calls"] = len(calls)
    return out


def context_window_tokens_from_usage(usage: dict[str, Any] | None) -> int:
    """从 usage 取上下文窗口占用（优先 context_prompt_tokens，兼容旧数据）。"""
    if not usage:
        return 0
    ctx = usage.get("context_prompt_tokens")
    if ctx is not None and int(ctx) > 0:
        return int(ctx)
    return int(usage.get("prompt_tokens") or 0)


class TurnUsageTracker:
    """一轮 Agent 内多次 model 调用的 usage 聚合（输入/输出累加，上下文取 max）。"""

    def __init__(self) -> None:
        """初始化一轮对话的 usage 累计器。"""
        self.prompt_tokens = 0
        self.completion_tokens = 0
        self.context_prompt_tokens = 0
        self.source = "api"
        self._saw_api = False
        self.calls: list[dict[str, int]] = []

    def absorb_message(self, msg: AIMessage) -> None:
        """吸收一次 model 调用的 usage（输入/输出累加，上下文取单次 prompt 最大值）。"""
        u = extract_usage_from_ai_message(msg)
        if not u:
            return
        self._saw_api = True
        p = u["prompt_tokens"]
        c = u["completion_tokens"]
        self.prompt_tokens += p
        self.completion_tokens += c
        self.context_prompt_tokens = max(self.context_prompt_tokens, p)
        self.calls.append(
            {
                "index": len(self.calls) + 1,
                "prompt_tokens": p,
                "completion_tokens": c,
                "total_tokens": p + c,
            }
        )

    def to_dict(self) -> dict[str, Any] | None:
        """若本轮见过 API usage 则返回 dict，否则 None。"""
        if not self._saw_api or (
            self.prompt_tokens <= 0 and self.completion_tokens <= 0
        ):
            return None
        return normalize_turn_usage(
            self.prompt_tokens,
            self.completion_tokens,
            context_prompt_tokens=self.context_prompt_tokens,
            source="api",
            calls=[dict(c) for c in self.calls],
        )


def last_usage_from_chat_log(chat_log: list[dict[str, Any]]) -> dict[str, Any] | None:
    """从 chat_log 最后一条带 usage 的 assistant 消息读取 token 信息。"""
    for entry in reversed(chat_log or []):
        if entry.get("type") != "message" or entry.get("role") != "assistant":
            continue
        usage = entry.get("usage")
        if isinstance(usage, dict) and usage.get("prompt_tokens"):
            return usage
    return None


def has_agent_conversation(
    messages: list[Any],
    chat_log: list[dict[str, Any]] | None,
) -> bool:
    """是否已有用户/助手往返（不含「已新建 Session」等系统提示）。"""
    from langchain_core.messages import AIMessage, HumanMessage

    for msg in messages or []:
        if isinstance(msg, (HumanMessage, AIMessage)):
            return True
    for entry in chat_log or []:
        if entry.get("type") != "message":
            continue
        if entry.get("role") in ("user", "assistant"):
            return True
    return False


def get_session_context_usage(
    messages: list[Any],
    model_id: str | None,
    *,
    chat_log: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """
    计算当前 Session 上下文占用（供圆环 API）。

    优先最后一条 assistant 的 context_prompt_tokens；无对话为 0；否则字符估算。
    """
    mid = model_id or default_model_id()
    spec = get_model(mid)
    limit = spec.context_limit

    usage = None
    if chat_log is not None:
        usage = last_usage_from_chat_log(chat_log)

    is_estimate = False
    if usage and usage.get("source") == "api":
        used = context_window_tokens_from_usage(usage)
        source = "api"
    elif usage and context_window_tokens_from_usage(usage):
        used = context_window_tokens_from_usage(usage)
        source = usage.get("source", "api")
    elif not has_agent_conversation(messages, chat_log):
        used = 0
        source = "none"
    else:
        used = estimate_session_context_tokens(messages)
        is_estimate = True
        source = "estimate"

    percent = round(min(100.0, used / limit * 100), 1) if limit else 0.0
    return {
        "used_tokens": used,
        "limit_tokens": limit,
        "percent": percent,
        "model": spec.label,
        "model_id": spec.id,
        "source": source,
        "is_estimate": is_estimate,
        "prompt_tokens": used,
        "completion_tokens": int(usage.get("completion_tokens", 0)) if usage else 0,
        "total_tokens": int(usage.get("total_tokens", 0)) if usage else 0,
    }
