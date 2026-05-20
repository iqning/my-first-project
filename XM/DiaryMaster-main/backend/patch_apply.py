"""
笔记局部编辑：把 old_string 在正文中唯一替换为 new_string。

供 agent.edit_file 使用；匹配失败抛 PatchError，调用方不写盘。
"""

from __future__ import annotations


class PatchError(ValueError):
    """补丁无法安全应用（未找到、多处匹配、old 为空等）。"""


def normalize_newlines(text: str) -> str:
    """统一为 \\n，避免 Windows \\r\\n 导致模型复制的 old_string 对不上。"""
    return text.replace("\r\n", "\n").replace("\r", "\n")


def apply_unique_replace(content: str, old_string: str, new_string: str) -> str:
    """
    将 content 中唯一出现的 old_string 替换为 new_string。

    匹配前统一换行；0 次或多次匹配时抛 PatchError，不修改 content。
    """
    if not old_string:
        raise PatchError("old_string 不能为空；新建文件请用 write_file")

    normalized = normalize_newlines(content)
    old = normalize_newlines(old_string)
    new = normalize_newlines(new_string)

    if old == new:
        raise PatchError("old_string 与 new_string 相同，无需修改")

    count = normalized.count(old)
    if count == 0:
        preview = normalized[:200].replace("\n", "\\n")
        raise PatchError(
            "未找到 old_string。请用 read_file 核对原文（含换行、空格、标点），"
            f"或加长 old_string 以唯一定位。文件开头预览: {preview!r}"
        )
    if count > 1:
        raise PatchError(
            f"old_string 在文件中出现 {count} 次，无法唯一定位。"
            "请加长 old_string，使其在文件中只出现一次。"
        )

    return normalized.replace(old, new, 1)
