#!/bin/sh
rm -f /usr/share/mime/packages/quvrelo.xml
command -v update-mime-database >/dev/null 2>&1 && update-mime-database /usr/share/mime || true
exit 0
