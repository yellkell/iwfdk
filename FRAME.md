# IWFDK on the Steam Frame

IWFDK is the Immersive Web SDK ([facebook/immersive-web-sdk](https://github.com/facebook/immersive-web-sdk))
adapted to the Valve Steam Frame. It carries the controller work from
[FramePlayer](https://github.com/yellkell/frameplayer)'s native OpenXR player
over to WebXR, so a page built with IWFDK gets the Frame's full gamepad
layout, and the real Frame controller models, in a WebXR browser on the
headset.

**Status (2026-10-03):** SDK side implemented and unit-tested; Chromium patch
written and unit-tested in isolation; model extraction tool built for the
Frame (aarch64) and tested on synthetic data. **Nothing has run on a Frame
yet** (see [What still needs a Frame](#7-what-still-needs-a-frame)).

Controller paths and layout come from Valve's own OpenXR profile for the
Frame controllers
([ValveSoftware/Unity](https://github.com/ValveSoftware/Unity),
`com.valvesoftware.openxr.utils/Runtime/Interactions/SteamFrameControllerProfile.cs`):
the profile `/interaction_profiles/valve/frame_controller_valve` comes from
the `XR_VALVE_frame_controller_interaction` extension; the right controller
has A/B/X/Y and menu, the left a D-pad and view, and both a trigger, grip,
shoulder button and thumbstick, with touch sensing on every button.

---

## 1. Why a fork

| Layer                             | Problem                                                                                                                                                                  | IWFDK change                                                                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser (Chromium OpenXR backend) | Chromium has no Frame interaction profile, so SteamVR presents the controllers as emulated Touch controllers. The D-pad, shoulder buttons and view never reach the page. | `platform/chromium/patches/0004-*`: enables `XR_VALVE_frame_controller_interaction` and reports the controllers as `valve-frame` with a fixed 10-button gamepad layout. |
| Input profile                     | No `valve-frame` profile exists in `@webxr-input-profiles`, and IWSDK only resolves profiles baked in from that package.                                                 | `registerInputProfile()` in `@iwsdk/xr-input`; `valve-frame` registered by default.                                                                                     |
| SDK input semantics               | IWSDK reads controllers per hand and per component; Frame apps think in gamepad terms (A/B/X/Y, D-pad, menu/view) and must also work on an unpatched browser.            | `FrameInput`: a port of FramePlayer's `fp-xr` input layer, exposed as `world.input.frame`, plus a `frame` binding source for input actions.                             |
| Controller models                 | The real models come from the OpenXR runtime (`XR_EXT_render_model`), which a page cannot reach; no Frame model exists in `@webxr-input-profiles`.                       | `tools/frame-models` extracts them on the headset with their animation; `loadFrameControllerModels()` shows and animates them ([section 4](#4-real-controller-models)). |

Package names stay `@iwsdk/*` for now so upstream merges stay mechanical (see
[Tracking upstream](#6-tracking-upstream)). New code is under
`packages/xr-input/src/frame/`, `packages/xr-input/src/gamepad/profiles/`,
`platform/chromium/` and `tools/frame-models/`.

## 2. Using Frame input in an app

`world.input.frame` (and `this.input.frame` inside a system) is updated every
frame before systems run:

```ts
import { createSystem } from '@iwsdk/core';

export class PlayerControls extends createSystem({}) {
  update() {
    const frame = this.input.frame;

    if (frame.a.justPressed) togglePlayback();
    if (frame.menu.justPressed) openMenu();
    if (frame.dpad.left.justPressed) seek(-10);
    if (frame.dpad.right.justPressed) seek(+10);
    if (frame.right.shoulder.pressed) speedUp();

    // Per hand: trigger/squeeze are analog 0..1; select/grip are buttons
    // with hysteresis; the thumbstick uses Gamepad API axes (y down).
    const { x, y } = frame.left.thumbstick;

    if (frame.hands.right.pinch.justPinched) click();

    if (frame.layout === 'remapped') {
      showHint('Update the browser for full Frame controller support');
    }
  }
}
```

Each `FrameButton` has `pressed`, `justPressed`, `justReleased` and `touched`.

Or bind actions, which also work with keyboard and browser-gamepad bindings:

```ts
world.input.actions.addBindings([
  { source: 'frame', kind: 'button', action: 'player.menu', button: 'menu' },
  {
    source: 'frame',
    kind: 'button',
    action: 'player.back',
    button: 'dpadLeft',
  },
]);
// later: world.input.actions.getButtonDown('player.menu')
```

Component-level access still works. On the patched browser the new
`InputComponent` ids (`Shoulder`, `View`, `DpadUp` ...) address Frame
buttons directly:

```ts
this.input.xr.gamepads.left?.getButtonDown(InputComponent.DpadUp);
this.input.xr.gamepads.right?.getButtonPressed(InputComponent.X_Button);
```

Haptics: `frame.vibrate('right', 0.5, 40)` is best effort and returns `false`
when the browser exposes no actuator. Controller haptics are not wired up in
the community Frame Chromium build.

### Where each control comes from

`FrameInput` resolves every control from the first candidate component
present in the active profile (`packages/xr-input/src/frame/bindings.ts`):

| Control              | `valve-frame` (patched browser) | Touch emulation (unpatched browser on a Frame) and Touch-style controllers |
| -------------------- | ------------------------------- | -------------------------------------------------------------------------- |
| A / B                | right A / B                     | right A / B                                                                |
| X / Y                | right X / Y                     | left X / Y                                                                 |
| Menu                 | right menu                      | left menu, if exposed                                                      |
| View                 | left view                       | —                                                                          |
| D-pad                | left D-pad                      | emulated from the left stick                                               |
| Shoulder             | per hand                        | —                                                                          |
| Trigger, grip, stick | per hand                        | per hand                                                                   |

`frame.layout` reports which case applies: `frame`, `remapped` (any other
profile on an ARM64 Linux browser, i.e. a Frame without the patch), `other`
or `none`. `frame.dpadEmulated` is true while the D-pad comes from the stick.

### Ported from FramePlayer

| FramePlayer (`crates/xr/src`, `feat/implement-outline`)              | IWFDK (`packages/xr-input/src/frame`)                                                           |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `bindings.rs`: Frame/Index binding tiers, X/Y from left A/B on Index | `bindings.ts`: `FRAME_BUTTON_SOURCES` priority lists                                            |
| `input.rs` `Button`, `analog_press`, `stick_to_dpad`                 | `hysteresis.ts` (same thresholds: select 0.75/0.6, grip 0.7/0.5, D-pad 0.7 with release at 70%) |
| `input.rs` `InputState`                                              | `frame-input.ts` `FrameInput`                                                                   |
| `pinch.rs`                                                           | `pinch.ts` (same 10/25/80 mm thresholds)                                                        |

The Rust unit tests for these are ported in
`packages/xr-input/tests/frame-input.test.ts`. FramePlayer's own binding
table guesses `bumper/click`; Valve's profile names it `shoulder/click`.

## 3. The `valve-frame` gamepad layout

Fixed by the Chromium patch, so indices never shift (unbound slots read
released):

| Index | Left                 | Right                |
| ----- | -------------------- | -------------------- |
| 0     | trigger              | trigger              |
| 1     | squeeze (grip)       | squeeze (grip)       |
| 2     | touchpad placeholder | touchpad placeholder |
| 3     | thumbstick click     | thumbstick click     |
| 4     | D-pad up             | A                    |
| 5     | D-pad down           | B                    |
| 6     | D-pad left           | X                    |
| 7     | D-pad right          | Y                    |
| 8     | shoulder             | shoulder             |
| 9     | view                 | menu                 |

Axes 0/1 are the touchpad placeholder and axes 2/3 the thumbstick. The profile
reports `["valve-frame", "generic-trigger-squeeze-thumbstick"]`, so other
WebXR libraries fall back to the generic layout. Without extracted models the
visual is the generic trigger/squeeze/thumbstick controller.

## 4. Real controller models

SteamVR serves the Frame controller models through `XR_EXT_render_model` and
`XR_EXT_interaction_render_model`: a self-contained glTF binary per
controller, animated by the runtime reporting a local pose and visibility for
each animatable node every frame. A WebXR page can reach neither, so IWFDK
gets them in two steps.

**1. Extract on the headset.** `tools/frame-models` is a native aarch64
program (only libc needed) that loads SteamVR directly, downloads both
controller GLBs, and records how the runtime moves every node while you use
the controllers. It then correlates each node with the input that drives it
and saves the node's pose at rest and at full deflection.

```sh
# Developer Mode on, SSH pairing done (Frame Control writes `Host frame`).
# Building needs Rust, zig (pip install ziglang) and cargo-zigbuild.
tools/frame-models.sh --build            # results land in ./frame-models/
```

Put the headset on when the script says so. One buzz: keep every control
released for 3 s. Long buzz: pull both triggers and grips fully, press every
button (A B X Y, menu, view, D-pad, shoulders, stick clicks) and roll both
sticks around their full circle. Two buzzes: done; it stops by itself once
everything has been seen (the terminal lists what is still missing) or after
90 s. The output is:

| File                           | Contents                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| `left.glb`, `right.glb`        | the runtime's models, verbatim                                                                      |
| `frame-controller-models.json` | per node: driving input and rest/pressed poses (or per-direction stick poses); model-to-grip offset |
| `recording.json`               | the raw capture; `frame-models calibrate DIR` re-runs the calibration offline                       |

**2. Load in the app.** Serve the directory with the app and load it before
entering XR:

```ts
import { loadFrameControllerModels } from '@iwsdk/core';

await loadFrameControllerModels('/frame-models');
```

From then on every `valve-frame` controller uses `FrameControllerVisual`:
the GLB placed at its recorded offset from the grip pose, triggers and
buttons interpolating between their recorded poses, sticks tilting per
direction, and touch indicators showing with touch. Other controllers, and
Frame controllers when no models were loaded, keep the default visual. An app
that calls `updateVisualImplementation()` keeps its own visual.

**Licensing.** The models are Valve's assets, served by SteamVR to
applications running on the user's device; their redistribution terms are
not published. `frame-models/` is git-ignored, and nothing extracted is in
this repository. Hosting them on a public site is a decision to make with
that in mind. The OpenXR specification also asks applications not to ship
models in place of the runtime's; the WebXR route has no other way to show
them, so re-extract after SteamVR updates the controllers.

**Limits.** Animation follows only the inputs the WebXR gamepad exposes, so
it needs the patched browser (`valve-frame`); under Touch emulation the
generic visual is used. A control not exercised during capture stays at
rest (the tool's summary and `missingCoverage` list them).

## 5. Browser build

The Frame's WebXR browser is the community arm64 Chromium build
([saphid/chromium-webxr-steam-frame](https://github.com/saphid/chromium-webxr-steam-frame)).
Two patch sets apply on top of it:

1. **FramePlayer sandbox patches** (`frameplayer` repo, `docs/webxr/patches`
   0001-0003, `docs/project-outline` branch): let WebXR run with the seccomp
   sandbox on.
2. **IWFDK controller patch** (`platform/chromium/patches/0004`): this repo.

They touch different files and apply in either order:

```sh
platform/chromium/apply-chromium-patches.sh /path/to/chromium/src
autoninja -C out/Default device_unittests
out/Default/device_unittests --gtest_filter='OpenXrInteractionProfilesTest.*'
```

What patch 0004 does:

- **Frame profile.** Valve's component paths, with
  `XR_VALVE_frame_controller_interaction` as the required extension, so
  Chromium enables it when SteamVR offers it and skips the profile otherwise.
  The system button stays unbound (reserved by the runtime).
- **Fixed layout.** Chromium normally appends optional buttons only when they
  are bound, which would shift indices; for the Frame every slot is always
  emitted.
- **Menu is not the exit gesture.** Chromium ends the WebXR session on any
  `kMenu` press. The Frame's menu button gets its own type (`kAppMenu`) so
  pages can use it; the Steam button and SteamVR dashboard still end a
  session.
- **Non-fatal.** Chromium aborts all controller input if the runtime rejects
  any suggested binding. A rejected Frame profile is skipped instead, so the
  controllers fall back to Touch emulation.

Generated against `chromium/main` `2255089d4176` (2026-10-02); applies cleanly
there. The profile table and its unit test were compiled and run against
stand-ins for Chromium's `base` headers. The controller and input-helper
changes have **not** been compiled in a Chromium tree yet.

## 6. Tracking upstream

`upstream` is facebook/immersive-web-sdk; IWFDK started from 1.0.1
(`0778f51`) with full history.

```sh
git fetch upstream
git merge upstream/main
pnpm install && pnpm -r --filter '!@iwsdk/reference-assets' run build
pnpm --filter @iwsdk/xr-input test && pnpm --filter @iwsdk/core test
(cd tools/frame-models && cargo test)
```

Upstream-touching edits are deliberately small: `InputComponent` (6 ids),
`input-profiles.ts` (registry and per-profile visual), `base-visual-adapter.ts`
(uses the profile's visual), `xr-input/src/index.ts` (exports),
`core/src/input/input-manager.ts` and `input-actions.ts` (the `frame` source),
and `scripts/check-headers.mjs` (accepts the IWFDK header).

## 7. What still needs a Frame

1. **Run `tools/frame-models.sh`** and check its summary: every control
   mapped, model-to-grip spread under a millimetre, nothing left in
   "not fully exercised". Then load the result in any IWFDK example and
   compare against SteamVR's own controller rendering.
2. **A Chromium build** with patch 0004, then `device_unittests` and an
   on-headset run: `frame.layout === 'frame'` and every button lights up.
3. **What an unpatched browser reports** (Touch emulation is expected from
   Valve's documentation) and that the `remapped` user-agent heuristic
   (`Linux aarch64`) matches the Frame browser.
4. **Pinch thresholds** against Frame hand-tracking noise.
