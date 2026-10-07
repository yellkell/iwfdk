# IWFDK frame kit

Steam Frame support for WebXR apps that don't use IWFDK: three.js, A-Frame,
React Three Fiber or plain WebXR. Three dependency-free ES modules; copy them
into your project.

| File                      | What it does                                                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `steam-frame.js`          | `FrameControls` (the Frame's buttons, with a fallback for browsers that report Touch controllers), `pulse()` haptics, `prepareFrameRendering()` (the Frame browsers' rendering fixes), `isSteamFrame()`, `frameLayout()` |
| `steam-frame-models.js`   | `FrameControllerModels`: the real Frame controller models on three.js controller grips, animated from the gamepad (needs `three`)                                                                                        |
| `steam-frame-emulator.js` | `installFrameEmulator()`: a virtual Steam Frame (IWER) for development, driven by `frameEmulator.press('left', 'dpad-up')`                                                                                               |

```js
import { FrameControls, prepareFrameRendering, pulse } from './steam-frame.js';
import { FrameControllerModels } from './steam-frame-models.js';

prepareFrameRendering(renderer);
const frameModels = new FrameControllerModels(renderer);
const controls = new FrameControls();

renderer.setAnimationLoop(() => {
  controls.update(renderer.xr.getSession());
  frameModels.update();
  if (controls.right.select.justPressed) fire();
  if (controls.dpad.right.justPressed) nextWeapon();
  if (controls.menu.justPressed) togglePause();
  renderer.render(scene, camera);
});
```

Porting an app with a coding agent: point it at
[`docs/public/skills/steam-frame-port/SKILL.md`](../../docs/public/skills/steam-frame-port/SKILL.md).
Why each fix exists: [FRAME.md section 5](../../FRAME.md#5-making-a-webxr-app-great-on-the-steam-frame).
The controller layout: [FRAME.md section 3](../../FRAME.md#3-the-valve-frame-gamepad-layout).

Tests: `node --test test/steam-frame.test.mjs`. The emulator's device is kept
identical to IWFDK's dev server by
`packages/vite-plugin-dev/test/steam-frame-device.test.ts`.
