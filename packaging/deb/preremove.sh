#!/bin/sh
set -eu

if command -v systemctl >/dev/null 2>&1; then
  systemctl stop exora-dockd.service || true
  systemctl disable exora-dockd.service || true
fi
