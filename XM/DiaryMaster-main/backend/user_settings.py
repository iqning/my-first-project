"""本机用户设置（存 data/user_settings.json，已在 .gitignore 的 data/ 下）。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from backend.config import APP_ROOT

SETTINGS_PATH = APP_ROOT / "data" / "user_settings.json"


def _ensure_dir() -> None:
    """确保 data/ 目录存在。"""
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)


def load_settings() -> dict[str, Any]:
    """读取本机 user_settings.json；不存在或损坏时返回空 dict。"""
    if not SETTINGS_PATH.is_file():
        return {}
    try:
        data = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def save_settings(data: dict[str, Any]) -> None:
    """覆盖写入本机 user_settings.json。"""
    _ensure_dir()
    SETTINGS_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def mask_api_key(key: str) -> str:
    """脱敏 API Key（如 sk-…abcd），供设置页展示。"""
    k = (key or "").strip()
    if not k:
        return ""
    if len(k) <= 8:
        return "*" * len(k)
    return f"{k[:3]}…{k[-4:]}"
