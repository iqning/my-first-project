"""模型注册表：产品侧 curated 列表（非厂商 GET /models 透传）。"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

CONTEXT_1M = 1_048_576
MAX_OUTPUT_384K = 393_216


@dataclass(frozen=True)
class ModelSpec:
    """单个模型的静态配置（API id、展示名、上下文上限等）。"""

    id: str
    label: str
    provider: str
    langchain_model: str
    api_key_env: str
    context_limit: int
    max_output_tokens: int
    supports_thinking: bool
    is_default: bool = False

    def to_public_dict(self) -> dict[str, Any]:
        """返回可暴露给前端的字段（不含 api_key_env）。"""
        return {
            "id": self.id,
            "label": self.label,
            "provider": self.provider,
            "context_limit": self.context_limit,
            "max_output_tokens": self.max_output_tokens,
            "supports_thinking": self.supports_thinking,
            "is_default": self.is_default,
        }


MODELS: dict[str, ModelSpec] = {
    "deepseek-v4-flash": ModelSpec(
        id="deepseek-v4-flash",
        label="V4 Flash",
        provider="deepseek",
        langchain_model="deepseek:deepseek-v4-flash",
        api_key_env="DEEPSEEK_API_KEY",
        context_limit=CONTEXT_1M,
        max_output_tokens=MAX_OUTPUT_384K,
        supports_thinking=True,
        is_default=True,
    ),
    "deepseek-v4-pro": ModelSpec(
        id="deepseek-v4-pro",
        label="V4 Pro",
        provider="deepseek",
        langchain_model="deepseek:deepseek-v4-pro",
        api_key_env="DEEPSEEK_API_KEY",
        context_limit=CONTEXT_1M,
        max_output_tokens=MAX_OUTPUT_384K,
        supports_thinking=True,
        is_default=False,
    ),
}


def list_models() -> list[dict[str, Any]]:
    """列出所有可用模型的公开信息。"""
    return [m.to_public_dict() for m in MODELS.values()]


def default_model_id() -> str:
    """返回标记为 is_default 的模型 id。"""
    for m in MODELS.values():
        if m.is_default:
            return m.id
    return next(iter(MODELS))


def get_model(model_id: str) -> ModelSpec:
    """按 id 取模型配置；未知 id 抛 ValueError。"""
    if model_id not in MODELS:
        raise ValueError(f"未知模型: {model_id}")
    return MODELS[model_id]


def deepseek_api_model_name(spec: ModelSpec) -> str:
    """DeepSeek API 接受的模型名（去掉 langchain 的 provider 前缀）。"""
    name = spec.langchain_model
    if name.startswith("deepseek:"):
        return name.split(":", 1)[1]
    return name


def validate_model_id(model_id: str | None) -> str:
    """校验并规范化 model_id，空则用默认模型。"""
    mid = (model_id or "").strip() or default_model_id()
    get_model(mid)
    return mid


def resolve_api_key(spec: ModelSpec) -> str:
    """按模型配置解析 API Key（当前均为 DeepSeek 同一密钥）。"""
    from backend.config import get_api_key

    if spec.api_key_env == "DEEPSEEK_API_KEY":
        key = get_api_key()
        if not key:
            raise RuntimeError(
                "未配置 DeepSeek API Key，请点击顶栏「设置」填写并保存"
            )
        return key
    key = os.environ.get(spec.api_key_env, "").strip()
    if not key:
        raise RuntimeError(f"未设置环境变量 {spec.api_key_env}")
    return key
