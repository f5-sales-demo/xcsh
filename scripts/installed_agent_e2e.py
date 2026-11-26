#!/usr/bin/env python3
"""Run installed executable acceptance with private evidence and allowlisted receipts."""

import sys

from installed_agent_acceptance.runner import main

if __name__ == "__main__":
    sys.exit(main())
