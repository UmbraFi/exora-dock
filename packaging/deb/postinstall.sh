#!/bin/sh
set -eu

if ! id exora-dock >/dev/null 2>&1; then
  useradd --system --home /var/lib/exora-dock --shell /usr/sbin/nologin exora-dock || true
fi

mkdir -p /etc/exora-dock /var/lib/exora-dock
chown -R exora-dock:exora-dock /var/lib/exora-dock

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload || true
  systemctl enable exora-dockd.service || true
fi
