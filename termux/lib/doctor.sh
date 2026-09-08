#!/usr/bin/env bash
# doctor.sh — is this phone able to run the engine, and if not, what exactly is
# missing.
#
# The engine asks more of a phone than a web page usually does: a WebGL2 context
# with float textures, an AudioContext with a live AnalyserNode, a process that
# survives the screen going off, and enough thermal headroom to hold a frame
# budget for the length of a recitation. Each of those fails differently and
# each has a different fix, so the doctor checks them separately and prints the
# fix next to the failure rather than a summary at the end.
#
# It changes nothing. `isnaad setup` is what installs; this only reports.

ISNAAD_DOCTOR_FAILURES=0
ISNAAD_DOCTOR_WARNINGS=0

check_ok()   { ok "$*"; }
check_warn() { ISNAAD_DOCTOR_WARNINGS=$((ISNAAD_DOCTOR_WARNINGS + 1)); warn "$*"; }
check_fail() { ISNAAD_DOCTOR_FAILURES=$((ISNAAD_DOCTOR_FAILURES + 1)); err "$*"; }

# The packages the CLI actually uses, and what breaks without each.
# Format: package|binary|why
ISNAAD_PACKAGES=(
  "nodejs-lts|node|builds the app and runs the bridge — nothing works without it"
  "git|git|pulling updates to this checkout"
  "termux-api|termux-toast|the device ops the page calls (vibrate, battery, TTS, wake lock)"
  "python|python|the SANDBOX-LOWER hyper-math runtime (tri-reality-os)"
  "openssl|openssl|TLS for the reciter CDNs during the build"
)

doctor_platform() {
  step "المنصّة — platform"

  if is_termux; then
    check_ok "Termux  ($PREFIX)"
  else
    check_warn "not running under Termux — \$PREFIX is '${PREFIX:-unset}'"
    dim "     the CLI still works for local development, but every device op will be absent"
  fi

  if is_android; then
    local release sdk
    release="$(android_release)"; sdk="$(android_sdk)"
    if is_android_16_plus; then
      check_ok "Android $release (API $sdk) — this is the target of this edition"
    else
      check_warn "Android $release (API $sdk) — this edition targets Android 16 (API 36)"
      dim "     everything below still applies; the Android 16 specifics simply do not"
    fi
  else
    check_warn "not Android — device identification and every intent is unavailable"
  fi

  local arch; arch="$(cpu_arch)"
  case "$arch" in
    aarch64|arm64) check_ok "architecture $arch" ;;
    armv7l|arm)    check_warn "32-bit ARM ($arch) — Node is available but numpy wheels often are not" ;;
    *)             check_warn "architecture $arch — untested for this edition" ;;
  esac
}

doctor_device() {
  is_android || return 0
  step "الجهاز — device"
  say "  model       $(device_model)"
  say "  maker       $(device_maker)"
  say "  chipset     $(device_soc)"
  say "  kernel      $(uname -r)"

  if is_samsung; then
    local oneui; oneui="$(oneui_version)"
    say "  One UI      ${oneui:-unknown}"
    say ""
    step "خصوصيات سامسونج — the Samsung-specific parts"

    if package_installed "$BROWSER_SAMSUNG"; then
      check_ok "Samsung Internet is installed — the bridge will target it"
      dim "     WebGL2 is enabled by default; if a scene is black, check"
      dim "     Settings → Useful features → Labs, and disable any 'lite' data saver."
    else
      check_warn "Samsung Internet is not installed; falling back to $(browser_label "$(choose_browser)")"
    fi

    # This is the single most common way a session dies on a Galaxy: Device Care
    # decides Termux is idle and stops it, taking the bridge and the audio with it.
    say ""
    say "  ${C_BOLD}Device Care will stop Termux unless it is exempted.${C_RESET}"
    if root_available; then
      dim "     root is available — 'isnaad root takeover' handles this for you"
    else
      say "     Settings → Battery → Background usage limits"
      say "       · remove Termux from 'Sleeping apps' and 'Deep sleeping apps'"
      say "     Settings → Apps → Termux → Battery → Unrestricted"
    fi

    # Adaptive display. Without root the operator can only set the whole-system
    # motion smoothness, which is still worth saying because a 60 Hz panel makes
    # every scene look like it is dropping frames when it is not.
    say ""
    if root_available; then
      dim "  Adaptive display: 'isnaad root takeover' pins min/peak refresh rate."
    else
      say "  Settings → Display → Motion smoothness → Adaptive (for 120 Hz)"
    fi
  fi
}

doctor_packages() {
  step "الحزم — packages"
  local entry package binary why
  for entry in "${ISNAAD_PACKAGES[@]}"; do
    IFS='|' read -r package binary why <<< "$entry"
    if have "$binary"; then
      case "$binary" in
        node)   check_ok "$package  $(node --version)" ;;
        python) check_ok "$package  $(python --version 2>&1 | cut -d' ' -f2)" ;;
        git)    check_ok "$package  $(git --version | cut -d' ' -f3)" ;;
        *)      check_ok "$package" ;;
      esac
    elif [ "$binary" = "node" ]; then
      check_fail "$package is missing — $why"
      dim "     pkg install $package"
    else
      check_warn "$package is missing — $why"
      dim "     pkg install $package"
    fi
  done

  if have node; then
    local major; major="$(node --version | sed 's/^v//' | cut -d. -f1)"
    if [ "$major" -lt 20 ] 2>/dev/null; then
      check_fail "Node $major is too old — the bridge needs 20+ (fetch, node:test, crypto.crc32)"
    fi
  fi

  # Termux:API is two halves and only one of them is a package. A missing app
  # half is the confusing case: the binaries exist, they just hang or return
  # nothing, so it is worth distinguishing here.
  if have termux-toast && ! package_installed com.termux.api; then
    check_warn "the termux-api package is installed but the Termux:API app is not"
    dim "     install Termux:API from the same source as Termux (F-Droid), or every"
    dim "     device op will hang and then return nothing"
  fi
}

doctor_project() {
  step "المشروع — project"
  if [ -f "$ISNAAD_REPO/package.json" ]; then
    check_ok "checkout at $ISNAAD_REPO"
  else
    check_fail "no package.json at $ISNAAD_REPO — is this the repository root?"
    return
  fi
  if [ -d "$ISNAAD_REPO/node_modules" ]; then
    check_ok "dependencies installed"
  else
    check_warn "node_modules is absent — run 'isnaad setup' (npm ci)"
  fi
  if [ -f "$ISNAAD_REPO/dist/index.html" ]; then
    check_ok "a build exists at dist/"
  else
    check_warn "no build yet — 'isnaad up' will make one"
  fi
  if [ -d "$ISNAAD_REPO/tri-reality-os/sandbox-lower" ]; then
    if have python && python -c 'import numpy' 2>/dev/null; then
      check_ok "SANDBOX-LOWER: numpy present"
    else
      check_warn "SANDBOX-LOWER needs numpy — pkg install python-numpy"
      dim "     (the prebuilt wheel; 'pip install numpy' compiles from source on ARM64"
      dim "      and typically fails or takes the better part of an hour)"
    fi
  fi
}

doctor_runtime() {
  step "التشغيل — runtime"

  if bridge_running; then
    check_ok "the bridge is running on port $ISNAAD_PORT (pid $(cat "$ISNAAD_PID"))"
    local health
    health="$(ctl health 2>/dev/null)" && printf '%s\n' "$health" | sed 's/^/    /'
  else
    dim "  no bridge running — 'isnaad up' starts one"
  fi

  # A wake lock is what stops the CPU sleeping between ayat. It is cheap to
  # check and it is the difference between audio that continues with the screen
  # off and audio that stutters to a halt.
  if have termux-wake-lock; then
    dim "  wake lock is available (isnaad up takes one automatically)"
  fi

  if [ -s "$ISNAAD_ROOT_STATE" ]; then
    check_ok "root takeover is active ($(wc -l < "$ISNAAD_ROOT_STATE" | tr -d ' ') settings changed)"
  elif root_available; then
    dim "  root is available but no takeover is applied — 'isnaad root takeover'"
  else
    dim "  no root — everything except the tuning in 'isnaad root' works unprivileged"
  fi
}

doctor_report() {
  say ""
  if [ "$ISNAAD_DOCTOR_FAILURES" -gt 0 ]; then
    err "$ISNAAD_DOCTOR_FAILURES blocking problem(s), $ISNAAD_DOCTOR_WARNINGS warning(s)"
    return 1
  fi
  if [ "$ISNAAD_DOCTOR_WARNINGS" -gt 0 ]; then
    warn "$ISNAAD_DOCTOR_WARNINGS warning(s), nothing blocking"
    return 0
  fi
  ok "كل شيء جاهز — everything checks out"
}

doctor_run() {
  doctor_platform
  doctor_device
  doctor_packages
  doctor_project
  doctor_runtime
  doctor_report
}
