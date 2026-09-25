#!/bin/sh
# Překlad na Linuxu pomocí MinGW (apt install g++-mingw-w64-i686)
set -e
cd "$(dirname "$0")"
mkdir -p build
i686-w64-mingw32-g++ -std=c++17 -O2 -shared -DUNICODE -D_UNICODE \
  -o build/omsi2tracker.dll src/tracker.cpp src/exports.def \
  -lwinhttp -static -static-libgcc -static-libstdc++ -Wl,--kill-at,--enable-stdcall-fixup
echo "Hotovo: build/omsi2tracker.dll"
