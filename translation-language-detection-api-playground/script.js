(async () => {
  if (!('translation' in self)) {
    document.querySelector('.not-supported-message').hidden = false;
    return;
  }

  const input = document.querySelector('textarea');
  const output = document.querySelector('output');
  const form = document.querySelector('form');
  const detected = document.querySelector('span');
  const language = document.querySelector('select');

  form.style.visibility = 'visible';
  const translator = await self.translation.createDetector();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    output.textContent = await translator.translate(
      await translator.detect(input.value.trim())
    );
  });

  input.addEventListener('input', async () => {
    const { detectedLanguage, confidence } = (
      await translator.detect(input.value.trim())
    )[0];
    detected.textContent = `${(confidence * 100).toFixed(
      1
    )}% sure that this is ${languageTagToHumanReadable(
      detectedLanguage,
      'en'
    )}`;
  });

  const languageTagToHumanReadable = (languageTag, targetLanguage) => {
    const displayNames = new Intl.DisplayNames([targetLanguage], {
      type: 'language',
    });
    return displayNames.of(languageTag);
  };
})();
