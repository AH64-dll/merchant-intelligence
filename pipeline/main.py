#!/usr/bin/env python3
"""Thin wrapper: python main.py --config config.yaml run --resume"""
import sys

from merchant_intel.cli import main

if __name__ == "__main__":
    sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
    raise SystemExit(main(sys.argv[1:]))
