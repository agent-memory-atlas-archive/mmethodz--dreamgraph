"""DreamGraph analytics package — read-only inspection of instance data."""

import json
from pathlib import Path


def _distribution_version() -> str:
    """Share the daemon's package version without maintaining another pin."""
    try:
        package = Path(__file__).resolve().parents[2] / "package.json"
        version = json.loads(package.read_text(encoding="utf-8-sig")).get("version")
        if isinstance(version, str) and version:
            return version
    except (OSError, ValueError):
        pass
    return "0.0.0-unknown"


__version__ = _distribution_version()
