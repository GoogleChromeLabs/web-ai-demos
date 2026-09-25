/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Chrome only starts a model download with user activation, which a tap,
// click, or key press grants.

// Resolves once the user has interacted with the page.
const waitForUserActivation = () =>
  new Promise((resolve) => {
    const controller = new AbortController();
    const onInteraction = () => {
      if (navigator.userActivation.isActive) {
        controller.abort();
        resolve();
      }
    };
    for (const type of ["keydown", "mousedown", "pointerup", "touchend"]) {
      document.addEventListener(type, onInteraction, {
        capture: true,
        signal: controller.signal,
      });
    }
  });

// Called with what `availability()` said, right before `create()`. A model
// that has to be downloaded waits for an interaction, and `onActivationNeeded`
// is the cue to ask for one.
export const ensureUserActivation = async (
  availability,
  onActivationNeeded,
) => {
  if (availability === "available" || navigator.userActivation.isActive) {
    return;
  }
  onActivationNeeded?.();
  await waitForUserActivation();
};
