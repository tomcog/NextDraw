#!/bin/zsh
# Double-click to start NextDraw Plot. Close this window to quit.
#
# Each start first brings this copy up to date with the latest version pushed to GitHub, then
# reinstalls the Python packages or rebuilds the page only if those changed. Nothing here stops the
# app from starting: offline, not signed in to GitHub, or local edits just mean it runs the version
# already on this Mac.
cd "$(dirname "$0")"

warn() { print -P "%F{yellow}$1%f"; }

# 1. Get the latest version.
if [ -d .git ]; then
  echo "Checking for updates…"
  # Only npm ever changes the lock file here, never a person, so a changed copy is thrown away
  # instead of being left to block the update.
  git checkout --quiet -- web/package-lock.json 2>/dev/null
  if GIT_TERMINAL_PROMPT=0 git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=20 pull --ff-only --quiet; then
    echo "Up to date: $(git log -1 --format='%h %s')"
  else
    warn "Couldn't get the latest version, so this starts the version already on this Mac."
  fi
fi

# 2. Python packages: on the first run, and again whenever requirements.txt changes.
if [ ! -d .venv ]; then
  echo "Setting up Python…"
  python3 -m venv .venv || { warn "Couldn't set up Python. Is python3 installed (xcode-select --install)?"; read -k1; exit 1; }
fi
req_hash=$(shasum requirements.txt | cut -d' ' -f1)
if [ "$(cat .venv/.requirements-hash 2>/dev/null)" != "$req_hash" ]; then
  echo "Installing Python packages…"
  if .venv/bin/pip install --quiet -r requirements.txt; then
    echo "$req_hash" > .venv/.requirements-hash
  else
    warn "Couldn't install the Python packages. Trying to start anyway."
  fi
fi

# 3. The page: on the first run, and again whenever the code in web/ changes.
web_hash=$(git rev-parse HEAD:web 2>/dev/null || echo "no-git")
if [ ! -f static/index.html ] || [ "$(cat static/.built-from 2>/dev/null)" != "$web_hash" ]; then
  echo "Building the page (this takes a minute)…"
  # npm ci installs exactly what package-lock.json lists and never rewrites it, so the next update
  # isn't blocked by a lock file changed on this Mac.
  if (cd web && npm ci --no-audit --no-fund --loglevel=error && npm run build --silent); then
    echo "$web_hash" > static/.built-from
  elif [ -f static/index.html ]; then
    warn "Couldn't rebuild the page, so this uses the one built before."
  else
    warn "Couldn't build the page. Is Node.js installed (nodejs.org, version 22)?"
    read -k1
    exit 1
  fi
fi

# 4. Start. The page opens in the default browser, and other devices on this network can open it too.
exec .venv/bin/python server.py --lan
