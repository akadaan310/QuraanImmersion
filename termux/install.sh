#!/usr/bin/env bash
# install.sh — one-shot Termux bootstrap.
#
#   cd ~ && git clone <repo> QuraanImmersion
#   bash QuraanImmersion/termux/install.sh
#
# Installs the packages, installs the npm dependencies, links `isnaad` onto PATH
# and runs the doctor. Safe to re-run: every step is idempotent.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(dirname "$HERE")"
. "$HERE/lib/common.sh"

step "محرك الإسناد — Termux install · Samsung 16 Edition"
say "  repo   $REPO"
say "  device $(device_maker) $(device_model)  ·  Android $(android_release) (API $(android_sdk))"
say ""

# 1 ── packages
if is_termux; then
  info "pkg update"
  pkg update -y >/dev/null 2>&1 || warn "pkg update reported an error; continuing"
  info "pkg install nodejs-lts git termux-api python openssl"
  pkg install -y nodejs-lts git termux-api python openssl || die "pkg install failed"
  # numpy is only needed by tri-reality-os/sandbox-lower. The prebuilt wheel is
  # the only sane route on ARM64 — pip compiles from source and usually fails.
  pkg install -y python-numpy || warn "python-numpy unavailable in this mirror (SANDBOX-LOWER will not run)"
else
  warn "not Termux — skipping pkg. Node 20+, git and python must already be installed."
fi

have node || die "node is still missing; nothing else can proceed"

# 2 ── the shebang question. Termux has no /usr/bin/env; `termux-exec` (present
#      by default) rewrites the shebang at exec time. If it is not active, fix
#      the scripts once rather than leaving the operator with "no such file".
if ! "$HERE/bin/isnaad" --version >/dev/null 2>&1; then
  if have termux-fix-shebang; then
    warn "termux-exec is not intercepting the shebang; rewriting it"
    termux-fix-shebang "$HERE/bin/isnaad" "$HERE"/lib/*.sh
  else
    warn "could not run bin/isnaad directly — invoke it as: bash $HERE/bin/isnaad"
  fi
fi

# 3 ── dependencies
info "npm install (several minutes on a phone; leave the screen on)"
( cd "$REPO" && { [ -f package-lock.json ] && npm ci --no-audit --no-fund || npm install --no-audit --no-fund; } ) \
  || die "npm install failed"

# 4 ── PATH. $PREFIX/bin is on PATH in Termux; a symlink there is the whole of
#      "installing" a CLI. Elsewhere, ~/.local/bin.
BIN_DIR="${PREFIX:+$PREFIX/bin}"
[ -n "$BIN_DIR" ] && [ -w "$BIN_DIR" ] || BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
ln -sf "$HERE/bin/isnaad" "$BIN_DIR/isnaad"
ok "linked $BIN_DIR/isnaad"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) warn "$BIN_DIR is not on PATH — add it:  echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.bashrc" ;;
esac

# 5 ── optional: start on boot. Termux:Boot runs anything in ~/.termux/boot.
if [ -d "$HOME/.termux/boot" ] || confirm "start the bridge automatically at boot (needs the Termux:Boot app)?"; then
  mkdir -p "$HOME/.termux/boot"
  ln -sf "$HERE/boot/isnaad-boot.sh" "$HOME/.termux/boot/isnaad"
  chmod +x "$HERE/boot/isnaad-boot.sh"
  ok "boot hook linked → ~/.termux/boot/isnaad"
  dim "  install Termux:Boot from the same source as Termux and open it once."
fi

say ""
"$HERE/bin/isnaad" doctor
say ""
ok "تم — installed."
say ""
say "  ${C_BOLD}isnaad up${C_RESET}                 build, serve, and open the browser"
say "  ${C_BOLD}isnaad root takeover${C_RESET}      if this device is rooted"
say "  ${C_BOLD}isnaad play 18 60${C_RESET}         drive the open page from this terminal"
