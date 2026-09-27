#!/usr/bin/env bun

import { parseQmdSmokeOutput } from "./qmd-smoke-output";

parseQmdSmokeOutput(await Bun.stdin.text());
