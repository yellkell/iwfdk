#!/usr/bin/env bash
# Apply the IWFDK Steam Frame patches to a Chromium checkout.
# Usage: platform/chromium/apply-chromium-patches.sh /path/to/chromium/src
#
# Generated against chromium/main 2255089d4176 (2026-10-02). Numbered 0004
# onwards so they interleave with FramePlayer's patches (frameplayer:
# docs/webxr/patches, 0001-0003 sandbox, 0005 rendering), which touch other
# files. 0006 (Quest-compatible gamepad) applies on top of 0004 and is the
# same file as FramePlayer's 0006: builds that copy both sets into one
# directory get it once.
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
