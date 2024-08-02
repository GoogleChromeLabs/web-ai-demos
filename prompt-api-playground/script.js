import { marked } from 'https://cdn.jsdelivr.net/npm/marked@13.0.3/lib/marked.esm.js';
import DOMPurify from 'https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.es.mjs';

(async () => {
  const errorMessage = document.getElementById('error-message');
  const promptArea = document.getElementById('prompt-area');
  const problematicArea = document.getElementById('problematic-area');
  const promptInput = document.getElementById('prompt-input');
  const responseArea = document.getElementById('response-area');
  const copyLinkButton = document.getElementById('copy-link-button');
  const copyHelper = document.querySelector('small');
  const rawResponse = document.querySelector('details div');
  const form = document.querySelector('form');
  responseArea.style.display = 'none';

  if (!window.ai) {
    errorMessage.style.display = 'block';
    errorMessage.innerHTML = `Your browser doesn't support the Prompt API. If you're on Chrome, join the <a href="https://docs.google.com/forms/d/e/1FAIpQLSfZXeiwj9KO9jMctffHPym88ln12xNWCrVkMY_u06WfSTulQg/viewform?resourcekey=0-dE0Rqy_GYXDEWSnU7Z0iHg">Early Preview Program</a> to enable it.`;
    return;
  }

  promptArea.style.display = 'block';
  copyLinkButton.style.display = 'none';
  copyHelper.style.display = 'none';

  const promptModel = async (highlight = false) => {
    copyLinkButton.style.display = 'none';
    copyHelper.style.display = 'none';
    problematicArea.style.display = 'none';
    const prompt = promptInput.value.trim();
    if (!prompt) return;
    responseArea.style.display = 'block';
    responseArea.textContent = 'Generating response...';
    let fullResponse = '';

    try {
      const model = await window.ai.createTextSession();
      const stream = await model.promptStreaming(prompt);

      for await (const chunk of stream) {
        fullResponse = chunk.trim();
        responseArea.innerHTML = DOMPurify.sanitize(marked.parse(fullResponse));
        rawResponse.innerText = fullResponse;
      }
    } catch (error) {
      responseArea.textContent = `Error: ${error.message}`;
    } finally {
      if (highlight) {
        problematicArea.style.display = 'block';
        problematicArea.querySelector('#problem').innerText =
          decodeURIComponent(highlight).trim();
      }
      copyLinkButton.style.display = 'inline-block';
      copyHelper.style.display = 'inline';
    }
  };

  const params = new URLSearchParams(location.search);
  const urlPrompt = params.get('prompt');
  const highlight = params.get('highlight');
  if (urlPrompt) {
    promptInput.value = decodeURIComponent(urlPrompt).trim();
    await promptModel(highlight);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await promptModel();
  });

  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.dispatchEvent(new Event('submit'));
    }
  });

  copyLinkButton.addEventListener('click', () => {
    const prompt = promptInput.value.trim();
    if (!prompt) return;
    const url = new URL(window.location.href);
    url.searchParams.set('prompt', encodeURIComponent(prompt));
    const selection = getSelection().toString() || '';
    if (selection) {
      url.searchParams.set('highlight', encodeURIComponent(selection));
    } else {
      url.searchParams.delete('highlight');
    }
    navigator.clipboard.writeText(url.toString()).catch((err) => {
      alert('Failed to copy link: ', err);
    });
    const text = copyLinkButton.textContent;
    copyLinkButton.textContent = 'Copied';
    setTimeout(() => {
      copyLinkButton.textContent = text;
    }, 3000);
  });
})();
