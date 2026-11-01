#!/usr/bin/env python3
"""Writes the API schema to ui/src/api/openapi.json. Run through `npm run
gen:api`, which also regenerates the TypeScript types from it."""
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "ui" / "src" / "api" / "openapi.json"

sys.path.insert(0, str(ROOT))
os.environ["SONORUS_DATA_DIR"] = tempfile.mkdtemp(prefix="sonorus-openapi-")

import tests.conftest  # noqa: E402,F401  stubs the ML libraries where they are not installed
from app.api.openapi_schema import build_schema  # noqa: E402

OUTPUT.write_text(json.dumps(build_schema(), indent=2, sort_keys=True) + "\n", encoding="utf-8")
print(f"Wrote {OUTPUT.relative_to(ROOT)}")
