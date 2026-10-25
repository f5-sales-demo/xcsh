"""Load qualification fixtures from their retained script locations."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "scripts/qualification-cleanroom"
for directory in (SOURCE, SOURCE / "owned-phone-client"):
    if directory.is_dir():
        sys.path.insert(0, str(directory))
