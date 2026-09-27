#!/usr/bin/env python3
"""Compatibility shim for Aurora Coletor v2.

Use aurora_collector.py directly for new installations.
"""
from aurora_collector import main

if __name__ == "__main__":
    raise SystemExit(main())
