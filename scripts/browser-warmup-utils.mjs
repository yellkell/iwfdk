/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export async function runBrowserWarmup({
  maxFailures = 3,
  maxRelaunches = maxFailures,
  runAttempt,
  waitForCommandReady,
  onRelaunched = undefined,
  onRetryableFailure = undefined,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  let failures = 0;
  let relaunches = 0;

  while (failures < maxFailures) {
    const attempt = await runAttempt();

    if (attempt.kind === 'success') {
      return;
    }

    if (attempt.kind === 'relaunched') {
      relaunches += 1;
      if (relaunches > maxRelaunches) {
        throw new Error(
          `Browser kept relaunching during warm-up (${relaunches} relaunches)`,
        );
      }
      await onRelaunched?.(attempt);
      await waitForCommandReady();
      continue;
    }

    failures += 1;
    if (failures >= maxFailures) {
      throw attempt.error;
    }

    await onRetryableFailure?.(failures, attempt);
    await waitForCommandReady();
    await sleep(1000);
  }

  throw new Error('Browser did not reach a stable screenshot state');
}
