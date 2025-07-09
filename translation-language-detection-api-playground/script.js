/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

(async () => {
  // The Language Detector API uses the `self.LanguageDetector` namespace in Canary, but
  // `ai.languageDetector` in Stable, so both shapes are feature detected.
  if (!('LanguageDetector' in self) && !('ai' in self) && !('languageDetector' in self.ai)) {
    document.querySelector('.not-supported-message').hidden = false;
    return;
  }

  const input = document.querySelector('textarea');
  const output = document.querySelector('output');
  const form = document.querySelector('form');
  const detected = document.querySelector('span');
  const language = document.querySelector('select');

  form.style.visibility = 'visible';
  // The code below handles creation of a language detector in either stable or canary.
  const detector = await
      ('LanguageDetector' in self ? LanguageDetector.create() : ai.languageDetector.create());

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

  // The Translator API uses the `self.Translator` namespace in Canary, but
  // `ai.translator` in Stable, so both shapes are feature detected.
  if ('Translator' in self || ('ai' in self && 'translator' in self.ai)) {
    document.querySelectorAll('[hidden]:not(.not-supported-message)').forEach((el) => {
      el.removeAttribute('hidden');
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const sourceLanguage = (await detector.detect(input.value.trim()))[0].detectedLanguage;
        const targetLanguage = language.value;

        // use availability for the Translator API
        const unavailable = await ('Translator' in self? Translator.availability({ sourceLanguage, targetLanguage }) === 'unavailable'
            : ai.translator.availability({ sourceLanguage, targetLanguage }) === 'no');
                       
        if (unavailable) {
          const displaySourceLanguage = languageTagToHumanReadable(sourceLanguage, 'en') || ''; 
          const displayTargetLanguage = languageTagToHumanReadable(targetLanguage, 'en') || ''; 
          output.textContent = `${displaySourceLanguage} - ${displayTargetLanguage} pair is not supported.`;
          return;
        }
        // The code below handles creation of a translator in either stable or canary.
        const translator = await ('Translator' in self ?
            Translator.create({ sourceLanguage, targetLanguage }) :
            ai.translator.create({ sourceLanguage, targetLanguage }));
        output.textContent = await translator.translate(input.value.trim());
      } catch (err) {
        output.textContent = 'An error occurred. Please try again.';
        console.error(err.name, err.message);
      }
    });
  }
})();
