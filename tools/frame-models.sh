#!/usr/bin/env bash
# Copyright (c) IWFDK contributors.
#
# This source code is licensed under the MIT license found in the
# LICENSE file in the root directory of this source tree.

# Extract the Steam Frame controller models from a paired headset over SSH.
#
# Prerequisites on the headset: Developer Mode on and SSH pairing done once
# (Frame Control, FrameDrop or Valve's SteamOS Devkit Client; Frame Control
# writes a `Host frame` entry to ~/.ssh/config, the default here). Set
# FRAME_HOST for anything else, e.g. FRAME_HOST=deck@192.168.1.50.
#
# Building needs Rust, zig (pip install ziglang) and cargo-zigbuild.
#
# Usage: tools/frame-models.sh [--build] [OUT_DIR] [-- extra frame-models args]
# OUT_DIR defaults to frame-models/ (git-ignored). Serve it from your app and
# point IWFDK at it; see FRAME.md.
set -euo pipefail
cd "$(dirname "$0")/.."
host="${FRAME_HOST:-frame}"
crate=tools/frame-models
bin="$crate/target/aarch64-unknown-linux-gnu/release/frame-models"

build=0
if [[ "${1:-}" == "--build" ]]; then
  build=1
  shift
fi
out="frame-models"
if [[ $# -gt 0 && "$1" != "--" ]]; then
  out="$1"
  shift
fi
[[ "${1:-}" == "--" ]] && shift

if [[ $build == 1 || ! -x "$bin" ]]; then
  echo "==> building frame-models for aarch64 (glibc 2.28)"
  (cd "$crate" && cargo zigbuild --release --target aarch64-unknown-linux-gnu.2.28)
fi

echo "==> copying to $host"
ssh "$host" 'mkdir -p ~/iwfdk-frame-models'
scp -q "$bin" "$host:iwfdk-frame-models/frame-models"

echo "==> running on $host: put the headset on and follow the haptic cues"
ssh -t "$host" 'export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"; ~/iwfdk-frame-models/frame-models --out ~/iwfdk-frame-models/out '"$*"

echo "==> fetching into $out/"
mkdir -p "$out"
scp -q "$host:iwfdk-frame-models/out/*" "$out/"
ls -l "$out"
