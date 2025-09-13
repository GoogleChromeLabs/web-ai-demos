/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

(async () => {
  // The Language Detector API uses the `self.LanguageDetector` namespace.
  if (!('LanguageDetector' in self)) {
    document.querySelector('.not-supported-message').hidden = false;
    return;
  }

  const input = document.querySelector('textarea');
  const output = document.querySelector('output');
  const form = document.querySelector('form');
  const detected = document.querySelector('span');
  const language = document.querySelector('select');

  form.style.visibility = 'visible';
  const detector = await LanguageDetector.create();

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

  if ('Translator' in self) {
    document.querySelectorAll('[hidden]:not(.not-supported-message)').forEach((el) => {
      el.removeAttribute('hidden');
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const sourceLanguage = (await detector.detect(input.value.trim()))[0].detectedLanguage;
        const targetLanguage = language.value;

        const availability = await Translator.availability({ sourceLanguage, targetLanguage });
        const isUnavailable = availability === 'unavailable';

        if (isUnavailable) {
          const displaySourceLanguage = languageTagToHumanReadable(sourceLanguage, 'en') || '';
          const displayTargetLanguage = languageTagToHumanReadable(targetLanguage, 'en') || '';
          output.textContent = `${displaySourceLanguage} - ${displayTargetLanguage} pair is not supported.`;
          return;
        }
        const translator = await Translator.create({ sourceLanguage, targetLanguage });
        output.textContent = await translator.translate(input.value.trim());
      } catch (err) {
        output.textContent = 'An error occurred. Please try again.';
        console.error(err.name, err.message);
      }
    });
  }
})();
