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
    document.addEventListener('click', (event) => {
      const mouseX = event.clientX;
      const mouseY = event.clientY;
      // ToDo: Make the error clicking logic based on CSS Highlights.
      console.log(CSS.highlights.highlightsFromPoint(mouseX, mouseY));
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

    if (proofreaderAPISupported) {
      // Work with `innerText` here.
      ({ correctedInput, corrections } = await proofreader.proofread(
        input.innerText
      ));
    } else {
      // Use fake data.
      ({ correctedInput, corrections } = await (
        await fetch('fake.json')
      ).json());
    }
    activityIndicator.textContent = '';
    if (!corrections) {
      corrections = [];
    }
    // Highlight all corrections by type.
    const textNode = input.firstChild;
    for (const correction of corrections) {
      const range = new Range();
      range.setStart(textNode, correction.startIndex);
      range.setEnd(textNode, correction.endIndex);
      correction.type ||= 'other';
      errorHighlights[correction.type].add(range);
    }

    if (correctedInput) {
      output.textContent = correctedInput;
    }
  });

  const showCorrectionsAtCaretPosition = () => {
    if (!corrections || !Array.isArray(corrections)) {
      return;
    }

    // Find the caret position index and coordinates to position the popup.
    let selection = window.getSelection();
    let range = selection.getRangeAt(0);
    let preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(input);
    preCaretRange.setEnd(range.endContainer, range.endOffset);
    const caretPosition = preCaretRange.toString().length;
    let rect = preCaretRange.getBoundingClientRect();
    let { left, width, top, height } = rect;
    left += width / 2;
    top += height;

    // Find corrections at caret.
    currentCorrection =
      corrections.find(
        (correction) =>
          correction.startIndex <= caretPosition &&
          caretPosition <= correction.endIndex
      ) || null;
    if (!currentCorrection) {
      popover.hidePopover();
      form
        .querySelectorAll('button')
        .forEach((button) => button.removeAttribute('tabindex'));
      return;
    }

    // Show the popup.
    const { type, correction, explanation } = currentCorrection;
    const heading = type[0].toUpperCase() + type.substring(1).replace(/-/, ' ');
    popover.querySelector('h1').textContent = heading;
    const text = popover.querySelector('h1').firstChild;
    const highlightRange = new Range();
    highlightRange.setStart(text, 0);
    highlightRange.setEnd(text, heading.length);
    errorHighlights[type].add(highlightRange);
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

  input.addEventListener('keyup', (e) => {
    // Ignore [Esc], as it dismisses the popup.
    if (e.key === 'Escape') {
      return;
    }
    showCorrectionsAtCaretPosition();
  });

  input.addEventListener('pointerup', showCorrectionsAtCaretPosition);
})();
