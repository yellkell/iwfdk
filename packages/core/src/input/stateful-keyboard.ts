/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export class StatefulKeyboard {
  private readonly pressedKeys = new Set<string>();
  private readonly currentDownKeys = new Set<string>();
  private readonly currentUpKeys = new Set<string>();
  private readonly pendingDownKeys = new Set<string>();
  private readonly pendingUpKeys = new Set<string>();
  private readonly target: Window;

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (!this.pressedKeys.has(event.code)) {
      this.pendingDownKeys.add(event.code);
    }
    this.pressedKeys.add(event.code);
  };

  private readonly handleKeyUp = (event: KeyboardEvent) => {
    if (this.pressedKeys.has(event.code)) {
      this.pendingUpKeys.add(event.code);
    }
    this.pressedKeys.delete(event.code);
  };

  constructor(target: Window = window) {
    this.target = target;
    this.target.addEventListener('keydown', this.handleKeyDown);
    this.target.addEventListener('keyup', this.handleKeyUp);
  }

  update(): void {
    this.currentDownKeys.clear();
    this.currentUpKeys.clear();
    for (const code of this.pendingDownKeys) {
      this.currentDownKeys.add(code);
    }
    for (const code of this.pendingUpKeys) {
      this.currentUpKeys.add(code);
    }
    this.pendingDownKeys.clear();
    this.pendingUpKeys.clear();
  }

  getKeyPressed(code: string): boolean {
    return this.pressedKeys.has(code);
  }

  getKeyDown(code: string): boolean {
    return this.currentDownKeys.has(code);
  }

  getKeyUp(code: string): boolean {
    return this.currentUpKeys.has(code);
  }

  destroy(): void {
    this.target.removeEventListener('keydown', this.handleKeyDown);
    this.target.removeEventListener('keyup', this.handleKeyUp);
    this.pressedKeys.clear();
    this.currentDownKeys.clear();
    this.currentUpKeys.clear();
    this.pendingDownKeys.clear();
    this.pendingUpKeys.clear();
  }
}
