"""应用路径、监听地址与 DeepSeek API Key 的读取/保存。"""

from __future__ import annotations

import os
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent.parent
WORKSPACE = APP_ROOT / "workspace"
WEB_DIR = APP_ROOT / "web"

ENV_API_KEY = "DEEPSEEK_API_KEY"
# 进程启动时继承的系统 DEEPSEEK_API_KEY（settings 覆盖前的快照，供无本机设置时回退）
_SYSTEM_API_KEY_FALLBACK = os.environ.get(ENV_API_KEY, "").strip()
HOST = os.environ.get("DIARYMASTER_HOST", "127.0.0.1")
PORT = int(os.environ.get("DIARYMASTER_PORT", "8765"))


def _disk_api_key() -> str:
    """从 data/user_settings.json 读取 DeepSeek API Key。"""
    from backend.user_settings import load_settings

    return (load_settings().get("deepseek_api_key") or "").strip()


def sync_api_key_to_env() -> None:
    """
    先读 data/user_settings.json：有则覆盖进程内 DEEPSEEK_API_KEY；
    无则回退到进程启动时继承的系统环境变量（若有），否则移除该变量。
    """
    disk = _disk_api_key()
    if disk:
        os.environ[ENV_API_KEY] = disk
    elif _SYSTEM_API_KEY_FALLBACK:
        os.environ[ENV_API_KEY] = _SYSTEM_API_KEY_FALLBACK
    else:
        os.environ.pop(ENV_API_KEY, None)


def bootstrap_api_key_from_disk() -> None:
    """应用启动时同步本机设置到环境变量。"""
    sync_api_key_to_env()


def get_api_key() -> str:
    """同步 settings 后，从进程环境变量 DEEPSEEK_API_KEY 读取（供 Agent 使用）。"""
    sync_api_key_to_env()
    return os.environ.get(ENV_API_KEY, "").strip()


def set_api_key(key: str) -> None:
    """仅写入 data/user_settings.json，再同步到环境变量。"""
    from backend.user_settings import load_settings, save_settings

    cleaned = (key or "").strip()
    data = load_settings()
    if cleaned:
        data["deepseek_api_key"] = cleaned
    else:
        data.pop("deepseek_api_key", None)
    save_settings(data)
    sync_api_key_to_env()


def api_key_status() -> dict[str, str | bool]:
    """设置页展示：仅反映 user_settings.json 中是否已保存密钥。"""
    from backend.user_settings import mask_api_key

    disk = _disk_api_key()
    return {
        "configured": bool(disk),
        "masked": mask_api_key(disk) if disk else "",
        "provider": "deepseek",
    }
