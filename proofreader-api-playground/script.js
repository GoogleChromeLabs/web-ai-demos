/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const input = document.querySelector('[contenteditable]');
const output = document.querySelector('output');
const form = document.querySelector('form');
const submit = document.querySelector('[type="submit"]');
const legend = document.querySelector('span').firstChild;
const popover = document.querySelector('[popover]');
const button = popover.querySelector('button');
const activityIndicator = document.querySelector('.activity-indicator');
const includeCorrectionTypesCheckbox = document.querySelector(
  '#include-correction-types'
);
const includeCorrectionExplanationsCheckbox = document.querySelector(
  '#include-correction-explanations'
);
const legendContainer = document.querySelector('p:has(.legend)');

(async () => {
  // Feature detection.
  const proofreaderAPISupported = 'Proofreader' in self;

  const errorHighlights = {
    spelling: null,
    punctuation: null,
    capitalization: null,
    preposition: null,
    'missing-words': null,
    grammar: null,
    // Fallback for when `includeCorrectionTypes` is `false`.
    other: null,
  };
  const errorTypes = Object.keys(errorHighlights);

  let corrections;
  let correctedInput;
  let currentCorrection;

  let proofreader;

  [
    includeCorrectionExplanationsCheckbox,
    includeCorrectionTypesCheckbox,
  ].forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      legendContainer.style.visibility = includeCorrectionTypesCheckbox.checked
        ? 'visible'
        : 'hidden';
      proofreader = null;
      submit.click();
    });
  });

  // Draw the legends.
  const preTrimStartLength = legend.textContent.length;
  const postTrimStartLength = legend.textContent.trimStart().length;
  let offset = preTrimStartLength - postTrimStartLength;
  legend.textContent
    .trimStart()
    .split(' ')
    .forEach((word, i) => {
      if (!errorTypes[i]) {
        return;
      }
      const range = new Range();
      range.setStart(legend, offset);
      offset += word.length;
      range.setEnd(legend, offset);
      const highlight = new self.Highlight(range);
      errorHighlights[errorTypes[i]] = highlight;
      CSS.highlights.set(errorTypes[i], highlight);
      offset += 1;
    });

  if ('highlightsFromPoint' in self.HighlightRegistry.prototype) {
    input.addEventListener('click', (event) => {
      const hits = CSS.highlights.highlightsFromPoint(
        event.clientX,
        event.clientY
      );
      if (hits.length > 0) {
        const hitRange = hits[0].ranges[0];
        // Find the correction that matches this range.
        currentCorrection = corrections.find(
          (c) =>
            c.range.startOffset === hitRange.startOffset &&
            c.range.endOffset === hitRange.endOffset
        );
        if (currentCorrection) {
          showCorrectionsAtCaretPosition(currentCorrection);
        }
      }
    });
  }

  document.querySelector('.error').hidden = proofreaderAPISupported;

  form.querySelector('button').disabled = false;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    activityIndicator.textContent = '⏳ Proofreading...';
    // Use existing proofreader instance or create new instance.
    if (proofreaderAPISupported) {
      proofreader =
        proofreader ||
        (await self.Proofreader.create({
          includeCorrectionTypes: includeCorrectionTypesCheckbox.checked,
          includeCorrectionExplanations:
            includeCorrectionExplanationsCheckbox.checked,
          expectedInputLanguagues: ['en'],
          correctionExplanationLanguage: 'en',
        }));
    }

    // Remove previous highlights, only keep the legend highlights.
    for (const errorType of errorTypes) {
      const firstRange = errorHighlights[errorType].values().next().value;
      errorHighlights[errorType].clear();
      errorHighlights[errorType].add(firstRange);
    }

    // If there's no usable text, exit.
    const text = input.textContent.trim();
    if (!text) {
      return;
    }

    let result;
    try {
      if (proofreaderAPISupported) {
        // Work with `innerText` here.
        result = await proofreader.proofread(input.innerText);
      } else {
        // Use fake data.
        result = await (await fetch('fake.json')).json();
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('Proofreading aborted.');
        return;
      }
      throw err;
    }

    const { correctedInput: newCorrectedInput, corrections: newCorrections } =
      result;

    activityIndicator.textContent = '';
    const tempCorrections = newCorrections || [];

    // Highlight all corrections by type.
    const textNode = input.firstChild;
    for (const correction of tempCorrections) {
      const range = new Range();
      range.setStart(textNode, correction.startIndex);
      range.setEnd(textNode, correction.endIndex);

      // Defensively handle both `type` and `types`.
      if (!correction.types && correction.type) {
        correction.types = [correction.type];
      }
      correction.types ||= ['other'];

      // Store the range in the correction object for later use in clicking and positioning.
      correction.range = range;

      // Apply highlighting for all matching types.
      for (const type of correction.types) {
        const highlightKey = errorHighlights[type] ? type : 'other';
        errorHighlights[highlightKey].add(range);
      }

      // Store the joined types as a string for display in the popover.
      correction.typesString = correction.types.join(', ');
    }

    // Only update global state after processing is complete.
    corrections = tempCorrections;
    correctedInput = newCorrectedInput;

    if (correctedInput) {
      output.textContent = correctedInput;
    }
  });

  const showCorrectionsAtCaretPosition = (hitCorrection) => {
    if (!corrections || !Array.isArray(corrections)) {
      return;
    }

    // Find the current selection or hit.
    let selection = window.getSelection();
    if (!selection.rangeCount) return;
    let range = selection.getRangeAt(0);

    // If a hitCorrection was passed (from a click), use it.
    // Otherwise, find it by caret position.
    currentCorrection = hitCorrection;
    if (!currentCorrection) {
      let preCaretRange = range.cloneRange();
      preCaretRange.selectNodeContents(input);
      preCaretRange.setEnd(range.endContainer, range.endOffset);
      const caretPosition = preCaretRange.toString().length;

      // Find corrections at caret.
      currentCorrection =
        corrections.find(
          (correction) =>
            correction.startIndex <= caretPosition &&
            caretPosition <= correction.endIndex
        ) || null;
    }

    if (!currentCorrection) {
      popover.hidePopover();
      form
        .querySelectorAll('button')
        .forEach((button) => button.removeAttribute('tabindex'));
      return;
    }

    // Calculate position based on the correction's range.
    if (!currentCorrection.range) {
      return;
    }
    const rect = currentCorrection.range.getBoundingClientRect();
    let { left, width, top, height } = rect;
    left += width / 2;
    top += height;

    // Show the popup.
    const { typesString, correction, explanation, types } = currentCorrection;
    const heading =
      typesString[0].toUpperCase() +
      typesString.substring(1).replace(/-/g, ' ');
    popover.querySelector('h1').textContent = heading;
    const text = popover.querySelector('h1').firstChild;
    const highlightRange = new Range();
    highlightRange.setStart(text, 0);
    highlightRange.setEnd(text, heading.length);

    // Apply all highlights to the heading in the popover.
    if (Array.isArray(types)) {
      for (const type of types) {
        const highlightKey = errorHighlights[type] ? type : 'other';
        errorHighlights[highlightKey].add(highlightRange);
      }
    } else {
      errorHighlights['other'].add(highlightRange);
    }
    popover.querySelector('.correction').textContent =
      correction || '[Remove word]';
    if (explanation) {
      popover.querySelector('.explanation').textContent = explanation;
    } else {
      popover.querySelector('*:has(.explanation)').style.display = 'none';
    }
    popover.style.top = `${Math.round(top)}px`;
    popover.style.left = `${Math.round(left)}px`;
    form.querySelectorAll('button').forEach((button) => (button.tabIndex = -1));
    popover.showPopover();
  };

  // Make sure we can tab in an out of the popover and focus on the
  // accept correction button.
  popover.addEventListener('toggle', (e) => {
    if (e.oldState === 'closed') {
      button.addEventListener('keydown', buttonBlur);
      return;
    }
    button.removeEventListener('keydown', buttonBlur);
  });

  const buttonBlur = (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      input.focus();
    }
  };

  // Accept the correction.
  button.addEventListener('click', () => {
    if (!currentCorrection) {
      return;
    }
    const { startIndex, endIndex, correction } = currentCorrection;
    input.textContent = `${input.textContent.substring(
      0,
      startIndex
    )}${correction}${input.textContent.substring(endIndex)}`;
    popover.hidePopover();
    submit.click();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && popover.matches(':popover-open')) {
      e.preventDefault();
      button.focus();
    }
  });

  input.addEventListener('keyup', (e) => {
    // Ignore [Esc], as it dismisses the popup.
    if (e.key === 'Escape') {
      return;
    }
    showCorrectionsAtCaretPosition();
  });

  input.addEventListener('pointerup', showCorrectionsAtCaretPosition);
})();
