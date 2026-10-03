# Input Actions

`world.input.actions` maps low-level device state into reusable framework intent. It sits alongside the raw input devices:

- `world.input.xr`
- `world.input.keyboard`
- `world.input.browserGamepads`

Use raw device state when your app needs a specific key, controller button, or gamepad. Use actions when a reusable system should not care where the input came from.

## Built-In Actions

The first built-in actions are intentionally narrow:

| Action                      | Value   | Used By                                     |
| --------------------------- | ------- | ------------------------------------------- |
| `locomotion.move`           | 2D axis | Slide locomotion                            |
| `locomotion.turn`           | 1D axis | Snap/smooth turn                            |
| `locomotion.jump`           | button  | Jump                                        |
| `locomotion.teleportAim`    | button  | Teleport aiming                             |
| `locomotion.teleportCommit` | button  | Reserved for explicit teleport confirmation |
| `interaction.select`        | button  | Reserved for browser/XR selection adapters  |

XR bindings are enabled by default so existing XR locomotion keeps using the same controller inputs. Browser-first locomotion bindings are opt-in:

```ts
const world = await World.create(container, {
  xr: false,
  features: {
    locomotion: {
      browserControls: true,
    },
  },
});
```

`browserControls: true` binds WASD/arrow keys, Space, and standard browser gamepad controls to locomotion actions. Apps can still read raw devices directly or replace bindings on `world.input.actions`.

## Why Actions

Actions let systems bind to intent:

```ts
const move = world.input.actions.getAxis2D('locomotion.move');
const jumping = world.input.actions.getButtonDown('locomotion.jump');
```

The source might be an XR thumbstick, keyboard, browser gamepad, mobile virtual joystick, or a custom app UI. The system does not need to know.

Actions do not own camera behavior. Pointer lock, touch-look, orbit, follow, and third-person cameras are app-level systems that can produce or consume actions as needed.

## Custom Actions

Apps can define their own action names and bind them to raw devices:

```ts
const PlayerJetpack = 'player.jetpack';

world.input.actions.addBinding({
  source: 'keyboard',
  kind: 'button',
  action: PlayerJetpack,
  code: 'ShiftLeft',
});

if (world.input.actions.getButtonPressed(PlayerJetpack)) {
  // Apply your app-specific jetpack behavior.
}
```
