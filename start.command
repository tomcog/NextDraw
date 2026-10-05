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
# A setup is only ever replaced when its Python can't run at all here - made on another Mac and
# copied across with the folder. One whose packages are missing has them installed again instead.
if [ -d .venv ] && ! .venv/bin/python -c "pass" 2>/dev/null; then
  warn "The Python setup in this folder was made on another Mac, so it's being made again."
  rm -rf .venv
fi
if [ ! -d .venv ]; then
  echo "Setting up Python…"
  python3 -m venv .venv || { warn "Couldn't set up Python. Is python3 installed (xcode-select --install)?"; read -k1; exit 1; }
fi
req_hash=$(shasum requirements.txt | cut -d' ' -f1)
if [ "$(cat .venv/.requirements-hash 2>/dev/null)" != "$req_hash" ] || ! .venv/bin/python -c "import flask, nextdraw" 2>/dev/null; then
  echo "Installing Python packages…"
  # The plotter driver comes from drivers/ (see requirements.txt), put in first over whatever copy is
  # there: a driver installed from Bantam's download names its partner by a temporary file long gone,
  # and pip stops at that. pip's own messages are kept and shown if it fails, so the window says why.
  pip=(.venv/bin/python -m pip install --quiet --disable-pip-version-check)
  if pip_out=$({ [ ! -d drivers ] || $pip --no-deps --force-reinstall drivers/*.whl; } 2>&1 \
    && $pip --find-links drivers -r requirements.txt 2>&1); then
    echo "$req_hash" > .venv/.requirements-hash
  else
    print -r -- "$pip_out" | tail -15
    [ -d drivers ] || warn "The drivers folder is missing: copy it into this folder from the Mac where the app works."
    # A setup that still has what the app needs starts anyway: a failed update is no reason to stop.
    if ! .venv/bin/python -c "import flask, nextdraw" 2>/dev/null; then
      warn "Couldn't install the Python packages, so the app can't start. Press a key to close."
      read -k1
      exit 1
    fi
    warn "Couldn't update the Python packages, so this starts with the ones already here."
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
