# @iwsdk/xr-input

WebXR input system for Three.js applications. Provides controller and hand tracking support with visual adapters, input profiles, and seamless pointer event integration.

## Features

- 🎮 **Controller Support** - Automatic controller model loading with input profiles
- ✋ **Hand Tracking** - Full hand skeleton tracking with joint positions
- 👆 **Pointer Events** - Integration with @pmndrs/pointer-events for spatial interaction
- 📋 **Input Profiles** - Pre-configured profiles for Meta Quest controllers
- 🎨 **Visual Adapters** - Animated controller and hand mesh rendering
- 🔄 **Hot-Swapping** - Seamless switching between controllers and hands

## Installation

```bash
npm install @iwsdk/xr-input three
```

## Quick Start

```typescript
import { XRInputManager } from '@iwsdk/xr-input';
import { PerspectiveCamera, Scene, WebGLRenderer } from 'three';

const scene = new Scene();
const camera = new PerspectiveCamera(75, window.innerWidth / window.innerHeight);
const renderer = new WebGLRenderer({ xr: { enabled: true } });

// Create the input manager
const inputManager = new XRInputManager({
  scene,
  camera,
});

// Add XR origin to scene
scene.add(inputManager.xrOrigin);

// In your render loop
renderer.setAnimationLoop((time, frame) => {
  const delta = /* calculate delta */;

  // Update input manager with XR state
  inputManager.update(renderer.xr, delta, time);

  renderer.render(scene, camera);
});
```

## Accessing Controllers

```typescript
// Get visual adapters for left/right
const leftAdapter = inputManager.visualAdapters.left.value;
const rightAdapter = inputManager.visualAdapters.right.value;

// Check if using controller or hand
if (leftAdapter?.type === 'controller') {
  // Controller is active
} else if (leftAdapter?.type === 'hand') {
  // Hand tracking is active
}
```

## Gamepad Input

```typescript
import { StatefulGamepad } from '@iwsdk/xr-input';

// Access gamepads (available after update)
const leftGamepad = inputManager.gamepads.left;
const rightGamepad = inputManager.gamepads.right;

if (rightGamepad) {
  // Button states
  const triggerPressed = rightGamepad.getButtonDown('xr-standard-trigger');
  const gripPressed = rightGamepad.getButtonDown('xr-standard-squeeze');

  // Thumbstick values
  const thumbstick = rightGamepad.getAxes('xr-standard-thumbstick');
  console.log(thumbstick.x, thumbstick.y);

  // Button events (pressed this frame)
  if (rightGamepad.getSelectStart()) {
    console.log('Trigger just pressed');
  }
}
```

## Multi-Pointer System

```typescript
// Access multi-pointer for spatial interactions
const leftPointer = inputManager.multiPointers.left;
const rightPointer = inputManager.multiPointers.right;

// Pointers integrate with @pmndrs/pointer-events
// They automatically handle ray and grab pointers
```

## XR Origin

The `XROrigin` provides the tracked reference space:

```typescript
const xrOrigin = inputManager.xrOrigin;

// Access head position
const headPosition = xrOrigin.head.position;
const headRotation = xrOrigin.head.quaternion;

// Access controller/hand positions via visual adapters
const rightHand = inputManager.visualAdapters.right.value;
if (rightHand) {
  const position = rightHand.getPosition();
  const rotation = rightHand.getQuaternion();
}
```

## Supported Devices

- Meta Quest 2
- Meta Quest 3
- Meta Quest Pro
- Oculus Quest 1
- Generic WebXR controllers

## Peer Dependencies

- `three` >= 0.160.0

## Documentation

For more information, visit: **[https://iwsdk.dev](https://iwsdk.dev)**

## License

MIT © Meta Platforms, Inc.
