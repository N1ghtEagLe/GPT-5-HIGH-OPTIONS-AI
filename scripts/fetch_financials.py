#!/usr/bin/env python3
"""Quick probe for Polygon financials endpoint.

Fetches the most recent four quarterly filings for MSFT and prints the raw JSON
payload so we can inspect exactly what the API returns. Requires
POLYGON_API_KEY to be set in the environment.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - helper for local runs
    load_dotenv = None

BASE_URL = "https://api.polygon.io/vX/reference/financials"

def main() -> int:
    if load_dotenv:
        project_root = Path(__file__).resolve().parent.parent
        dotenv_path = project_root / ".env"
        if dotenv_path.exists():
            load_dotenv(dotenv_path=dotenv_path, override=False)
    else:
        print(
            "python-dotenv not installed; reading POLYGON_API_KEY from the current environment only.",
            file=sys.stderr,
        )

    api_key = os.getenv("POLYGON_API_KEY")
    if not api_key:
        print("POLYGON_API_KEY environment variable is required", file=sys.stderr)
        return 1

    params = {
        "ticker": "MSFT",
        "timeframe": "quarterly",
        "limit": "4",
        "sort": "period_of_report_date",
        "order": "desc",
        "apiKey": api_key,
    }

    url = f"{BASE_URL}?{urllib.parse.urlencode(params)}"

    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as err:
        print(f"HTTP error {err.code}: {err.reason}", file=sys.stderr)
        if err.fp:
            body = err.fp.read().decode("utf-8", errors="replace")
            print(body, file=sys.stderr)
        return 2
    except urllib.error.URLError as err:
        print(f"Request failed: {err.reason}", file=sys.stderr)
        return 3

    output_path = Path(__file__).resolve().parent / "msft-financials.json"
    output_path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")

    print(f"Saved response to {output_path}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
