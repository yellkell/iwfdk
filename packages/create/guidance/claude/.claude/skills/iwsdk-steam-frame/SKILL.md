---
name: iwsdk-steam-frame
description: Valve Steam Frame controls, haptics, rendering limits, and emulator testing for this IWFDK app. Use when a request reads controller buttons or sticks, binds input actions, adds vibration, tests input through the XR emulator, or targets Steam Frame performance or rendering.
---

# Steam Frame

This app is built with IWFDK, the Immersive Web SDK adapted to the Valve Steam
Frame. Its main target is the Frame's WebXR browser, Chromium XR. The XR
emulator (IWER) emulates a Frame by default: `dev.emulator.device` in
`iwsdk.config.json` is `steamFrame`.

| `dev.emulator.device` | What it emulates                                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `steamFrame`          | Chromium XR on a Frame: controllers report `valve-frame`, with every Frame control                                                                          |
| `steamFrameTouch`     | another Frame browser (no IWFDK Chromium patches): SteamVR presents the controllers as Touch controllers, so the D-pad, shoulders, menu and view are absent |
| `metaQuest3` ...      | Quest headsets; use for AR projects, since the Frame has no WebXR AR                                                                                        |

## Read controls through `this.input.frame`

`this.input.frame` (`world.input.frame` outside systems) is updated before
systems run and works with every controller layout:

| Control                    | Read it as                                                                     |
| -------------------------- | ------------------------------------------------------------------------------ |
| A / B (right)              | `frame.a`, `frame.b`                                                           |
| X / Y (right on the Frame) | `frame.x`, `frame.y`                                                           |
| Menu (right) / View (left) | `frame.menu`, `frame.view`                                                     |
| D-pad (left)               | `frame.dpad.up` / `.down` / `.left` / `.right`                                 |
| Shoulder (each hand)       | `frame.left.shoulder`, `frame.right.shoulder`                                  |
| Trigger / grip (each hand) | analog `frame.right.trigger`, `.squeeze`; buttons `.select`, `.grip`           |
| Thumbstick (each hand)     | `frame.left.thumbstick.x` / `.y` (**y is down-positive**), `.thumbstickButton` |
| Pinch (hand tracking)      | `frame.hands.right.pinch.justPinched`, `.pinching`, `.strength`                |

Each button has `pressed`, `justPressed`, `justReleased` and `touched`.

```ts
import { createSystem } from '@iwsdk/core';

export class PlayerControls extends createSystem({}) {
  update() {
    const frame = this.input.frame;
    if (frame.a.justPressed) this.jump();
    if (frame.menu.justPressed || frame.b.justPressed) this.togglePause();
    if (frame.dpad.left.justPressed) this.previousItem();
    if (frame.dpad.right.justPressed) this.nextItem();
  }
}
```

Input actions take the same names and also bind keyboard and browser gamepads:

```ts
world.input.actions.addBindings([
  { source: 'frame', kind: 'button', action: 'game.pause', button: 'menu' },
  { source: 'frame', kind: 'button', action: 'game.next', button: 'dpadRight' },
  { source: 'keyboard', kind: 'button', action: 'game.pause', code: 'Escape' },
]);
```

`button` is one of `a b x y menu view dpadUp dpadDown dpadLeft dpadRight`.
Shoulders are per hand (`frame.left.shoulder`), not action buttons.

Rules:

- **Give every essential action a path that works without the Frame-only
  controls.** On `steamFrameTouch` (and Quest) there are no shoulders, view or
  physical D-pad: `frame.layout` is `'remapped'` or `'other'`, the D-pad comes
  from the left stick (`frame.dpadEmulated` is true) and `frame.view` never
  fires. Put core actions on trigger, grip, stick, A/B or X/Y; use the D-pad,
  shoulders, menu and view for shortcuts. With `frame.layout === 'remapped'`,
  hints may say the browser lacks full Frame controller support.
- **Don't hard-code Touch slots.** The Frame has X/Y on the **right**
  controller; reading the left gamepad's X/Y works only through the browser's
  mirror. `frame.x` is right in every case.
- Don't add a Frame model loader. Frame controller models load by themselves
  in a Frame browser.

## Vibration

```ts
import { pulseHaptics } from '@iwsdk/core';

this.input.frame.vibrate('right', 0.5, 40); // hand, amplitude 0..1, ms
pulseHaptics(this.input.xr.gamepads.right?.inputSource, 0.6, 30);
```

Both return `false` when the browser exposes no actuator. Never call
`gamepad.hapticActuators[0].pulse()` directly: Chromium XR vibrates only
through `vibrationActuator.playEffect`, and the helpers try both.

## Rendering and performance

- Don't require the WebXR `layers` feature. Frame browsers can't composite
  layers. On a Frame IWFDK renders through an `XRWebGLLayer` and asks for
  `layers` only when the app requires it; a page that draws into layers there
  shows black in the headset.
- No AR session features: no `immersive-ar`, hit test, anchors, planes, meshes
  or depth sensing.
- The page can't pick the refresh rate or the resolution; SteamVR sets them
  per app (90 Hz by default: 11.1 ms per frame, on a mobile GPU). Treat
  fill rate as the budget: lower `renderer.xr.setFramebufferScaleFactor()`
  before entering XR for a heavy scene, and keep shaders and overdraw modest.
- Keep `render.finishXRFrames` at its default `'auto'`.

## Test Frame input in the emulator

Enter XR first (`npx @iwsdk/cli xr status` must report an active session).
`xr_get_gamepad_state` lists every button of the emulated controller by
`index` and `name`. On `steamFrame`:

| `device`           | Names after the Touch-compatible ones (0-5)                           |
| ------------------ | --------------------------------------------------------------------- |
| `controller-right` | `x`, `y`, `shoulder`, `menu` (`a`, `b` are 3 and 4)                   |
| `controller-left`  | `dpad-up`, `dpad-down`, `dpad-left`, `dpad-right`, `shoulder`, `view` |

Press by `name`, then release in a later call so the app sees `justPressed`
and `justReleased`:

```bash
npx @iwsdk/cli xr set-gamepad-state --input-json '{"device":"controller-left","buttons":[{"name":"dpad-right","value":1}]}'
npx @iwsdk/cli xr set-gamepad-state --input-json '{"device":"controller-left","buttons":[{"name":"dpad-right","value":0}]}'
```

X and Y are one physical button each on the right controller: pressing `x` on
either controller shows on both, as in Chromium XR. The thumbstick is `axes`
index 0 (x) and 1 (y).

To prove a Frame-only shortcut has its fallback, switch `dev.emulator.device`
to `steamFrameTouch` (announce it: Vite restarts and the managed window
reconnects; wait for `browserCommandReady: true`), repeat the scenario using
the left stick instead of the D-pad (`"axes":[{"index":0,"value":1}]` is
D-pad right), then switch back to `steamFrame`.

## On a real Steam Frame

There is no ADB: `runtime pair-headset` and physical-target commands are for
Quest. Open a URL from `npx @iwsdk/cli dev status` → `data.runtimeUrls.network`
in Chromium XR on a Frame on the same Wi-Fi network and accept the local
certificate warning. Claims about feel, comfort or frame rate on the Frame need
that test; the emulator proves logic and layout, not performance.
