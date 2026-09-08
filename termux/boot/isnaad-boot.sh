#!/usr/bin/env bash
# isnaad-boot.sh — started by Termux:Boot after the device finishes booting.
#
# Link it into place with:  ln -sf .../termux/boot/isnaad-boot.sh ~/.termux/boot/isnaad
# (the installer offers to do this).
#
# Termux:Boot runs this in a bare environment with no terminal attached, so:
#   · a wake lock is taken FIRST — without it Android suspends this script
#     before Node has finished starting;
#   · no browser is opened, because there is no user gesture at boot and every
#     modern browser refuses to open an AudioContext without one. The bridge is
#     simply made ready; `isnaad open` from a terminal completes the session.
#   · output goes to the log, since nothing is watching stdout.

set -uo pipefail

REPO="${ISNAAD_REPO:-$HOME/QuraanImmersion}"
CLI="$REPO/termux/bin/isnaad"

command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock

[ -x "$CLI" ] || { echo "isnaad-boot: no CLI at $CLI" >&2; exit 1; }

# `up` would try to open a browser; start the bridge alone instead.
# shellcheck source=../lib/common.sh
. "$REPO/termux/lib/common.sh"
. "$REPO/termux/lib/root.sh"
. "$REPO/termux/lib/browser.sh"
. "$REPO/termux/lib/serve.sh"

exec >> "$ISNAAD_HOME/boot.log" 2>&1
printf '\n=== boot %s ===\n' "$(date)"

ensure_build
bridge_start

# If the device is rooted and a takeover was applied before the reboot, the
# settings survived (they are system settings) but the doze allowlist did not
# on some builds. Re-assert only that, and only if a takeover is on record.
if [ -s "$ISNAAD_ROOT_STATE" ] && root_available; then
  for package in com.termux com.termux.api com.termux.boot; do
    as_root "dumpsys deviceidle whitelist +$package" >/dev/null 2>&1
  done
  echo "re-asserted the battery-optimisation allowlist"
fi
