"""DeepSeek 聊天模型：思考模式下向 API 回传 reasoning_content。"""

from __future__ import annotations

from typing import Any

from langchain_core.language_models import LanguageModelInput
from langchain_core.messages import AIMessage
from langchain_deepseek import ChatDeepSeek

from backend.reasoning_messages import extract_reasoning_content


class DiaryMasterChatDeepSeek(ChatDeepSeek):
    """
    在思考模式 + 工具调用时，DeepSeek 要求带 tool_calls 的 assistant 消息
    必须把 reasoning_content 一并送回 API；基类序列化会漏掉该字段。
    """

    def _get_request_payload(
        self,
        input_: LanguageModelInput,
        *,
        stop: list[str] | None = None,
        **kwargs: Any,
    ) -> dict:
        """组装 API 请求体，并为带 tool_calls 的 assistant 消息补上 reasoning_content。"""
        lc_messages = self._convert_input(input_).to_messages()
        payload = super()._get_request_payload(input_, stop=stop, **kwargs)
        api_messages = payload.get("messages") or []
        if len(api_messages) != len(lc_messages):
            return payload
        for lc_msg, api_msg in zip(lc_messages, api_messages):
            if not isinstance(lc_msg, AIMessage) or api_msg.get("role") != "assistant":
                continue
            reasoning = extract_reasoning_content(lc_msg)
            if not reasoning:
                continue
            if api_msg.get("tool_calls") or lc_msg.tool_calls:
                api_msg["reasoning_content"] = reasoning
        return payload
