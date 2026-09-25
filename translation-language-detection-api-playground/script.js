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
  const detected = document.querySelector('p > span');
  const language = document.querySelector('select');
  const translatorProgress = document.querySelector('#translator-progress');

  // Reveals the progress bar only once the browser reports download
  // progress, so it stays hidden when the model is already on the device.
  const monitorDownload = (progress) => (monitor) => {
    monitor.addEventListener('downloadprogress', (e) => {
      progress.parentElement.hidden = false;
      progress.value = e.loaded;
    });
  };

  const detectorProgress = document.querySelector('#detector-progress');
  let detector;
  try {
    detector = await LanguageDetector.create({
      monitor: monitorDownload(detectorProgress),
    });
  } catch (err) {
    const message = document.querySelector('.not-supported-message');
    message.textContent = `The Language Detector API is available, but creating a detector failed: ${err.message}.`;
    message.hidden = false;
    console.error(err.name, err.message);
    return;
  } finally {
    detectorProgress.parentElement.hidden = true;
  }
  form.style.visibility = 'visible';

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

  document.querySelector('.samples').addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button) {
      return;
    }
    input.value = button.dataset.text;
    input.dispatchEvent(new Event('input'));
  });

  const languageTagToHumanReadable = (languageTag, targetLanguage) => {
    const displayNames = new Intl.DisplayNames([targetLanguage], {
      type: 'language',
    });
    return displayNames.of(languageTag);
  };

  if ('Translator' in self) {
    document.querySelectorAll('[hidden]:not(.not-supported-message, .download-progress)').forEach((el) => {
      el.removeAttribute('hidden');
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const sourceLanguage = (await detector.detect(input.value.trim()))[0].detectedLanguage;
        const targetLanguage = language.value;

        const displaySourceLanguage = languageTagToHumanReadable(sourceLanguage, 'en') || '';
        const displayTargetLanguage = languageTagToHumanReadable(targetLanguage, 'en') || '';

        const availability = await Translator.availability({ sourceLanguage, targetLanguage });
        const isUnavailable = availability === 'unavailable';

        if (isUnavailable) {
          output.textContent = `${displaySourceLanguage} - ${displayTargetLanguage} pair is not supported.`;
          return;
        }
        translatorProgress.labels[0].textContent = `Downloading the ${displaySourceLanguage} to ${displayTargetLanguage} translation model:`;
        const translator = await Translator.create({
          sourceLanguage,
          targetLanguage,
          monitor: monitorDownload(translatorProgress),
        });
        output.textContent = await translator.translate(input.value.trim());
      } catch (err) {
        output.textContent = 'An error occurred. Please try again.';
        console.error(err.name, err.message);
      } finally {
        translatorProgress.parentElement.hidden = true;
      }
    });
  }
})();
