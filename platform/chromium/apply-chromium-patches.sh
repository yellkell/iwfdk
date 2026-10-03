#!/usr/bin/env bash
# Apply the IWFDK Steam Frame patches to a Chromium checkout.
# Usage: platform/chromium/apply-chromium-patches.sh /path/to/chromium/src
#
# Generated against chromium/main 2255089d4176 (2026-10-02). Numbered 0004
# onwards so they stack after FramePlayer's sandbox patches 0001-0003
# (frameplayer: docs/webxr/patches); the two sets touch different files and
# apply in either order.
set -euo pipefail
src="${1:?path to chromium/src required}"
patches="$(cd "$(dirname "$0")" && pwd)/patches"
cd "$src"
for p in "$patches"/*.patch; do
  echo "==> $(basename "$p")"
  git apply --check --3way "$p"
  git am --3way "$p"
done
echo "done. Validate with:"
echo "  autoninja -C out/Default device_unittests"
echo "  out/Default/device_unittests --gtest_filter='OpenXrInteractionProfilesTest.*'"
