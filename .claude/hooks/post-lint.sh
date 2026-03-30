#!/usr/bin/env bash
set -euo pipefail

# PostToolUse hook: auto-format + lint with Biome after file edits
# Reads tool input from stdin, extracts file path, runs Biome on matching files.

input="$(cat)"
file="$(jq -r '.tool_input.file_path // .tool_input.path // empty' <<< "$input")"

# Skip if no file path or non-JS/TS file
case "$file" in
  *.ts|*.tsx|*.js|*.jsx|*.json) ;;
  *) exit 0 ;;
esac

# Skip if file doesn't exist (e.g. deleted)
[ -f "$file" ] || exit 0

# Phase 1: silent auto-fix (format + safe lint fixes)
npx @biomejs/biome check --write "$file" >/dev/null 2>&1 || true

# Phase 2: report remaining diagnostics to agent context
diag="$(npx @biomejs/biome check "$file" 2>&1 | head -30)" || true

if [ -n "$diag" ]; then
  jq -Rn --arg msg "$diag" '{
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: ("Biome lint issues:\n" + $msg)
    }
  }'
fi
