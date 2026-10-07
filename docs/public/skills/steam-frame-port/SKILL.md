---
name: steam-frame-port
description: Bring an existing WebXR app or game (three.js, A-Frame, React Three Fiber, or plain WebXR) to the Valve Steam Frame. Use when asked to support the Steam Frame, show Steam Frame controllers, map controls to the Frame's D-pad, shoulders, menu and view, fix a black or one-eyed headset view on the Frame, or make haptics work there.
argument-hint: '[project path or what to port]'
---

# Port a WebXR app to the Steam Frame

Make an existing WebXR app work well on the Valve Steam Frame without
rewriting it: real Frame controllers, controls that use the Frame's buttons,
and the Frame browsers' compatibility fixes. Then try every control on a
virtual Frame. Preserve the app's behavior on other headsets.

User context is in `$ARGUMENTS`.

The tools come from IWFDK's frame kit (`packages/frame-kit` in
github.com/yellkell/iwfdk, branch `feat/frame-sdk`), three dependency-free ES
modules. Copy them into the project rather than linking a CDN, so they are
reviewed and versioned with it:

```bash
base=https://raw.githubusercontent.com/yellkell/iwfdk/feat/frame-sdk/packages/frame-kit
mkdir -p src/steam-frame
for f in steam-frame.js steam-frame-models.js steam-frame-emulator.js README.md; do
  curl -fsSL "$base/$f" -o "src/steam-frame/$f"
done
```

`steam-frame.js` needs nothing; `steam-frame-models.js` imports `three` and
`three/addons/loaders/GLTFLoader.js` (bundler, or an import map with
`three/addons/`); `steam-frame-emulator.js` loads the IWER emulator from
jsDelivr and is for development only.

## 0. Look first

1. `git status`: preserve existing work; never reset or delete it.
2. Find the stack and the XR entry points: where the session starts (three.js
   `VRButton`, `renderer.xr.setSession`, A-Frame's `a-scene`, a custom
   `navigator.xr.requestSession`), where controllers are created and drawn
   (`getController`, `getControllerGrip`, `XRControllerModelFactory`), every
   place that reads `gamepad.buttons[...]`, `gamepad.axes[...]` or
   `inputSource.profiles`, and every haptics call.
3. Write down the current control scheme (button → action). You will map it.

For an app built on IWSDK, prefer moving it to IWFDK, which does all of this
natively (`FRAME.md` in the IWFDK repo). The steps below are for everything
else.

## 1. Compatibility fixes

These make the headset show the app at all.

```js
import { prepareFrameRendering, frameSessionInit } from './steam-frame/steam-frame.js';

prepareFrameRendering(renderer); // before renderer.setAnimationLoop and entering XR
```

- **Projection layers show black on a Frame.** Frame browsers can't composite
  WebXR layers, and three.js renders into a projection layer whenever
  `XRWebGLBinding.createProjectionLayer` exists. `prepareFrameRendering` hides
  it while three.js sets the session up. Never put `layers` in
  `requiredFeatures`; for a custom `requestSession`, pass the init through
  `frameSessionInit()`. If the app draws layer content (quad/cylinder layers),
  give it a mesh fallback.
- **One eye black or flickering** in Frame browsers without Chromium XR's fix.
  `prepareFrameRendering` ends each XR frame with `gl.finish()` there and only
  there (`finishXRFrames: 'auto'`).
- **Request the session once.** A second `requestSession()` while one is
  pending or active rejects. Ignore Enter VR clicks while a request is in
  flight.
- **Don't detect headsets by user agent.** The Frame's says "Linux x86_64".
  Use `isSteamFrame()` (it asks `navigator.userAgentData` for the CPU), or
  better, the controllers' profiles (`frameLayout()`).
- **Budget:** the Frame renders each eye at SteamVR's resolution (up to
  2160×2160) at 90 Hz or more on a mobile GPU. If frames drop, lower
  `renderer.xr.setFramebufferScaleFactor()` before entering XR. The page can't
  change the refresh rate.

## 2. Steam Frame controllers

```js
import { FrameControllerModels } from './steam-frame/steam-frame-models.js';

const frameModels = new FrameControllerModels(renderer);
// every frame:
frameModels.update();
```

It puts the real Frame controller models (as SteamVR shows them, with
animated triggers, grips, sticks and shoulders) on `renderer.xr`'s controller grips
when Frame controllers connect, and hides the grip's other models meanwhile, so
keep `XRControllerModelFactory` for other headsets. Pointers, lasers and hands
attached to `getController(i)` stay as they are. A-Frame: `renderer` is
`sceneEl.renderer`; React Three Fiber: `useThree((s) => s.gl)`.

## 3. Controls

Read the controls through `FrameControls` instead of raw indices. It knows the
Frame's layout and falls back for browsers that report Touch controllers:

```js
import { FrameControls, pulse } from './steam-frame/steam-frame.js';

const controls = new FrameControls();
renderer.setAnimationLoop((time, frame) => {
  controls.update(renderer.xr.getSession());
  if (controls.right.select.justPressed) fire();
  if (controls.dpad.right.justPressed) nextWeapon();
  if (controls.menu.justPressed) togglePause();
  // ...
});
```

| Control | Read it as | Notes |
| --- | --- | --- |
| Trigger / grip, each hand | `controls.left.trigger` (0..1), `.select`, `.squeeze`, `.grip` | buttons have hysteresis |
| Thumbstick, each hand | `controls.right.thumbstick.x` / `.y`, `.thumbstickButton` | Gamepad API: **y is down** |
| A / B | `controls.a`, `controls.b` | right controller |
| X / Y | `controls.x`, `controls.y` | **right** controller on the Frame, left on Quest |
| Menu | `controls.menu` | right on the Frame, left on Quest |
| View | `controls.view` | left, Frame only |
| D-pad | `controls.dpad.up` ... `.right` | left, Frame only; from the left stick elsewhere |
| Shoulder, each hand | `controls.left.shoulder` | Frame only |

Each button has `pressed`, `justPressed`, `justReleased`, `touched`;
`controls.layout` is `frame`, `remapped` (a Frame browser reporting Touch
controllers), `other` or `none`.

Map the app's scheme:

1. Keep what already works: trigger, grip, sticks, A/B/X/Y.
2. Fix what Quest code gets wrong on a Frame. Raw reads of the Touch layout
   collide with Frame buttons: the left gamepad's slot 7 (Touch's left menu)
   is the Frame's **D-pad up**, so a Quest pause button fires from the D-pad.
   Replace raw `gamepad.buttons[i]` reads with `FrameControls`.
3. Use the Frame's extra buttons where they make the app better: D-pad for
   menus, weapon or item selection; shoulders for secondary actions; menu for
   pause; view for a map or HUD toggle.
4. Every essential action must still work without the Frame-only buttons
   (other headsets, or `layout === 'remapped'`): give it a trigger, grip,
   stick or A/B/X/Y path. D-pad shortcuts get the left-stick fallback for free.
5. Haptics: replace `hapticActuators[0].pulse(...)` with
   `pulse(inputSource, intensity, ms)`. Chromium XR vibrates only through
   `vibrationActuator`; `pulse` tries both.

## 4. Try every control on a virtual Frame

Load the emulator in development only, before the app requests a session:

```js
if (import.meta.env?.DEV || location.hostname === 'localhost') {
  const { installFrameEmulator } = await import('./steam-frame/steam-frame-emulator.js');
  await installFrameEmulator(); // { device: 'steamFrameTouch' } for the fallback path
}
```

Then, in the browser (DevTools, Playwright, or your browser tool), enter XR
through the app's own button and drive the Frame:

```js
await frameEmulator.press('left', 'dpad-right');   // dpad-up/down/left/right
await frameEmulator.press('right', 'menu');         // a b x y menu shoulder trigger squeeze
await frameEmulator.press('left', 'view');
frameEmulator.stick('left', 1, 0);                  // Gamepad axes, y down
frameEmulator.place('right', [0.2, 1.4, -0.3]);     // or 'head', 'left'
frameEmulator.buttons('left');                      // names
```

Verify, with app state or screenshots:

- the Frame controller models show (not Touch, not generic);
- every mapped action fires from its Frame button, and nothing fires from a
  button it shouldn't (press each D-pad direction and the menu);
- on `{ device: 'steamFrameTouch' }`, every essential action still works;
- no console errors when entering and leaving XR twice.

The emulator proves logic and mapping, not frame rate: performance and
comfort need a real Frame (Chromium XR from github.com/yellkell/frameplayer
releases).

## 5. Report

List the control mapping before → after, the compatibility fixes applied, and
what you verified on the virtual Frame and what still needs a headset.
