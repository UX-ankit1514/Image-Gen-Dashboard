#!/bin/bash
# Double-click this file (Mac). First time: paste the connect code from the website when asked.
# After that, double-click it whenever you want the helper running. Leave the window open.
cd "$(dirname "$0")" || exit 1
# Your own setup wins; these folders only help when Node isn't found otherwise.
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin"
if ! command -v npm >/dev/null 2>&1 || ! node --version >/dev/null 2>&1; then
  echo
  echo "  Node.js is missing or won't start on this Mac. Get it from https://nodejs.org,"
  echo "  then double-click this file again."
  echo
  read -r -p "  Press Enter to close. "
  exit 1
fi
[ -d node_modules ] || { echo "  Setting up (one time, a minute or two)..."; npm install || exit 1; }
npm run --silent companion -- connect
echo
read -r -p "  The helper has stopped. Press Enter to close. "
