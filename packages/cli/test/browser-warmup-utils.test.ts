/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, test, vi } from 'vitest';
import { runBrowserWarmup } from '../../../scripts/browser-warmup-utils.mjs';

describe('browser warmup retry helper', () => {
  test('does not consume the failure budget when the browser relaunches', async () => {
    const runAttempt = vi
      .fn()
      .mockResolvedValueOnce({
        kind: 'failure',
        error: new Error('first transport reset'),
        message: 'first transport reset',
      })
      .mockResolvedValueOnce({
        kind: 'failure',
        error: new Error('second transport reset'),
        message: 'second transport reset',
      })
      .mockResolvedValueOnce({ kind: 'relaunched' })
      .mockResolvedValueOnce({ kind: 'success' });
    const waitForCommandReady = vi.fn().mockResolvedValue(undefined);
    const onRelaunched = vi.fn().mockResolvedValue(undefined);
    const onRetryableFailure = vi.fn().mockResolvedValue(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      runBrowserWarmup({
        maxFailures: 3,
        runAttempt,
        waitForCommandReady,
        onRelaunched,
        onRetryableFailure,
        sleep,
      }),
    ).resolves.toBeUndefined();

    expect(runAttempt).toHaveBeenCalledTimes(4);
    expect(waitForCommandReady).toHaveBeenCalledTimes(3);
    expect(onRelaunched).toHaveBeenCalledTimes(1);
    expect(onRetryableFailure).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  test('throws once the non-relaunch failure budget is exhausted', async () => {
    const terminalError = new Error('still broken');
    const runAttempt = vi
      .fn()
      .mockResolvedValueOnce({
        kind: 'failure',
        error: new Error('first'),
        message: 'first',
      })
      .mockResolvedValueOnce({
        kind: 'failure',
        error: new Error('second'),
        message: 'second',
      })
      .mockResolvedValueOnce({
        kind: 'failure',
        error: terminalError,
        message: 'third',
      });

    await expect(
      runBrowserWarmup({
        maxFailures: 3,
        runAttempt,
        waitForCommandReady: vi.fn().mockResolvedValue(undefined),
        sleep: vi.fn().mockResolvedValue(undefined),
      }),
    ).rejects.toThrow('still broken');
  });

  test('throws once the relaunch budget is exhausted', async () => {
    const runAttempt = vi
      .fn()
      .mockResolvedValueOnce({ kind: 'relaunched' })
      .mockResolvedValueOnce({ kind: 'relaunched' })
      .mockResolvedValueOnce({ kind: 'relaunched' });

    await expect(
      runBrowserWarmup({
        maxFailures: 3,
        maxRelaunches: 2,
        runAttempt,
        waitForCommandReady: vi.fn().mockResolvedValue(undefined),
        onRelaunched: vi.fn().mockResolvedValue(undefined),
        sleep: vi.fn().mockResolvedValue(undefined),
      }),
    ).rejects.toThrow('Browser kept relaunching during warm-up');
  });
});
