# IWFDK on the Steam Frame

IWFDK is the Immersive Web SDK ([facebook/immersive-web-sdk](https://github.com/facebook/immersive-web-sdk))
adapted to the Valve Steam Frame. It carries the controller work from
[FramePlayer](https://github.com/yellkell/frameplayer)'s native OpenXR player
over to WebXR, so a page built with IWFDK gets the Frame's full gamepad layout
in a WebXR browser on the headset.

**Status (2026-10-03):** SDK side implemented and unit-tested; Chromium patch
written and unit-tested in isolation. **Nothing has run on a Frame yet.** The
Frame's OpenXR component paths are inferred, not confirmed (see
[What still needs a Frame](#what-still-needs-a-frame)).

---

## 1. Why a fork

Three things stand between a WebXR page and the Frame controllers:

| Layer                             | Problem                                                                                                                                                                                                                                                   | IWFDK change                                                                                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser (Chromium OpenXR backend) | Chromium has no Frame interaction profile. SteamVR remaps the Frame onto the Index profile, and Chromium's Index mapping exposes trigger, grip, stick and **one** face button (`a`) per hand. X/Y, B, D-pad, bumpers, view and menu never reach the page. | `platform/chromium/patches/0004-*`: adds `/interaction_profiles/valve/frame_controller_valve`, reported as `valve-frame` with a fixed 10-button gamepad layout. |
| Input profile                     | No `valve-frame` profile exists in `@webxr-input-profiles`, and IWSDK only resolves profiles baked in from that package.                                                                                                                                  | `registerInputProfile()` in `@iwsdk/xr-input`; `valve-frame` registered by default.                                                                             |
| SDK input semantics               | IWSDK reads controllers per hand and per component; Frame apps think in gamepad terms (A/B/X/Y, D-pad, menu/view) and must also work on the unpatched browser.                                                                                            | `FrameInput`: a port of FramePlayer's `fp-xr` input layer, exposed as `world.input.frame`, plus a `frame` binding source for input actions.                     |

Package names stay `@iwsdk/*` for now so upstream merges stay mechanical (see
[Tracking upstream](#5-tracking-upstream)). New code is under
`packages/xr-input/src/frame/`, `packages/xr-input/src/gamepad/profiles/` and
`platform/chromium/`.

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
    if (frame.right.bumper.pressed) speedUp();

    // Per hand: trigger/squeeze are analog 0..1; select/grip are buttons
    // with hysteresis; the thumbstick uses Gamepad API axes (y down).
    const { x, y } = frame.left.thumbstick;

    if (frame.hands.right.pinch.justPinched) click();

    if (frame.layout === 'index-remap') {
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
`InputComponent` ids address Frame buttons directly:

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

| Control              | `valve-frame` (patched browser) | `valve-index` (unpatched browser on a Frame) | Touch-style (Quest, Pico, …) |
| -------------------- | ------------------------------- | -------------------------------------------- | ---------------------------- |
| A / B                | right A / B                     | right A / —                                  | right A / B                  |
| X / Y                | right X / Y                     | left A / —                                   | left X / Y                   |
| Menu                 | right menu                      | —                                            | left menu, if exposed        |
| View                 | left view                       | —                                            | —                            |
| D-pad                | left D-pad                      | emulated from left stick                     | emulated from left stick     |
| Bumper               | per hand                        | —                                            | —                            |
| Trigger, grip, stick | per hand                        | per hand                                     | per hand                     |

`frame.layout` reports which case applies: `frame`, `index-remap` (Index
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
`packages/xr-input/tests/frame-input.test.ts`.

## 3. The `valve-frame` gamepad layout

Fixed by the Chromium patch, so indices hold even when the runtime accepts only
the core bindings (unbound slots read released):

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
| 8     | bumper               | bumper               |
| 9     | view                 | menu                 |

Axes 0/1 are the touchpad placeholder and axes 2/3 the thumbstick. The profile
reports `["valve-frame", "generic-trigger-squeeze-thumbstick"]`, so other
WebXR libraries fall back to the generic layout. There is no Frame controller
model yet; the visual reuses the generic trigger/squeeze/thumbstick model.

## 4. Browser build

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

What patch 0004 does, beyond the profile table:

- **Fixed layout.** Chromium normally appends optional buttons only when they
  are bound, which would shift indices; for the Frame every slot is always
  emitted.
- **Menu is not the exit gesture.** Chromium ends the WebXR session on any
  `kMenu` press. The Frame's menu button gets its own type (`kAppMenu`) so
  pages can use it; the Steam button and SteamVR dashboard still end a
  session.
- **Wrong guesses cannot break input.** Chromium aborts all controller input
  if the runtime rejects any suggested binding. For the Frame profile only, a
  rejection is retried with the paths that mirror Index components, then
  skipped, so the runtime falls back to remapping the controllers onto Index.
  This mirrors the `full`/`core` binding tiers in FramePlayer's `fp-xr`.

Generated against `chromium/main` `2255089d4176` (2026-10-02); applies cleanly
there. The profile table and its unit test were compiled and run against
stand-ins for Chromium's `base` headers. The controller and input-helper
changes have **not** been compiled in a Chromium tree yet.

## 5. Tracking upstream

`upstream` is facebook/immersive-web-sdk; IWFDK started from 1.0.1
(`0778f51`) with full history.

```sh
git fetch upstream
git merge upstream/main
pnpm install && pnpm -r --filter '!@iwsdk/reference-assets' run build
pnpm --filter @iwsdk/xr-input test && pnpm --filter @iwsdk/core test
```

Upstream-touching edits are deliberately small: `InputComponent` (6 ids),
`input-profiles.ts` (registry), `xr-input/src/index.ts` (exports),
`core/src/input/input-manager.ts` and `input-actions.ts` (the `frame` source),
and `scripts/check-headers.mjs` (accepts the IWFDK header).

## 6. What still needs a Frame

Each item is marked `[verify]` in code where it applies. Run FramePlayer's
`frame-probe` (it dumps accepted Frame component paths) and fill in
`frameplayer/docs/platform-notes.md` first; the SDK tables are data, so fixes
are one-line changes.

1. **Component paths** of `frame_controller_valve`: bumper, X/Y, menu, view,
   D-pad and touch paths are inferred from the Index naming. Wrong ones fall
   back to the core tier (slots read released) rather than breaking input.
2. **Whether X/Y sit on the right controller** (Steam Deck-style split), as
   FramePlayer's outline states. If X/Y are on the left, move them in both
   the Chromium right/left maps and `VALVE_FRAME_PROFILE`.
3. **Whether the profile needs an OpenXR extension** to be enabled
   (vendor-suffixed name). If so, set `required_extension` in the patch.
4. **What SteamVR reports** for an unpatched browser (`valve-index` is
   assumed), and that the `index-remap` user-agent heuristic
   (`Linux aarch64`) matches the Frame browser.
5. **Pinch thresholds** against Frame hand-tracking noise.
6. **A Chromium build** with patch 0004, then `device_unittests` and an
   on-headset run of any IWFDK example: `frame.layout === 'frame'` and every
   button lights up.
