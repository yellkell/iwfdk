---
title: Entity
---

# Entity

An Entity is a lightweight container for Components. In IWSDK, Entities may also carry a Three.js `object3D`.

## Creating Entities

```ts
const e = world.createEntity();
const t = world.createTransformEntity(); // adds an Object3D and a Transform component
```

Parenting options:

```ts
const child = world.createTransformEntity(undefined, { parent: t });
const persistent = world.createTransformEntity(undefined, { persistent: true }); // parented under scene
```

## Object3D Attachment

```ts
import { Mesh, BoxGeometry, MeshStandardMaterial } from '@iwsdk/core';

const geometry = new BoxGeometry(1, 1, 1);
const material = new MeshStandardMaterial({ color: 0x00ff00 });
const mesh = new Mesh(geometry, material);

const entity = world.createTransformEntity(mesh);
```

`createTransformEntity` is the recommended way to attach Three.js objects to entities. It ensures `object3D` is properly managed and detached when the entity is released.

## Component Operations

```ts
e.addComponent(Health, { current: 100 });
e.removeComponent(Health);
e.has(Health); // boolean
```

## Reading & Writing Data (in Systems)

```ts
const v = e.getValue(Health, 'current'); // number | undefined
e.setValue(Health, 'current', 75);

// For vector fields (Types.Vec3) use a typed view:
const pos = e.getVectorView(Transform, 'position'); // Float32Array
pos[1] += 1; // move up
```

## Destroying Entities

IWSDK provides two ways to destroy entities:

### `entity.destroy()`

Removes the entity from the ECS and detaches its `object3D` from the scene graph:

```ts
entity.destroy();
```

This is safe and non-destructive to GPU resources. The geometry, materials, and textures remain in GPU memory and can be reused by other entities.

### `entity.dispose()`

Destroys the entity AND disposes all GPU resources (geometry, materials, textures):

```ts
entity.dispose();
```

::: warning
**Use with caution!** `dispose()` is destructive and will free GPU memory for:

- All geometries attached to the entity's `object3D` and its children
- All materials (including shared materials)
- All textures referenced by those materials

If other entities share the same geometry, material, or texture, they will break after calling `dispose()`.
:::

### When to use each

| Scenario                                                   | Method      |
| ---------------------------------------------------------- | ----------- |
| Removing an entity that uses shared/reusable assets        | `destroy()` |
| Removing an entity with unique, one-off geometry/materials | `dispose()` |
| Level unloading with asset reuse                           | `destroy()` |
| Full cleanup of procedurally generated content             | `dispose()` |

### Example: Safe cleanup pattern

```ts
// If you created unique resources, dispose them
const geometry = new BoxGeometry(1, 1, 1);
const material = new MeshStandardMaterial({ color: 0xff0000 });
const mesh = new Mesh(geometry, material);
const entity = world.createTransformEntity(mesh);

// Later: full cleanup since resources aren't shared
entity.dispose();
```

```ts
// If using loaded/shared assets, just destroy
const gltf = await AssetManager.loadGLTF('model.glb');
const entity = world.createTransformEntity(gltf.scene.clone());

// Later: don't dispose - other entities may use the same materials
entity.destroy();
```
