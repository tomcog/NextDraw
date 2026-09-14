#!/bin/zsh
# Double-click to start NextDraw Studio. Close this window to quit.
cd "$(dirname "$0")"

# First run after cloning: set up Python and build the page.
if [ ! -d .venv ]; then
  python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
fi
if [ ! -f static/index.html ]; then
  (cd web && npm install && npm run build)
fi

exec .venv/bin/python server.py
