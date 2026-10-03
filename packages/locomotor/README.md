# @iwsdk/locomotor

Locomotion engine for Three.js WebXR applications. Provides physics-based movement, teleportation, and collision detection with BVH-accelerated mesh queries.

## Features

- 🚶 **Smooth Locomotion** - Continuous movement with configurable speed and gravity
- 🎯 **Teleportation** - Parabolic ray casting for point-and-teleport navigation
- 💥 **Collision Detection** - BVH-accelerated mesh collision using three-mesh-bvh
- 🌍 **Gravity & Physics** - Configurable gravity, ground detection, and jump support
- ⚡ **Worker Support** - Optional Web Worker for off-main-thread physics calculations
- 🎮 **Input Agnostic** - Works with any input system (controllers, hands, keyboard)

## Installation

```bash
npm install @iwsdk/locomotor three three-mesh-bvh
```

## Quick Start

```typescript
import { Locomotor, EnvironmentType } from '@iwsdk/locomotor';
import { Mesh, Vector3 } from 'three';

// Create the locomotion engine
const locomotor = new Locomotor({
  initialPlayerPosition: new Vector3(0, 2, 0),
  useWorker: true, // Run physics in a Web Worker
  rayGravity: -0.4,
  maxDropDistance: 5.0,
  jumpHeight: 1.5,
});

// Initialize (required before use)
await locomotor.initialize();

// Add collision meshes
const floor = new Mesh(/* ... */);
locomotor.addEnvironment(floor, EnvironmentType.STATIC);

// Add moving platforms
const platform = new Mesh(/* ... */);
const platformHandle = locomotor.addEnvironment(
  platform,
  EnvironmentType.KINEMATIC,
);
```

## Update Loop

```typescript
function update(delta: number) {
  // Request movement from thumbstick input
  locomotor.requestUpdate(
    thumbstickX, // strafe
    thumbstickY, // forward/back
    headPosition,
    headQuaternion,
    shouldJump,
  );

  // Update kinematic (moving) environments
  locomotor.updateKinematicEnvironment(platformHandle, platform);

  // Get resulting position
  const playerPos = locomotor.position;
  const grounded = locomotor.isGrounded;
}
```

## Teleportation

```typescript
// Cast a parabolic ray for teleportation
locomotor.requestRaycast(rayOrigin, rayDirection, (result) => {
  if (result.hit) {
    // Show teleport indicator at result.point
    teleportMarker.position.copy(result.point);
    teleportMarker.visible = true;
  }
});

// Execute teleport
locomotor.teleportTo(targetPosition);
```

## Configuration Options

```typescript
interface LocomotorConfig {
  initialPlayerPosition?: Vector3; // Starting position
  updateFrequency?: number; // Physics updates per second (default: 60)
  rayGravity?: number; // Gravity for teleport arc (default: -0.4)
  maxDropDistance?: number; // Max fall distance (default: 5.0)
  jumpHeight?: number; // Jump height in meters (default: 1.5)
  jumpCooldown?: number; // Time between jumps (default: 0.1)
  useWorker?: boolean; // Use Web Worker (default: true)
}
```

## Environment Types

```typescript
import { EnvironmentType } from '@iwsdk/locomotor';

// Static environments (floors, walls, terrain)
locomotor.addEnvironment(mesh, EnvironmentType.STATIC);

// Kinematic environments (moving platforms, elevators)
locomotor.addEnvironment(mesh, EnvironmentType.KINEMATIC);
```

## Peer Dependencies

- `three` >= 0.160.0
- `three-mesh-bvh` >= 0.9.1

## Documentation

For more information, visit: **[https://iwsdk.dev](https://iwsdk.dev)**

## License

MIT © Meta Platforms, Inc.
