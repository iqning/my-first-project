"""推荐启动方式：在项目根目录执行 python run.py"""

from __future__ import annotations

import os
from pathlib import Path

_ROOT = Path(__file__).resolve().parent
os.chdir(_ROOT)

if __name__ == "__main__":
    import uvicorn

    from backend.config import HOST, PORT

    print(f"DiaryMaster: http://{HOST}:{PORT}")
    uvicorn.run(
        "backend.main:app",
        host=HOST,
        port=PORT,
        reload=True,
        reload_dirs=[str(_ROOT)],
    )
