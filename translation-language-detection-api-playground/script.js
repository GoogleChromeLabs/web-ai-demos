/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

(async () => {
  if (!('translation' in self) || !(createDetector in self.translation)) {
    document.querySelector('.not-supported-message').hidden = false;
    return;
  }

  const input = document.querySelector('textarea');
  const output = document.querySelector('output');
  const form = document.querySelector('form');
  const detected = document.querySelector('span');
  const language = document.querySelector('select');

  form.style.visibility = 'visible';
  const detector = await self.translation.createDetector();

  input.addEventListener('input', async () => {
    if (!input.value.trim()) {
      detected.textContent = 'not sure what language this is';
      return;
    }
    const { detectedLanguage, confidence } = (
      await detector.detect(input.value.trim())
    )[0];
    detected.textContent = `${(confidence * 100).toFixed(
      1
    )}% sure that this is ${languageTagToHumanReadable(
      detectedLanguage,
      'en'
    )}`;
  });

  input.dispatchEvent(new Event('input'));

  const languageTagToHumanReadable = (languageTag, targetLanguage) => {
    const displayNames = new Intl.DisplayNames([targetLanguage], {
      type: 'language',
    });
    return displayNames.of(languageTag);
  };

  if ('createTranslator' in self.translation) {
    document.querySelectorAll('[hidden]:not(.not-supported-message)').forEach((el) => {
      el.removeAttribute('hidden');
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const sourceLanguage = (await detector.detect(input.value.trim()))[0].detectedLanguage;
        if (!['en', 'ja'].includes(sourceLanguage)) {
          output.textContent = 'Currently, only English ↔ Spanish and English ↔ Japanese are supported.';
          return;
        }
        const translator = await self.translation.createTranslator({
          sourceLanguage,
          targetLanguage: language.value,
        });
        output.textContent = await translator.translate(input.value.trim());
      } catch (err) {
        output.textContent = 'An error occurred. Please try again.';
        console.error(err.name, err.message);
      }
    });
  }
})();
