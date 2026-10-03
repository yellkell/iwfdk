---
outline: [2, 4]
---

# Chapter 14: Environment Raycast

The IWSDK provides an environment raycast system that enables AR applications to detect real-world surfaces and place virtual content on them. This chapter covers implementing hit-testing in your WebXR applications.

## What You'll Build

By the end of this chapter, you'll be able to:

- Set up environment raycasting for AR hit-testing
- Create objects that follow controller raycasts to real-world surfaces
- Place virtual content on detected surfaces with a trigger press
- Configure different ray sources (controllers, gaze, screen touch)
- Align objects to surface normals automatically

## Overview

The environment raycast system leverages WebXR's hit-test API to cast rays against real-world geometry and position virtual objects at hit points. Unlike Scene Understanding (Chapter 11), environment raycasting **does not require room scanning** - it works immediately using real-time surface detection.

### Environment Raycast vs Scene Understanding

| Feature                   | Environment Raycast | Scene Understanding |
| ------------------------- | ------------------- | ------------------- |
| Room scanning required    | No                  | Yes                 |
| Works immediately         | Yes                 | After scanning      |
| Provides surface position | Yes                 | Yes                 |
| Provides surface normal   | Yes                 | Yes                 |
| Detects planes/meshes     | No                  | Yes                 |
| Semantic labels           | No                  | Yes                 |
| Best for                  | Instant placement   | Rich scene data     |

**Use Environment Raycast when** you want immediate tap-to-place or controller-based placement without waiting for room scanning.

**Use Scene Understanding when** you need detailed information about detected surfaces like semantic labels (table, wall, floor) or mesh geometry.

### Key Components

- **`EnvironmentRaycastSystem`** - Core system that manages WebXR hit-test sources
- **`EnvironmentRaycastTarget`** - Component that positions an entity at raycast hit points
- **`RaycastSpace`** - Enum for ray source selection (Left, Right, Viewer, Screen)

## Quick Start

Here's a minimal example to get environment raycasting working:

```typescript
import {
  World,
  SessionMode,
  EnvironmentRaycastTarget,
  RaycastSpace,
} from '@iwsdk/core';

World.create(document.getElementById('scene-container'), {
  xr: {
    sessionMode: SessionMode.ImmersiveAR,
    features: {
      hitTest: { required: true }, // Enable WebXR hit-test
    },
  },
  features: {
    environmentRaycast: true, // Enable EnvironmentRaycastSystem
  },
}).then((world) => {
  // Create a reticle that follows the raycast
  const reticleMesh = createReticleMesh(); // Your reticle geometry
  const reticle = world.createTransformEntity(reticleMesh);

  reticle.addComponent(EnvironmentRaycastTarget, {
    space: RaycastSpace.Right, // Use right controller
    maxDistance: 10, // Maximum raycast distance in meters
  });

  // The reticle now automatically:
  // - Moves to where the controller points at real surfaces
  // - Orients to match the surface normal
  // - Hides when there's no hit
});
```

## System Setup

### Step 1: Enable WebXR Hit-Test Feature

```typescript
World.create(container, {
  xr: {
    sessionMode: SessionMode.ImmersiveAR,
    features: {
      hitTest: { required: true }, // Required for environment raycast
    },
  },
  features: {
    environmentRaycast: true,
  },
});
```

**Important**: The `hitTest` WebXR feature must be enabled for environment raycasting to work.

### Step 2: Create a Raycast Target Entity

```typescript
const previewMesh = createPreviewMesh();
const previewEntity = world.createTransformEntity(previewMesh);

previewEntity.addComponent(EnvironmentRaycastTarget, {
  space: RaycastSpace.Right,
  maxDistance: 10,
});
```

The entity's Object3D will automatically:

- **Position** at the raycast hit point
- **Orient** to match the surface normal
- **Hide** when there's no hit (visibility set to false)

## Understanding the Components

### EnvironmentRaycastTarget

Makes an entity follow environment raycast hit points.

#### Input Properties

- **`space`** - Ray source: `RaycastSpace.Left`, `Right`, `Viewer`, or `Screen` (default: `Right`)
- **`maxDistance`** - Maximum raycast distance in meters (default: `100`)
- **`offsetPosition`** - Offset from ray origin (default: `undefined`)
- **`offsetQuaternion`** - Rotation offset for ray direction (default: `undefined`)

#### Output Properties (Read-only)

- **`xrHitTestResult`** - The underlying `XRHitTestResult` when there's a hit, `undefined` otherwise
- **`inputSource`** - For Screen mode: the `XRInputSource` that triggered the hit

```typescript
// Check if there's a valid hit
const xrResult = entity.getValue(EnvironmentRaycastTarget, 'xrHitTestResult');
if (xrResult) {
  console.log('Hit detected at:', entity.object3D.position);
}
```

### RaycastSpace Options

Choose the ray source based on your use case:

| Space                 | Description                   | Best For                   |
| --------------------- | ----------------------------- | -------------------------- |
| `RaycastSpace.Right`  | Right controller's target ray | Quest controller placement |
| `RaycastSpace.Left`   | Left controller's target ray  | Left-handed users          |
| `RaycastSpace.Viewer` | Head/gaze direction           | Gaze-based placement       |
| `RaycastSpace.Screen` | Screen touch (phone AR)       | Tap-to-place on phones     |

## Common Patterns

### Preview + Place Pattern

The most common pattern: show a preview that follows the raycast, then spawn a permanent object on trigger press.

```typescript
import {
  AssetManager,
  createSystem,
  EnvironmentRaycastTarget,
  RaycastSpace,
} from '@iwsdk/core';

class PlacementSystem extends createSystem({
  targets: { required: [EnvironmentRaycastTarget] },
}) {
  private previewEntity: Entity | null = null;

  init() {
    // Create preview object
    const previewMesh = AssetManager.getGLTF('myObject').scene.clone();
    this.previewEntity = this.world.createTransformEntity(previewMesh);
    this.previewEntity.addComponent(EnvironmentRaycastTarget, {
      space: RaycastSpace.Right,
      maxDistance: 10,
    });
  }

  update() {
    const triggerPressed = this.input.xr.gamepads.right?.getSelectStart();

    if (triggerPressed && this.previewEntity) {
      const xrResult = this.previewEntity.getValue(
        EnvironmentRaycastTarget,
        'xrHitTestResult',
      );

      // Only place if we have a valid hit and preview is visible
      if (xrResult && this.previewEntity.object3D?.visible) {
        this.spawnObject(
          this.previewEntity.object3D.position.clone(),
          this.previewEntity.object3D.quaternion.clone(),
        );
      }
    }
  }

  private spawnObject(position: Vector3, quaternion: Quaternion) {
    const mesh = AssetManager.getGLTF('myObject').scene.clone();
    mesh.position.copy(position);
    mesh.quaternion.copy(quaternion);
    this.scene.add(mesh);
    this.world.createTransformEntity(mesh);
  }
}
```

### Phone AR Tap-to-Place

For phone-based AR experiences, use `RaycastSpace.Screen` to detect where the user taps:

```typescript
const reticle = world.createTransformEntity(reticleMesh);
reticle.addComponent(EnvironmentRaycastTarget, {
  space: RaycastSpace.Screen, // Tracks screen touch
  maxDistance: 10,
});

// In your system, check for the input source
class TapPlaceSystem extends createSystem({
  targets: { required: [EnvironmentRaycastTarget] },
}) {
  update() {
    this.queries.targets.entities.forEach((entity) => {
      const inputSource = entity.getValue(
        EnvironmentRaycastTarget,
        'inputSource',
      );
      const xrResult = entity.getValue(
        EnvironmentRaycastTarget,
        'xrHitTestResult',
      );

      // inputSource is set when user is touching the screen
      if (inputSource && xrResult) {
        // Place object at touch point
        this.placeObject(entity.object3D.position.clone());
      }
    });
  }
}
```

### Gaze-Based Placement

For hands-free placement using head gaze:

```typescript
const reticle = world.createTransformEntity(reticleMesh);
reticle.addComponent(EnvironmentRaycastTarget, {
  space: RaycastSpace.Viewer, // Uses head/gaze direction
  maxDistance: 5,
});
```

### Multiple Raycast Sources

You can have multiple entities with different ray sources:

```typescript
// Left hand reticle
const leftReticle = world.createTransformEntity(leftMesh);
leftReticle.addComponent(EnvironmentRaycastTarget, {
  space: RaycastSpace.Left,
});

// Right hand reticle
const rightReticle = world.createTransformEntity(rightMesh);
rightReticle.addComponent(EnvironmentRaycastTarget, {
  space: RaycastSpace.Right,
});
```

## Surface Alignment

The system automatically orients objects to match the surface normal. This means:

- Objects placed on floors stand upright
- Objects placed on walls align to the wall surface
- Objects placed on angled surfaces match that angle

The orientation is applied using the hit result's pose, which includes the surface normal direction.

## Troubleshooting

### Common Issues

**Raycast not working:**

- Verify `hitTest: { required: true }` in XR features
- Verify `environmentRaycast: true` in World features
- Check that you're in an AR session (not VR)
- Ensure the device supports WebXR hit-test

**Preview object not visible:**

- The object is hidden when there's no hit - point at a surface
- Check `maxDistance` isn't too small
- Verify the object's mesh and material are correct

**Wrong controller:**

- Check the `space` property matches your intended controller
- For left-handed users, use `RaycastSpace.Left`

**Object not aligned to surface:**

- The system uses the hit result's pose for orientation
- Check that you're copying both position and quaternion when spawning

### Debug Tips

```typescript
class DebugSystem extends createSystem({
  targets: { required: [EnvironmentRaycastTarget] },
}) {
  update() {
    this.queries.targets.entities.forEach((entity) => {
      const xrResult = entity.getValue(
        EnvironmentRaycastTarget,
        'xrHitTestResult',
      );
      const visible = entity.object3D?.visible;

      console.log({
        hasHit: !!xrResult,
        visible,
        position: entity.object3D?.position,
      });
    });
  }
}
```

## Performance Considerations

1. **Limit raycast targets** - Each `EnvironmentRaycastTarget` creates a WebXR hit-test source
2. **Use appropriate maxDistance** - Shorter distances may perform slightly better
3. **Clean up unused entities** - Remove raycast components when not needed

## Best Practices

1. Always check for valid hit before placing objects
2. Provide visual feedback (preview object) before placement
3. Use appropriate `RaycastSpace` for your input method
4. Handle the case when no surface is detected (object hidden)
5. Test on target devices as hit-test capabilities vary

## Example Projects

Check out the complete implementation in the SDK:

- **`examples/environment-raycast`** - AR plant placement with controller-based raycasting

```bash
cd immersive-web-sdk
pnpm install
pnpm run build:tgz
cd examples/environment-raycast
npm install
npm run dev
```

## What's Next

You now know how to detect real-world surfaces and place virtual content in AR! Combined with Scene Understanding (Chapter 11), you have powerful tools for building AR experiences.

Consider exploring:

- Combining environment raycast with physics for realistic object placement
- Using anchors (from Scene Understanding) to persist placed objects
- Building interactive AR furniture placement apps
