"""讀取演算法參數：預設值與前端共用 repo 根目錄的 shared/params.default.json。"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

Params = dict[str, Any]

DEFAULT_PATH = Path(__file__).resolve().parents[2] / "shared" / "params.default.json"


def _merge(base: dict, over: dict) -> dict:
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            _merge(base[k], v)
        else:
            base[k] = v
    return base


def load_params(overrides: dict | None = None, path: Path | str | None = None) -> Params:
    """讀預設參數並套用覆寫，例如 load_params({"events": {"brakeThreshold": 1.2}})。"""
    with open(path or DEFAULT_PATH, encoding="utf-8") as f:
        p = json.load(f)
    return _merge(p, copy.deepcopy(overrides or {}))
