#!/usr/bin/env bash
# Runs the two benchmark tasks with and without lazy-agents and keeps the
# evidence of every run in <out>:
#   <run>.stream.jsonl   claude -p stream-json output (usage per message, cost)
#   <run>/session.jsonl  the session transcript, <run>/subagents/ the child ones
#   receipts.jsonl       one line per API request from bench/proxy.ts
#
#   bench/run.sh [rounds] [out]
#
# Every run uses the same working copy of bench/fixture so the prompt cache is
# comparable. Rounds alternate which version goes first. Raw files stay local
# (bench/out is git-ignored); bench/report.ts turns them into receipts that hold
# no prompts, file contents or headers.
set -euo pipefail

ROUNDS=${1:-4}
OUT=$(realpath -m "${2:-bench/out/$(date -u +%Y%m%dT%H%M%SZ)}")
MODEL=${BENCH_MODEL:-claude-opus-5-5}
PORT=${BENCH_PORT:-8790}
HERE=$(cd "$(dirname "$0")" && pwd)
OFF='{"enabledPlugins":{"lazy-agents@lazy-agents":false}}'

mkdir -p "$OUT"
WORK=$(mktemp -d)
cp "$HERE"/fixture/* "$WORK"/
trap 'kill "$PROXY" 2>/dev/null || true; rm -rf "$WORK"' EXIT

bun "$HERE/proxy.ts" "$PORT" "$OUT/receipts.jsonl" 2>"$OUT/proxy.log" &
PROXY=$!
sleep 1

declare -A PROMPT=(
  [seo]='Delegate an SEO review of ./index.html to the most suitable specialist subagent. Report every problem it finds as a bullet list. Do not change any file.'
  [idle]='Print the first line of ./notes.txt and nothing else.'
)

run() { # task version round
  local task=$1 version=$2 round=$3 name="$1-$2-$3" sid
  sid=$(cat /proc/sys/kernel/random/uuid)
  local settings=() ; [[ $version == off ]] && settings=(--settings "$OFF")
  echo "$name $sid" >&2
  (cd "$WORK" && ANTHROPIC_BASE_URL="http://127.0.0.1:$PORT" claude -p "${PROMPT[$task]}" \
    --session-id "$sid" --model "$MODEL" --output-format stream-json --verbose \
    --allowedTools "Read Glob Grep Agent mcp__lazy-agents__find_agent" \
    "${settings[@]}" >"$OUT/$name.stream.jsonl" 2>"$OUT/$name.stderr") || echo "$name failed" >&2
  local transcript
  transcript=$(find ~/.claude/projects -maxdepth 2 -name "$sid.jsonl" | head -1)
  mkdir -p "$OUT/$name"
  [[ -n $transcript ]] && cp "$transcript" "$OUT/$name/session.jsonl"
  [[ -n $transcript && -d ${transcript%.jsonl}/subagents ]] && cp -r "${transcript%.jsonl}/subagents" "$OUT/$name/"
  echo "{\"run\":\"$name\",\"task\":\"$task\",\"version\":\"$version\",\"round\":$round,\"session\":\"$sid\"}" >>"$OUT/runs.jsonl"
}

for round in $(seq 1 "$ROUNDS"); do
  if (( round % 2 )); then order=(off on); else order=(on off); fi
  for task in seo idle; do
    for version in "${order[@]}"; do run "$task" "$version" "$round"; done
  done
done
echo "$OUT"
