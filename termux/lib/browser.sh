#!/usr/bin/env bash
# browser.sh — Termux → browser.
#
# Termux is a terminal in a sandbox; the browser is a different app in a
# different sandbox. The only supported way across is an Android intent, and
# there are exactly three ways to send one, in descending order of politeness:
#
#   1. `termux-open-url`  — Termux:API. Uses the system chooser, respects the
#                           default browser, needs no permissions beyond the API
#                           app itself.
#   2. `am start`         — the activity manager, invoked directly. Present on
#                           every Android build, needs no extra package, and can
#                           name a specific browser component.
#   3. `su -c am start`   — the same thing as root, for the case where a
#                           background-start restriction blocks (2).
#
# Android 10 introduced the background-activity-start restriction, and every
# release since has tightened it. On Android 16 / One UI 8, `am start` from a
# Termux session whose app is not in the foreground is frequently dropped
# silently — no error, no window. That is why `open_url` verifies rather than
# assumes, and says so when it cannot tell.

# The browsers worth naming explicitly, by package. Order is deliberate:
# Samsung Internet first on a Samsung device, because it is the one with vendor
# GPU driver integration on Exynos/Snapdragon-for-Galaxy panels and it is what
# the device owner is already signed into.
BROWSER_SAMSUNG='com.sec.android.app.sbrowser'
BROWSER_CHROME='com.android.chrome'
BROWSER_FIREFOX='org.mozilla.firefox'
BROWSER_EDGE='com.microsoft.emmx'

package_installed() {
  local package="$1"
  if have pm; then
    pm list packages 2>/dev/null | grep -q "^package:${package}$" && return 0
  fi
  # `pm` is restricted for some shell users on newer builds; the package's data
  # directory existing is a reliable second opinion.
  [ -d "/data/data/$package" ] && return 0
  return 1
}

# Echo the package of the browser to use, honouring an explicit override.
choose_browser() {
  local requested="${ISNAAD_BROWSER:-}"
  case "$requested" in
    samsung|sbrowser) printf '%s' "$BROWSER_SAMSUNG"; return 0 ;;
    chrome)           printf '%s' "$BROWSER_CHROME";  return 0 ;;
    firefox)          printf '%s' "$BROWSER_FIREFOX"; return 0 ;;
    edge)             printf '%s' "$BROWSER_EDGE";    return 0 ;;
    default|system)   printf ''; return 0 ;;
    ?*)               printf '%s' "$requested"; return 0 ;;   # a raw package name
  esac

  if is_samsung && package_installed "$BROWSER_SAMSUNG"; then
    printf '%s' "$BROWSER_SAMSUNG"; return 0
  fi
  local candidate
  for candidate in "$BROWSER_CHROME" "$BROWSER_SAMSUNG" "$BROWSER_FIREFOX" "$BROWSER_EDGE"; do
    package_installed "$candidate" && { printf '%s' "$candidate"; return 0; }
  done
  printf ''                                     # let the system chooser decide
}

browser_label() {
  case "$1" in
    "$BROWSER_SAMSUNG") printf 'Samsung Internet' ;;
    "$BROWSER_CHROME")  printf 'Chrome' ;;
    "$BROWSER_FIREFOX") printf 'Firefox' ;;
    "$BROWSER_EDGE")    printf 'Edge' ;;
    '')                 printf 'the system default browser' ;;
    *)                  printf '%s' "$1" ;;
  esac
}

# Open a URL in the chosen browser. Returns 0 only when something actually
# accepted the intent — a start that Android dropped is a failure the operator
# needs to hear about, because the alternative is staring at a terminal that
# says "opened" next to a phone that did nothing.
open_url() {
  local url="$1" package result
  package="$(choose_browser)"

  info "فتح المتصفح — opening $(browser_label "$package")"

  # 1 ── Termux:API. Cannot target a package, so only used when the operator did
  #      not ask for a specific browser.
  if [ -z "$package" ] && have termux-open-url; then
    if termux-open-url "$url" 2>/dev/null; then
      ok "handed to the system chooser via termux-open-url"
      return 0
    fi
    warn "termux-open-url failed; falling back to am"
  fi

  # 2 ── The activity manager. `-a VIEW -d <url>`, optionally pinned to a
  #      package. `am` writes its complaints to stdout, not stderr, and exits 0
  #      even when the start was refused, so the output is what has to be read.
  if have am; then
    if [ -n "$package" ]; then
      result="$(am start -a android.intent.action.VIEW -d "$url" -p "$package" 2>&1)"
    else
      result="$(am start -a android.intent.action.VIEW -d "$url" 2>&1)"
    fi
    case "$result" in
      *Error*|*error*|*Exception*|*"does not exist"*)
        warn "am refused the start:"
        printf '%s\n' "$result" | sed 's/^/    /'
        ;;
      *)
        ok "intent delivered"
        return 0
        ;;
    esac
  fi

  # 3 ── Root. The background-activity-start restriction does not apply to a
  #      start issued by the shell user with uid 0.
  if root_available; then
    info "retrying the start as root (background-start restriction)"
    local intent="am start -a android.intent.action.VIEW -d '$url'"
    [ -n "$package" ] && intent="$intent -p '$package'"
    if as_root "$intent" >/dev/null 2>&1; then
      ok "intent delivered as root"
      return 0
    fi
  fi

  err "could not open a browser automatically."
  say ""
  say "  Open this by hand — it is the whole address, token included:"
  say ""
  say "    ${C_BOLD}${url}${C_RESET}"
  say ""
  if have termux-clipboard-set; then
    printf '%s' "$url" | termux-clipboard-set 2>/dev/null && dim "  (copied to the clipboard)"
  fi
  return 1
}

# Bring Termux itself back to the foreground. Used before an `am start`, because
# a foreground app is allowed to start an activity and a backgrounded one is not
# — this converts an intermittent silent failure into a reliable success.
foreground_termux() {
  have am || return 1
  am start -n com.termux/.app.TermuxActivity >/dev/null 2>&1 || return 1
  # The window needs a moment to actually come up before the next start lands.
  sleep 0.4
}
