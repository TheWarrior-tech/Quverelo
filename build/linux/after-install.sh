#!/bin/sh
# Registers the .quvrelo MIME type and refreshes desktop caches (deb/rpm post-install).
set -e
XML=/opt/Quvrelo/resources/quvrelo-mime.xml
if [ -f "$XML" ]; then
  mkdir -p /usr/share/mime/packages
  cp "$XML" /usr/share/mime/packages/quvrelo.xml
  command -v update-mime-database >/dev/null 2>&1 && update-mime-database /usr/share/mime || true
fi
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
exit 0
