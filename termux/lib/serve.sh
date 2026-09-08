#!/usr/bin/env bash
# serve.sh — build, serve, open, and stay alive.
#
# `isnaad up` is the whole product in one command: it makes sure there is a
# build, starts the bridge, takes a wake lock so Android does not stop the
# process the moment the screen goes off, opens the browser at the right URL,
# and leaves the token where every other subcommand can find it.

# ------------------------------------------------------------------- building

ensure_deps() {
  [ -d "$ISNAAD_REPO/node_modules" ] && return 0
  info "تنصيب الاعتماديات — installing dependencies (this takes a few minutes on a phone)"
  ( cd "$ISNAAD_REPO" && { [ -f package-lock.json ] && npm ci --no-audit --no-fund || npm install --no-audit --no-fund; } ) \
    || die "npm install failed"
}

# Rebuild when there is no build, or when a source file is newer than the one
# that was produced from it. `find -newer` is exact and costs nothing next to a
# Vite build on an ARM64 phone, which is the thing actually worth avoiding.
needs_build() {
  [ -f "$ISNAAD_REPO/dist/index.html" ] || return 0
  local newer
  newer="$(find "$ISNAAD_REPO/src" "$ISNAAD_REPO/index.html" "$ISNAAD_REPO/vite.config.ts" \
            -newer "$ISNAAD_REPO/dist/index.html" -print -quit 2>/dev/null)"
  [ -n "$newer" ]
}

ensure_build() {
  if [ "${ISNAAD_FORCE_BUILD:-0}" = "1" ]; then
    info "إعادة البناء — forced rebuild"
  elif needs_build; then
    info "البناء — sources changed since the last build"
  else
    ok "build is current"
    return 0
  fi
  ensure_deps
  # NODE_OPTIONS: the default heap is generous on a desktop and not on a phone
  # that is also holding a browser and a recitation in memory. 2 GB is enough
  # for this bundle and leaves the device usable while it builds.
  ( cd "$ISNAAD_REPO" && NODE_OPTIONS="--max-old-space-size=${ISNAAD_BUILD_HEAP:-2048}" npm run build ) \
    || die "the build failed — 'npm run build' in $ISNAAD_REPO shows why"
  ok "بُني — dist/ is fresh"
}

# --------------------------------------------------------------------- serving

bridge_start() {
  if bridge_running; then
    warn "a bridge is already running (pid $(cat "$ISNAAD_PID"))"
    bridge_show_url
    return 0
  fi

  local flags=(
    "--root=$ISNAAD_REPO/dist"
    "--port=$ISNAAD_PORT"
    "--token-file=$ISNAAD_TOKEN_FILE"
  )
  [ "${ISNAAD_LAN:-0}" = "1" ]        && flags+=("--lan")
  [ "${ISNAAD_ALLOW_ROOT_RPC:-0}" = "1" ] && flags+=("--allow-root-rpc")
  [ "${ISNAAD_ALLOW_ROOT_EXEC:-0}" = "1" ] && flags+=("--allow-root-exec")
  have termux-toast || flags+=("--no-termux-api")
  if root_available; then flags+=("--su=$(find_su)"); fi

  # A privileged port needs root to bind, and saying so up front beats an
  # EACCES from deep inside Node.
  if [ "$ISNAAD_PORT" -lt 1024 ] 2>/dev/null && ! root_available; then
    die "port $ISNAAD_PORT is privileged and there is no root to bind it. Use --port 4173."
  fi

  : > "$ISNAAD_LOG"
  if [ "$ISNAAD_PORT" -lt 1024 ] 2>/dev/null; then
    as_root "cd '$ISNAAD_REPO' && exec node '$ISNAAD_CLI_DIR/bridge/server.mjs' ${flags[*]}" \
      >> "$ISNAAD_LOG" 2>&1 &
  else
    ( cd "$ISNAAD_REPO" && exec node "$ISNAAD_CLI_DIR/bridge/server.mjs" "${flags[@]}" ) \
      >> "$ISNAAD_LOG" 2>&1 &
  fi
  local pid=$!
  printf '%s' "$pid" > "$ISNAAD_PID"

  # Wait for the listener rather than sleeping a guessed interval: on a cold
  # phone Node can take three seconds to start, and on a warm one, 200 ms.
  local waited=0
  while [ "$waited" -lt 150 ]; do
    if ! kill -0 "$pid" 2>/dev/null; then
      err "the bridge exited immediately:"
      sed 's/^/    /' "$ISNAAD_LOG" >&2
      rm -f "$ISNAAD_PID"
      return 1
    fi
    [ -s "$ISNAAD_TOKEN_FILE" ] && ctl health >/dev/null 2>&1 && break
    sleep 0.1
    waited=$((waited + 1))
  done
  if [ "$waited" -ge 150 ]; then
    err "the bridge did not come up within 15 s. Log:"
    sed 's/^/    /' "$ISNAAD_LOG" >&2
    return 1
  fi

  chmod 600 "$ISNAAD_TOKEN_FILE" 2>/dev/null || true
  ok "الجسر يعمل — bridge up on port $ISNAAD_PORT (pid $pid)"
  return 0
}

bridge_stop() {
  if ! bridge_running; then
    info "no bridge is running"
    rm -f "$ISNAAD_PID"
    return 0
  fi
  local pid; pid="$(cat "$ISNAAD_PID")"
  kill "$pid" 2>/dev/null
  local waited=0
  while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt 50 ]; do
    sleep 0.1; waited=$((waited + 1))
  done
  kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
  rm -f "$ISNAAD_PID"
  have termux-wake-unlock && termux-wake-unlock >/dev/null 2>&1
  ok "توقّف الجسر — bridge stopped"
}

bridge_url_with_token() {
  local token; token="$(bridge_token)"
  if [ -n "$token" ]; then
    printf 'http://127.0.0.1:%s/?k=%s' "$ISNAAD_PORT" "$token"
  else
    printf 'http://127.0.0.1:%s/' "$ISNAAD_PORT"
  fi
}

bridge_show_url() {
  say ""
  say "  ${C_BOLD}$(bridge_url_with_token)${C_RESET}"
  if [ "${ISNAAD_LAN:-0}" = "1" ]; then
    local lan
    lan="$(grep -o 'LAN:.*' "$ISNAAD_LOG" 2>/dev/null | tail -1 | sed 's/LAN: *//')"
    [ -n "$lan" ] && say "  ${C_DIM}LAN${C_RESET}  $lan"
  fi
  say ""
}

# ------------------------------------------------------------------ the whole

up() {
  step "محرك الإسناد — Termux CLI · Samsung 16 Edition"

  is_termux || warn "not under Termux; device ops will be unavailable"
  have node  || die "node is not installed. pkg install nodejs-lts"

  ensure_build
  bridge_start || return 1

  # The wake lock is not optional on a Galaxy. Without it One UI suspends the
  # Termux process within a minute or two of the screen going off, and the
  # recitation stops mid-ayah with no error anywhere.
  if have termux-wake-lock; then
    termux-wake-lock >/dev/null 2>&1 && ok "قفل الاستيقاظ — wake lock held"
  else
    warn "no termux-wake-lock (pkg install termux-api) — playback will stop when the screen sleeps"
  fi

  # An `am start` from a backgrounded Termux is frequently dropped on Android
  # 16. Foregrounding Termux first turns that into a reliable open.
  foreground_termux
  local url; url="$(bridge_url_with_token)"
  open_url "$url" || true

  bridge_show_url
  dim "  isnaad play 18 60      drive the running page from here"
  dim "  isnaad watch           live Isnaad vector in this terminal"
  dim "  isnaad down            stop the bridge and release the wake lock"
}
