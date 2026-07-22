#!/usr/bin/env bash
# make-thin.sh — derive the "thin" deal artifact from the self-describing one.
#
# Goal: remove the ANSWERS, keep the DATA. The self-describing deal hands a model everything
# needed to answer "what's the score / next area / explain this element" WITHOUT the engine:
#   - the interpreted rollup:  scoring.overallScore (65.6) + scoring.overallRating ("Yellow")
#   - per-element framework text: definition, questions, and the 0-4 scoreDefinition rubric
# The thin deal strips exactly those, leaving the rep's real data (per-element score, responses,
# evidence, notes, metadata) plus scoring.elementScores. The engine/schema own the rest.
#
# NOTE (Phase-2 finding): we KEEP scoring.elementScores because the engine's `score` sums THAT
# rollup, not the source-of-truth per-element `qualification.<el>.score`. Removing the whole
# scoring block makes `score` return 0/Red. The engine should instead compute the rollup from
# per-element scores so the artifact need not carry it at all — a de-materialization target.
#
# Reproducible: regenerate any time from the self-describing source.
# Usage: make-thin.sh <self-describing.json> <thin-out.json>
set -euo pipefail
src="${1:?usage: make-thin.sh <src> <out>}"
out="${2:?usage: make-thin.sh <src> <out>}"

jq 'del(
      .scoring.overallScore,
      .scoring.overallRating,
      .scoring.previousElementScores,
      .qualification[].definition,
      .qualification[].questions,
      .qualification[].scoreDefinition
    )' "$src" > "$out"

echo "wrote $out"
