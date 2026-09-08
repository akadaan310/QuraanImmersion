#!/usr/bin/env bash
# common.sh — shared state, logging and device identification.
#
# Sourced by every other lib and by bin/isnaad. Defines no side effects beyond
# creating $ISNAAD_HOME, so it is safe to source twice.
#
# Everything here works on a stock Termux install with no extra packages: only
# coreutils, getprop (part of Android, always on PATH) and the shell itself.
# `isnaad doctor` is what tells the operator to install the rest, and it cannot
# do that if sourcing this file already failed.

set -o pipefail

# ------------------------------------------------------------------ locations

: "${ISNAAD_HOME:=${XDG_STATE_HOME:-$HOME/.local/state}/isnaad}"
: "${ISNAAD_PORT:=4173}"
: "${ISNAAD_LOG:=$ISNAAD_HOME/bridge.log}"
: "${ISNAAD_PID:=$ISNAAD_HOME/bridge.pid}"
: "${ISNAAD_TOKEN_FILE:=$ISNAAD_HOME/bridge.token}"
: "${ISNAAD_ROOT_STATE:=$ISNAAD_HOME/root-state.env}"

# ISNAAD_REPO is the checkout this CLI belongs to: termux/lib/.. /..
ISNAAD_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ISNAAD_CLI_DIR="$(dirname "$ISNAAD_LIB_DIR")"
: "${ISNAAD_REPO:=$(dirname "$ISNAAD_CLI_DIR")}"
export ISNAAD_HOME ISNAAD_REPO ISNAAD_CLI_DIR ISNAAD_TOKEN_FILE

mkdir -p "$ISNAAD_HOME" 2>/dev/null || true

# --------------------------------------------------------------------- output

# Colour only when stdout is a terminal. Piping `isnaad doctor` into a paste
# should not produce escape soup.
if [ -t 1 ] && [ "${NO_COLOR:-}" = "" ]; then
  C_RESET=$'\033[0m'; C_DIM=$'\033[2m'; C_BOLD=$'\033[1m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'; C_CYAN=$'\033[36m'
else
  C_RESET=''; C_DIM=''; C_BOLD=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_CYAN=''
fi

say()  { printf '%s\n' "$*"; }
info() { printf '%s→%s %s\n' "$C_BLUE" "$C_RESET" "$*"; }
ok()   { printf '%s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
err()  { printf '%s✗%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; }
die()  { err "$*"; exit 1; }
step() { printf '\n%s%s%s\n' "$C_BOLD" "$*" "$C_RESET"; }
dim()  { printf '%s%s%s\n' "$C_DIM" "$*" "$C_RESET"; }

have() { command -v "$1" >/dev/null 2>&1; }

# Ask a yes/no question. Returns 0 for yes. `--yes` on the command line, or a
# non-interactive stdin, answers no — an unattended run must never silently
# agree to something that changes the device.
confirm() {
  local prompt="$1" reply
  if [ "${ISNAAD_ASSUME_YES:-0}" = "1" ]; then
    dim "  (--yes) $prompt"
    return 0
  fi
  if [ ! -t 0 ]; then
    warn "not a terminal; declining: $prompt"
    return 1
  fi
  printf '%s? %s [y/N] %s' "$C_YELLOW" "$prompt" "$C_RESET"
  read -r reply
  case "$reply" in [yY]|[yY][eE][sS]) return 0 ;; *) return 1 ;; esac
}

# ------------------------------------------------------------------- identity

# getprop is part of Android, not of Termux, and is always present. Guard it
# anyway so this file can be sourced on a desktop for development.
prop() {
  if have getprop; then getprop "$1" 2>/dev/null; else printf ''; fi
}

is_termux()  { case "${PREFIX:-}" in *com.termux*) return 0 ;; *) return 1 ;; esac; }
is_android() { [ -n "$(prop ro.build.version.sdk)" ]; }

android_release() { prop ro.build.version.release; }
android_sdk()     { prop ro.build.version.sdk; }
device_model()    { prop ro.product.model; }
device_maker()    { prop ro.product.manufacturer; }
device_soc()      { local soc; soc="$(prop ro.soc.model)"; [ -n "$soc" ] || soc="$(prop ro.board.platform)"; printf '%s' "$soc"; }

is_samsung() {
  case "$(device_maker | tr '[:upper:]' '[:lower:]')" in samsung) return 0 ;; *) return 1 ;; esac
}

# One UI's version lives in ro.build.version.oneui on recent builds as an
# integer like 80000 (= One UI 8.0). Older builds only carry the SEP version,
# which tracks it but is not the same number, so both are reported rather than
# guessed at.
oneui_version() {
  local raw
  raw="$(prop ro.build.version.oneui)"
  if [ -n "$raw" ] && [ "$raw" -eq "$raw" ] 2>/dev/null; then
    printf '%s.%s' "$(( raw / 10000 ))" "$(( (raw / 100) % 100 ))"
    return 0
  fi
  raw="$(prop ro.build.version.sep)"
  [ -n "$raw" ] && printf 'SEP %s' "$raw"
}

# Is this the target this edition was built for: Android 16 (API 36) or newer?
is_android_16_plus() {
  local sdk; sdk="$(android_sdk)"
  [ -n "$sdk" ] && [ "$sdk" -ge 36 ] 2>/dev/null
}

cpu_arch() { uname -m; }

# ---------------------------------------------------------------------- bridge

bridge_token() {
  if [ -n "${ISNAAD_BRIDGE_TOKEN:-}" ]; then printf '%s' "$ISNAAD_BRIDGE_TOKEN"; return 0; fi
  [ -r "$ISNAAD_TOKEN_FILE" ] && tr -d '\r\n' < "$ISNAAD_TOKEN_FILE"
}

bridge_url() { printf 'http://127.0.0.1:%s' "$ISNAAD_PORT"; }

bridge_running() {
  [ -r "$ISNAAD_PID" ] || return 1
  local pid; pid="$(cat "$ISNAAD_PID" 2>/dev/null)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

# Talk to the bridge through ctl.mjs, with the token and URL already in the
# environment. Every subcommand that needs the running bridge goes through this.
ctl() {
  ISNAAD_BRIDGE_URL="$(bridge_url)" \
  ISNAAD_BRIDGE_TOKEN="$(bridge_token)" \
  ISNAAD_TOKEN_FILE="$ISNAAD_TOKEN_FILE" \
    node "$ISNAAD_CLI_DIR/bridge/ctl.mjs" "$@"
}

require_bridge() {
  bridge_running && return 0
  err "الجسر غير مشغّل — no bridge is running on port $ISNAAD_PORT."
  say "  start it with:  ${C_BOLD}isnaad up${C_RESET}"
  exit 1
}
