# IWFDK on the Steam Frame

IWFDK is the Immersive Web SDK ([facebook/immersive-web-sdk](https://github.com/facebook/immersive-web-sdk))
adapted to the Valve Steam Frame. It carries the controller work from
[FramePlayer](https://github.com/yellkell/frameplayer)'s native OpenXR player
over to WebXR, so a page built with IWFDK gets the Frame's full gamepad
layout, and the real Frame controller models, in a WebXR browser on the
headset.

**Status (2026-10-04):** running on a Steam Frame. The Frame's WebXR browser,
Chromium XR, carries the controller patches; the controller models were
extracted on a Frame and ship with IWFDK; haptics work. The rendering
workarounds for other Frame browsers ([section 5](#5-making-a-webxr-app-great-on-the-steam-frame))
are unit-tested but not yet run on the headset (see
[What still needs a Frame](#8-what-still-needs-a-frame)).

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

| Layer                             | Problem                                                                                                                                                                  | IWFDK change                                                                                                                                                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser (Chromium OpenXR backend) | Chromium has no Frame interaction profile, so SteamVR presents the controllers as emulated Touch controllers. The D-pad, shoulder buttons and view never reach the page. | `platform/chromium/patches/0004-*` and `0006-*`: enable `XR_VALVE_frame_controller_interaction` and report the controllers as `valve-frame`, then `oculus-touch-v3`, with a fixed gamepad layout whose first slots match Meta Touch ([section 3](#3-the-valve-frame-gamepad-layout)). |
| Input profile                     | No `valve-frame` profile exists in `@webxr-input-profiles`, and IWSDK only resolves profiles baked in from that package.                                                 | `registerInputProfile()` in `@iwsdk/xr-input`; `valve-frame` registered by default.                                                                                                                                                                                                   |
| SDK input semantics               | IWSDK reads controllers per hand and per component; Frame apps think in gamepad terms (A/B/X/Y, D-pad, menu/view) and must also work on an unpatched browser.            | `FrameInput`: a port of FramePlayer's `fp-xr` input layer, exposed as `world.input.frame`, plus a `frame` binding source for input actions.                                                                                                                                           |
| Controller models                 | The real models come from the OpenXR runtime (`XR_EXT_render_model`), which a page cannot reach; no Frame model exists in `@webxr-input-profiles`.                       | `tools/frame-models` extracts them on the headset with their animation; `loadFrameControllerModels()` shows and animates them ([section 4](#4-real-controller-models)).                                                                                                               |
| Rendering                         | Chromium on the Frame offers WebXR projection layers it cannot composite (black headset), and builds without patch 0005 lose the right eye.                              | On a Steam Frame browser `@iwsdk/core` renders through an `XRWebGLLayer` and finishes each XR frame where needed ([section 5](#5-making-a-webxr-app-great-on-the-steam-frame)).                                                                                                       |
| Haptics                           | Chromium XR vibrates XR controllers through `vibrationActuator.playEffect()`, Quest Browser through `hapticActuators[0].pulse()`.                                        | `pulseHaptics()` (and `frame.vibrate()`) try both.                                                                                                                                                                                                                                    |

Package names stay `@iwsdk/*` for now so upstream merges stay mechanical (see
[Tracking upstream](#7-tracking-upstream)). New code is under
`packages/xr-input/src/frame/`, `packages/xr-input/src/gamepad/profiles/`,
`packages/xr-input/src/gamepad/haptics.ts`,
`packages/core/src/init/steam-frame.ts`, `platform/chromium/` and
`tools/frame-models/`.

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

Code written for Quest controllers needs no Frame branch for A/B/X/Y: the
Frame gamepad follows the Touch layout in its first slots, and the browser
mirrors the right controller's X/Y into the left gamepad, so
`gamepads.left?.getButtonPressed(InputComponent.X_Button)` reads the Frame's
X. On the Frame that press also shows on the right `X_Button`; `FrameInput`
reads the right one only.

Haptics: `frame.vibrate('right', 0.5, 40)`, or `pulseHaptics(source, 0.5, 40)`
for any controller (an `XRInputSource` or its gamepad), is best effort and
returns `false` when the browser exposes no actuator. It tries
`gamepad.vibrationActuator.playEffect('dual-rumble', ...)` first, which is
what Chromium XR supports (patch 0008), then `gamepad.hapticActuators[0].pulse()`,
which is what Quest Browser supports. The community Frame Chromium builds
have no controller haptics.

```ts
import { pulseHaptics } from '@iwsdk/core';

pulseHaptics(this.input.xr.gamepads.right?.inputSource, 0.6, 30);
```

### Where each control comes from

`FrameInput` resolves every control from the first candidate component
present in the active profile (`packages/xr-input/src/frame/bindings.ts`):

| Control              | `valve-frame` (patched browser)   | Touch emulation (unpatched browser on a Frame) and Touch-style controllers |
| -------------------- | --------------------------------- | -------------------------------------------------------------------------- |
| A / B                | right A / B                       | right A / B                                                                |
| X / Y                | right X / Y (not the left mirror) | left X / Y                                                                 |
| Menu                 | right menu                        | left menu, if exposed                                                      |
| View                 | left view                         | —                                                                          |
| D-pad                | left D-pad                        | emulated from the left stick                                               |
| Shoulder             | per hand                          | —                                                                          |
| Trigger, grip, stick | per hand                          | per hand                                                                   |

`frame.layout` reports which case applies: `frame`, `remapped` (any other
profile on an ARM64 Linux browser, i.e. a Frame without the patch), `other`
or `none`. `frame.dpadEmulated` is true while the D-pad comes from the stick.

### Ported from FramePlayer

| FramePlayer (`crates/xr/src`, `feat/implement-outline`)             | IWFDK (`packages/xr-input/src/frame`)                                                           |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `bindings.rs`: Frame binding table and its Touch emulation fallback | `bindings.ts`: `FRAME_BUTTON_SOURCES` priority lists                                            |
| `input.rs` `Button`, `analog_press`, `stick_to_dpad`                | `hysteresis.ts` (same thresholds: select 0.75/0.6, grip 0.7/0.5, D-pad 0.7 with release at 70%) |
| `input.rs` `InputState`                                             | `frame-input.ts` `FrameInput`                                                                   |
| `pinch.rs`                                                          | `pinch.ts` (same 10/25/80 mm thresholds)                                                        |

The Rust unit tests for these are ported in
`packages/xr-input/tests/frame-input.test.ts`. Everything targets the Frame
controllers: there is no Index-specific mapping, and the only other case
handled specially is SteamVR's Touch emulation of the Frame controllers.

## 3. The `valve-frame` gamepad layout

Fixed by the Chromium patches (0004, laid out for Quest compatibility by
0006), so indices never shift (unbound slots and placeholders read
released). Slots 0-6 follow Meta Touch (`oculus-touch-v3`); the Frame-only
controls follow from slot 7:

| Index | Left                                   | Right                 |
| ----- | -------------------------------------- | --------------------- |
| 0     | trigger                                | trigger               |
| 1     | squeeze (grip)                         | squeeze (grip)        |
| 2     | touchpad placeholder                   | touchpad placeholder  |
| 3     | thumbstick click                       | thumbstick click      |
| 4     | X (mirrored from the right controller) | A                     |
| 5     | Y (mirrored from the right controller) | B                     |
| 6     | thumbrest placeholder                  | thumbrest placeholder |
| 7     | D-pad up                               | X                     |
| 8     | D-pad down                             | Y                     |
| 9     | D-pad left                             | shoulder              |
| 10    | D-pad right                            | menu                  |
| 11    | shoulder                               |                       |
| 12    | view                                   |                       |

The left gamepad has 13 buttons, the right 11. Axes 0/1 are the touchpad
placeholder and axes 2/3 the thumbstick. The Frame has X/Y on the right
controller, where Touch has them on the left, so the browser copies the right
controller's X/Y into left slots 4/5; the Frame's left controller has no
buttons there.

The profile reports
`["valve-frame", "oculus-touch-v3", "oculus-touch", "generic-trigger-squeeze-thumbstick"]`.
IWFDK resolves `valve-frame`; libraries without it (three.js, older IWSDK)
fall back to the Touch profile, models and button layout, so pages written for
Quest controllers work: trigger, grip, stick, A/B on the right and X/Y on the
left. One mismatch: `oculus-touch-v3` puts the left menu at slot 7, which is
the Frame's D-pad up, so such pages see D-pad up as the left menu button.
Without extracted models IWFDK's visual is the generic
trigger/squeeze/thumbstick controller.

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

**2. Load in the app.** IWFDK ships a set extracted from a Steam Frame
(`packages/xr-input/frame-models`, served by jsDelivr from the
`frame-models-1` tag) and loads it by itself when the page runs in a Steam
Frame browser: apps show Frame controllers with no code. To use your own
extraction instead, serve its directory and pass it as
`frameControllerModels` in the XR input options, or load it before entering
XR (the URL may be absolute or relative to the page; controllers already
connected switch on their next connection); `frameControllerModels: false`
keeps the default visuals:

```ts
import { loadFrameControllerModels } from '@iwsdk/core';

await loadFrameControllerModels('/frame-models');
```

From then on the Frame controllers use `FrameControllerVisual`: the GLB
placed at its recorded offset from the grip pose, triggers and buttons
interpolating between their recorded poses, sticks tilting per direction,
and touch indicators showing with touch. That covers `valve-frame`
controllers and, on a Steam Frame browser without the Chromium patch, the
same controllers reported through SteamVR's Touch emulation
(`oculus-touch`), so the headset always shows Frame controllers, never Touch
controllers. Pass `{ emulation: false }` as the third argument to skip the
emulation case. Other headsets' controllers keep the default visual, as do
Frame controllers when no models were loaded. An app that calls
`updateVisualImplementation()` keeps its own visual.

**Licensing.** The models are Valve's assets, served by SteamVR to
applications running on the user's device; their redistribution terms are
not published. This repository carries one extraction (in
`packages/xr-input/frame-models`, credited to Valve) by the maintainer's
choice; `frame-models/` at the root, where `tools/frame-models.sh` writes
yours, stays git-ignored. The OpenXR specification also asks applications not to ship
models in place of the runtime's; the WebXR route has no other way to show
them, so re-extract after SteamVR updates the controllers.

**Limits.** Animation follows only the inputs the WebXR gamepad exposes.
With the patched browser (`valve-frame`) that is every control. Under Touch
emulation it is the trigger, grip, thumbstick, A and B; the D-pad, X/Y,
shoulders, menu and view stay at rest because the emulation does not expose
them under their own names. A control not exercised during capture stays at
rest (the tool's summary and `missingCoverage` list them).

## 5. Making a WebXR app great on the Steam Frame

What bringing WebXR apps (Fish & Chips, built with IWSDK) to the Frame
taught, as a checklist. Each item says what IWFDK already does; apps on plain
three.js or older IWSDK builds need to do it themselves. The Frame renders
2160×2160 pixels per eye at 90 Hz in Chromium XR on an Adreno 750: an
11.1 ms frame.

1. **Don't render into WebXR projection layers.** Chromium's Linux OpenXR
   backend offers the `layers` feature and
   `XRWebGLBinding.createProjectionLayer`, but its Vulkan graphics binding
   cannot composite layers (`SupportsLayers()` is false), so a page drawing
   into a projection layer shows black in the headset. three.js draws into
   one whenever `createProjectionLayer` exists, whatever features the
   session has. Chromium XR's launcher turns the API off; other Frame builds
   don't. _IWFDK:_ in a Steam Frame browser it requests `layers` only if the
   app requires them, and hides `createProjectionLayer` while three.js sets
   the session up, so three.js renders through an `XRWebGLLayer`
   (`packages/core/src/init/steam-frame.ts`). In Chromium XR a page that
   asks for `layers` logs "Unsupported feature requested: layers", which is
   harmless. A plain three.js app can do the same:

   ```ts
   const proto = XRWebGLBinding.prototype;
   const method = Object.getOwnPropertyDescriptor(
     proto,
     'createProjectionLayer',
   );
   if (method) delete proto.createProjectionLayer;
   try {
     await renderer.xr.setSession(session);
   } finally {
     if (method) Object.defineProperty(proto, 'createProjectionLayer', method);
   }
   ```

2. **Finish each frame in Frame browsers without Chromium XR's fix.**
   Blink discards the depth and stencil buffers
   (`DiscardFramebufferEXT` in `XRWebGLDrawingBuffer::DoneWithSharedBuffer`)
   when it hands a frame to the compositor, and on the Frame's graphics stack
   (ANGLE on GL on zink on Turnip) that turns the right eye black or
   flickering and loses effects such as water. Chromium XR skips the discard
   (patch 0005). Elsewhere a `gl.finish()` at the end of each XR frame,
   before the browser takes it, avoids it; a finish after the discard does
   not. _IWFDK:_ `render.finishXRFrames` (default `'auto'`) finishes frames
   in a Steam Frame browser until a controller reports `valve-frame`, so
   Chromium XR pays nothing. A finish stops the CPU running ahead of the GPU,
   which lowers the frame-rate ceiling; `false` turns it off, `true` forces
   it in any browser.

3. **Request the session once.** A second `requestSession()` while one is
   pending or active rejects with "InvalidStateError: ... There is already an
   active, immersive XRSession". _IWFDK:_ `world.launchXR()` ignores calls
   while a request is pending and logs "XRSession already exists" while a
   session is active (IWSDK's own guard). Fish & Chips's build of IWSDK
   predates the pending-request guard and logs that error on every Enter VR:
   update IWSDK, or ignore clicks while a request is in flight.

4. **Read the controllers as Touch controllers, or as Frame controllers.**
   Chromium XR reports
   `["valve-frame", "oculus-touch-v3", "oculus-touch", "generic-trigger-squeeze-thumbstick"]`
   with a gamepad whose slots 0-6 match Touch
   ([section 3](#3-the-valve-frame-gamepad-layout)), so Quest code works
   unchanged; the D-pad, shoulders, menu and view are Frame-only. Other Frame
   builds report SteamVR's Touch emulation (`oculus-touch`). _IWFDK:_
   `world.input.frame` covers both; `frame.layout` says which applies
   ([section 2](#2-using-frame-input-in-an-app)).

5. **Show Frame controllers.** _IWFDK:_ loads the shipped Frame models in a
   Steam Frame browser (`frameControllerModels` in the XR input options;
   [section 4](#4-real-controller-models)). Chromium XR also redirects the
   Touch models that pages fetch from the WebXR input profiles CDN to Frame
   models, so apps that show Touch models show Frame controllers there.

6. **Vibrate through `vibrationActuator` first.** Chromium XR supports
   `gamepad.vibrationActuator.playEffect('dual-rumble', { duration, strongMagnitude, weakMagnitude })`
   (patch 0008), not `hapticActuators[0].pulse()`; Quest Browser supports
   `pulse()`. _IWFDK:_ `pulseHaptics()` and `frame.vibrate()` try both.

7. **Detect the Frame by its CPU.** Chromium's reduced user agent says
   "Linux x86*64" on the Frame;
   `navigator.userAgentData.getHighEntropyValues(['platform', 'architecture'])`
   says `Linux` / `arm`. \_IWFDK:* `detectSteamFrameBrowser()` (and the
   synchronous `isSteamFrameBrowser()` once it has answered), which never
   matches Quest, Pico or Android browsers.

8. **Budget for 2160×2160 at 90 Hz; the page can't change either.** The
   refresh rate and resolution are SteamVR per-app settings: Chromium XR's
   launcher sets 90 Hz and 2160 pixels per eye (SteamVR's defaults are 72 Hz
   and 1728), and SteamVR overrides refresh-rate requests from the app. What
   a page controls:
   - **Framebuffer scale:** `renderer.xr.setFramebufferScaleFactor(s)` before
     entering XR; 1.0 (IWSDK's default) is SteamVR's resolution. Lower it for
     a heavy scene.
   - **Antialiasing:** IWSDK's renderer always asks for it, and the XR
     framebuffer is multisampled.
   - **Foveation and multiview** have no effect: Chromium's `XRWebGLLayer`
     has no fixed foveation, and three.js only uses multiview with projection
     layers, so each eye is drawn separately.

   IWFDK keeps IWSDK's defaults: nothing measured on the Frame yet calls for
   different ones.

## 6. Browser build

The Frame's WebXR browser is **Chromium XR**: arm64 Chromium 157 built from
`chromium/main` `2255089d4176` with the patches below, after the community
build ([saphid/chromium-webxr-steam-frame](https://github.com/saphid/chromium-webxr-steam-frame)).
It installs through Frame Control from the
[FramePlayer release](https://github.com/yellkell/frameplayer/releases/tag/chromium-xr-frame-157.0.8085.0-3)
(`chromium-xr-frame-157.0.8085.0-3`). Two patch sets apply, in file-name
order:

1. **FramePlayer patches** (`frameplayer` repo, `docs/webxr/patches`,
   `docs/project-outline` branch):
   - 0001-0003 let WebXR run with the seccomp sandbox on;
   - 0005 skips the depth/stencil discard that blacks out the right eye
     ([section 5](#5-making-a-webxr-app-great-on-the-steam-frame), item 2);
   - 0006 is the Quest-compatible gamepad (below);
   - 0008 vibrates XR controllers through OpenXR haptics, for
     `gamepad.vibrationActuator.playEffect('dual-rumble', ...)`.

   There is no 0007 (FramePlayer's embedding hooks, dropped when FramePlayer
   and Chromium XR became separate apps).

2. **IWFDK controller patches** (`platform/chromium/patches`, this repo):
   0004 adds the Frame controllers; 0006 makes their gamepad
   Quest-compatible and applies on top of 0004.

0006 is the same file in both repos (written and verified on a Frame in
FramePlayer, 2026-10-03): FramePlayer's build script copies both sets into
one directory, so it is applied once. The two sets otherwise touch different
files.

```sh
platform/chromium/apply-chromium-patches.sh /path/to/chromium/src
autoninja -C out/Default device_unittests
out/Default/device_unittests --gtest_filter='OpenXrInteractionProfilesTest.*'
```

The release's launcher (`chromium-xr.sh`; FramePlayer
`tools/webxr/frame-title/launch.sh`) also:

- passes `--disable-blink-features=WebXRLayers`, so pages render through an
  `XRWebGLLayer` (projection layers show black;
  [section 5](#5-making-a-webxr-app-great-on-the-steam-frame), item 1);
- passes `--test-type`, which hides the "unsupported command-line flag" bar
  over every page (the non-sandboxed title runs with
  `--disable-seccomp-filter-sandbox`);
- sets SteamVR's per-app defaults for Chromium XR with `vrcmd`, 90 Hz and
  2160 pixels per eye, unless they were chosen in SteamVR's per-app video
  settings (`CHROMIUM_XR_REFRESH_RATE` / `CHROMIUM_XR_RESOLUTION` change
  them, `0` leaves SteamVR's);
- loads the Frame controller models extension shipped in the title
  (`--load-extension`, with
  `--disable-features=DisableLoadExtensionCommandLineSwitch`), which serves
  Frame models in place of the `oculus-touch` models, so pages that show
  Touch controllers show Frame controllers.

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

What patch 0006 does:

- **Touch fallback profiles.** `oculus-touch-v3` and `oculus-touch` follow
  `valve-frame`, so pages and libraries that don't know the Frame show Touch
  models and use the Touch button layout.
- **Touch layout first.** Slots 4-6 are A/X, B/Y and a thumbrest placeholder
  as on Touch; the Frame-only controls move to fixed slots from 7
  ([section 3](#3-the-valve-frame-gamepad-layout)).
- **X/Y mirrored to the left.** `OpenXRInputHelper` copies the right
  controller's X/Y into the left gamepad's slots 4 and 5, where Touch has
  them.

Generated against `chromium/main` `2255089d4176` (2026-10-02); compiled and
running on a Frame in Chromium XR (Chromium 157.0.8085.0).

## 7. Tracking upstream

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
`core/src/init/xr.ts` (no `layers` offer and no projection layer in a Steam
Frame browser), `core/src/init/world-initializer.ts` (`render.finishXRFrames`),
and `scripts/check-headers.mjs` (accepts the IWFDK header).

## 8. What still needs a Frame

Verified on a Frame (2026-10-03/04): Chromium XR with patches 0004 and 0006
reports `valve-frame` with the [section 3](#3-the-valve-frame-gamepad-layout)
layout; the extracted controller models show and animate; controllers
vibrate through patch 0008; `userAgentData` identifies the Frame (its user
agent says x86_64). Still open:

1. **IWFDK's rendering workarounds in a Frame browser without Chromium XR's
   fixes** (the community build): both eyes render with
   `render.finishXRFrames: 'auto'`, and what the finish costs at 90 Hz.
2. **What such a browser reports** (`oculus-touch` is expected from Valve's
   documentation of Touch emulation), so that `frame.layout` reads
   `remapped`.
3. **Chromium XR Sandboxed** (seccomp filter on).
4. **Pinch thresholds** against Frame hand-tracking noise.
