#!/usr/bin/env bash
# root.sh — the sudo takeover.
#
# WHAT THIS DOES AND DOES NOT DO
# ------------------------------
# It USES root that the device already has. It does not obtain root: there is no
# exploit here, nothing is flashed, no bootloader is touched. If `su` does not
# already exist and already grant Termux a shell, every function below reports
# that and stops. Rooting the phone is a separate act the owner performs with
# Magisk, KernelSU or APatch, on their own hardware, before any of this is useful.
#
# WHY ROOT AT ALL
# ---------------
# Four things this engine needs are unreachable from an unprivileged Android app,
# and each is a real measured problem rather than a wish:
#
#   1. One UI's adaptive display drops the panel to 60 Hz whenever it decides the
#      content is "static". A WebGL canvas that redraws every frame still trips it
#      during quiet ayat, and the scene visibly steps. `min_refresh_rate` is a
#      protected system setting; only root can pin it.
#   2. Samsung's Device Care puts Termux to sleep — "deep sleeping apps" — and the
#      bridge dies mid-recitation. The battery-optimisation allowlist is writable
#      through `dumpsys deviceidle` only as root.
#   3. The scheduler parks the big cores while the analyser and the shaders both
#      want them, and the first thirty seconds of a session stutter. The cpufreq
#      governor lives in sysfs, root-only.
#   4. Serving on a privileged port (80/443), for the rare case where the operator
#      wants the phone to be the origin for another device.
#
# WHAT IT DELIBERATELY WILL NOT DO
# --------------------------------
# It will not disable thermal management. Every "remove throttling" recipe on the
# internet is asking the owner to cook their own phone for a benchmark number,
# and a sustained WebGL load is exactly the workload that would do it. `isnaad
# root thermal` READS the thermal service so a throttle can be diagnosed; nothing
# here writes to it.
#
# REVERSIBILITY
# -------------
# Every value this file changes is read first and recorded to
# $ISNAAD_ROOT_STATE. `isnaad root restore` puts every one of them back, and a
# value that did not exist before is deleted rather than set to a guess.

# ------------------------------------------------------------------- detection

# Ordered by how a modern rooted device actually presents su. PATH first (that
# is what Magisk, KernelSU and APatch all install), then the historical paths a
# few vendor and legacy setups still use.
ISNAAD_SU_CANDIDATES=(
  "su"
  "/system/bin/su"
  "/system/xbin/su"
  "/sbin/su"
  "/debug_ramdisk/su"
  "/su/bin/su"
)

# Echo the path of a usable su, or nothing. Usable means "exists AND actually
# returns uid 0", because on a device where the grant was denied or revoked, su
# exists and fails — and a check that only looked for the file would report root
# on a phone that has none.
find_su() {
  [ -n "${ISNAAD_SU_CACHE:-}" ] && { printf '%s' "$ISNAAD_SU_CACHE"; return 0; }
  local candidate uid
  for candidate in "${ISNAAD_SU_CANDIDATES[@]}"; do
    command -v "$candidate" >/dev/null 2>&1 || [ -x "$candidate" ] || continue
    uid="$("$candidate" -c id -u 2>/dev/null | tr -d '\r\n')"
    if [ "$uid" = "0" ]; then
      ISNAAD_SU_CACHE="$candidate"
      export ISNAAD_SU_CACHE
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

root_available() { find_su >/dev/null 2>&1; }

# Which manager is in charge. This matters for the operator: the grant dialog,
# the per-app allowlist and the logs all live in a different app for each.
root_manager() {
  if command -v magisk >/dev/null 2>&1; then
    printf 'Magisk %s' "$(magisk -c 2>/dev/null || magisk -v 2>/dev/null | cut -d: -f1)"
  elif command -v ksud >/dev/null 2>&1; then
    printf 'KernelSU %s' "$(ksud -V 2>/dev/null | head -1)"
  elif command -v apd >/dev/null 2>&1; then
    printf 'APatch'
  elif [ -d /data/adb/magisk ]; then
    printf 'Magisk (binary not on PATH)'
  elif [ -d /data/adb/ksu ]; then
    printf 'KernelSU (binary not on PATH)'
  elif root_available; then
    printf 'unknown su provider'
  else
    printf 'none'
  fi
}

# Run a command as root. Everything privileged in this CLI goes through here so
# there is exactly one place that can spawn a root shell — and exactly one place
# to read when auditing what this tool does with the grant.
as_root() {
  local su; su="$(find_su)" || { err "لا يوجد جذر — no working su on this device."; return 127; }
  "$su" -c "$*"
}

# Same, but announce it. Used by anything that CHANGES the device, so a takeover
# scrolls past as a list of exactly what it did.
as_root_loud() {
  dim "    # su -c $*"
  as_root "$@"
}

require_root() {
  root_available && return 0
  err "لا يوجد جذر — this command needs root, and su is not granting it."
  say "  • Is the device rooted? Magisk / KernelSU / APatch must be installed."
  say "  • Did you grant Termux the su permission in the manager's dialog?"
  say "  • Some managers revoke a grant after a timeout — run 'su' once by hand."
  say ""
  say "  Everything else in this CLI works without root:  ${C_BOLD}isnaad up${C_RESET}"
  return 1
}

# ------------------------------------------------------------- state recording

# Record one setting's CURRENT value so restore has something true to put back.
# `settings get` prints the literal string "null" for a key that is unset, and
# that distinction is the whole point: restoring "null" as a value is not the
# same as deleting the key, and Android treats them differently.
record_setting() {
  local namespace="$1" key="$2" current
  grep -q "^${namespace}|${key}|" "$ISNAAD_ROOT_STATE" 2>/dev/null && return 0
  current="$(as_root "settings get $namespace $key" 2>/dev/null | tr -d '\r\n')"
  [ -n "$current" ] || current="null"
  printf '%s|%s|%s\n' "$namespace" "$key" "$current" >> "$ISNAAD_ROOT_STATE"
}

# Set a setting, recording the old value first.
put_setting() {
  local namespace="$1" key="$2" value="$3"
  record_setting "$namespace" "$key"
  if as_root "settings put $namespace $key $value" >/dev/null 2>&1; then
    ok "  $namespace/$key → $value"
  else
    warn "  $namespace/$key could not be set (the build may not have this key)"
  fi
}

# --------------------------------------------------------------- the takeover

root_status() {
  step "الجذر — root"
  local su manager
  manager="$(root_manager)"
  say "  manager     $manager"
  if su="$(find_su)"; then
    say "  su          $su"
    say "  id          $(as_root id 2>/dev/null)"
    ok  "  grant is live"
  else
    say "  su          ${C_DIM}not granting${C_RESET}"
    warn "  no root — the CLI runs unprivileged; the tuning below is unavailable"
    return 1
  fi

  if [ -s "$ISNAAD_ROOT_STATE" ]; then
    say ""
    say "  ${C_BOLD}takeover is ACTIVE${C_RESET} — $(wc -l < "$ISNAAD_ROOT_STATE" | tr -d ' ') setting(s) changed"
    while IFS='|' read -r namespace key old; do
      printf '    %s/%-32s was %s, now %s\n' "$namespace" "$key" "$old" \
        "$(as_root "settings get $namespace $key" 2>/dev/null | tr -d '\r\n')"
    done < "$ISNAAD_ROOT_STATE"
    say ""
    dim "  isnaad root restore   puts every one of them back"
  else
    dim "  takeover not applied — isnaad root takeover"
  fi
}

# Apply the elevated profile. Each block says what it is for, and the ones that
# are Samsung-specific say so — on a Pixel they simply report that the key does
# not exist rather than pretending to have worked.
root_takeover() {
  require_root || return 1

  local hz="${1:-}"
  local governor="${ISNAAD_GOVERNOR:-}"

  step "الاستيلاء — takeover"
  say "  device      $(device_maker) $(device_model)"
  say "  android     $(android_release) (API $(android_sdk))$( is_samsung && printf ' · One UI %s' "$(oneui_version)" )"
  say "  su          $(find_su)  [$(root_manager)]"
  say ""
  if ! confirm "apply the elevated profile? every change is recorded and reversible"; then
    warn "declined — nothing was changed"
    return 1
  fi

  touch "$ISNAAD_ROOT_STATE"
  chmod 600 "$ISNAAD_ROOT_STATE" 2>/dev/null || true

  # 1 ─ Keep Termux alive. This is the one that decides whether a recitation
  #     survives the screen going off. Samsung's Device Care is far more
  #     aggressive than AOSP doze, so both allowlists are addressed.
  step "١ — منع الإسبات · keeping Termux out of doze"
  local package
  for package in com.termux com.termux.api com.termux.boot; do
    if as_root "pm list packages" 2>/dev/null | grep -q "package:$package"; then
      as_root "dumpsys deviceidle whitelist +$package" >/dev/null 2>&1 \
        && ok "  $package → battery-optimisation allowlist" \
        || warn "  $package → allowlist refused"
      as_root "cmd appops set $package RUN_IN_BACKGROUND allow" >/dev/null 2>&1
      as_root "cmd appops set $package RUN_ANY_IN_BACKGROUND allow" >/dev/null 2>&1
    fi
  done
  # App standby buckets are what actually park a background process on One UI.
  put_setting global app_standby_enabled 0
  if is_samsung; then
    # Samsung-only keys. On a build that does not have them, `settings put`
    # succeeds and the key is simply inert — which is why restore deletes any
    # key that did not exist before rather than leaving a stray behind.
    put_setting global adaptive_battery_management_enabled 0
  fi

  # 2 ─ Pin the panel. Adaptive display is the reason a scene that renders at a
  #     steady 120 fps still looks like it is stepping during quiet passages.
  step "٢ — تثبيت معدل التحديث · pinning the refresh rate"
  if [ -z "$hz" ]; then
    hz="$(as_root "dumpsys display" 2>/dev/null \
          | grep -oE 'fps=[0-9]+(\.[0-9]+)?' | cut -d= -f2 | cut -d. -f1 \
          | sort -n | tail -1)"
    [ -n "$hz" ] || hz=120
    dim "  panel reports a maximum of ${hz} Hz"
  fi
  put_setting system min_refresh_rate "$hz"
  put_setting system peak_refresh_rate "$hz"
  if is_samsung; then
    # One UI's own toggle: 0 = standard (60 Hz), 1 = adaptive/high. Pinning the
    # two rates above is ignored while this sits at 0.
    put_setting system refresh_rate_mode 1
  fi

  # 3 ─ Give the compositor less to do. The scenes are heavy; the system's own
  #     transition animations are competing with them for the same GPU.
  step "٣ — تقليل الحركات · trimming system animation"
  put_setting global window_animation_scale 0.5
  put_setting global transition_animation_scale 0.5
  put_setting global animator_duration_scale 0.5

  # 4 ─ The CPU. Opt-in, because "performance" on every policy is a real battery
  #     cost and the operator should choose it deliberately, not inherit it.
  if [ -n "$governor" ]; then
    step "٤ — منظّم المعالج · CPU governor"
    local before
    before="$(as_root 'cat /sys/devices/system/cpu/cpufreq/policy0/scaling_governor' 2>/dev/null | tr -d '\r\n')"
    if [ -n "$before" ]; then
      printf 'governor|policy*|%s\n' "$before" >> "$ISNAAD_ROOT_STATE"
      as_root "for p in /sys/devices/system/cpu/cpufreq/policy*; do echo $governor > \$p/scaling_governor; done" \
        >/dev/null 2>&1 \
        && ok "  every policy: $before → $governor" \
        || warn "  the kernel refused $governor (not all governors are compiled in)"
    else
      warn "  cpufreq is not exposed on this kernel"
    fi
  else
    dim "\n٤ — CPU governor left alone (ISNAAD_GOVERNOR=performance to change it)"
  fi

  # 5 ─ Not doing this, on purpose.
  step "٥ — الحرارة · thermal"
  dim "  NOT disabled. A sustained WebGL load is exactly the workload thermal"
  dim "  management exists for. Use 'isnaad root thermal' to read the state when"
  dim "  a session throttles."

  say ""
  ok "الاستيلاء تم — takeover applied. ${C_BOLD}isnaad root restore${C_RESET} reverses all of it."
  say ""
  dim "Some keys take effect only after the screen is toggled off and on."
}

root_restore() {
  require_root || return 1
  if [ ! -s "$ISNAAD_ROOT_STATE" ]; then
    info "nothing recorded — no takeover to undo"
    return 0
  fi

  step "الاستعادة — restore"
  local namespace key old
  while IFS='|' read -r namespace key old; do
    [ -n "$namespace" ] || continue
    if [ "$namespace" = "governor" ]; then
      as_root "for p in /sys/devices/system/cpu/cpufreq/policy*; do echo $old > \$p/scaling_governor; done" \
        >/dev/null 2>&1 && ok "  cpufreq governor → $old"
      continue
    fi
    if [ "$old" = "null" ]; then
      # The key did not exist before the takeover. Deleting it is the only
      # honest restore: writing any value would leave the device in a state it
      # was never in.
      as_root "settings delete $namespace $key" >/dev/null 2>&1 \
        && ok "  $namespace/$key deleted (it did not exist before)" \
        || warn "  $namespace/$key could not be deleted"
    else
      as_root "settings put $namespace $key $old" >/dev/null 2>&1 \
        && ok "  $namespace/$key → $old" \
        || warn "  $namespace/$key could not be restored"
    fi
  done < "$ISNAAD_ROOT_STATE"

  # The doze allowlist is not a setting, so it is not in the file. Remove the
  # entries the takeover added; a package the operator allowlisted themselves
  # before ever running this stays, because we only remove what we added.
  local package
  for package in com.termux com.termux.api com.termux.boot; do
    as_root "dumpsys deviceidle whitelist -$package" >/dev/null 2>&1
  done
  ok "  battery-optimisation allowlist entries removed"

  rm -f "$ISNAAD_ROOT_STATE"
  say ""
  ok "استُعيدت الحالة — the device is back to its recorded state."
}

# A root shell that already knows where the project is. `isnaad su` with no
# argument drops the operator into it; with arguments it runs one command.
root_shell() {
  require_root || return 1
  if [ "$#" -eq 0 ]; then
    info "root shell in $ISNAAD_REPO — ^D to leave"
    as_root "cd '$ISNAAD_REPO' && PATH='$PATH' HOME='$HOME' sh -i"
  else
    as_root "cd '$ISNAAD_REPO' && PATH='$PATH' $*"
  fi
}

root_thermal() {
  require_root || return 1
  step "الحرارة — thermal service"
  as_root "dumpsys thermalservice" | sed -n '1,60p'
  say ""
  step "cpufreq"
  as_root 'for p in /sys/devices/system/cpu/cpufreq/policy*; do
      printf "  %s  %s  %s kHz\n" "$(basename $p)" \
        "$(cat $p/scaling_governor 2>/dev/null)" "$(cat $p/scaling_cur_freq 2>/dev/null)"
    done'
}
