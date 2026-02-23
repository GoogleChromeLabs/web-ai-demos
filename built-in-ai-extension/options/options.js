/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// options/options.js

document.addEventListener('DOMContentLoaded', async () => {
  const backendSelect = document.getElementById('backend');
  const panes = document.querySelectorAll('.config-pane');
  const saveBtn = document.getElementById('save');
  const statusSpan = document.getElementById('status');
  const forceInjectionCheckbox = document.getElementById('forceInjection');

  // Transformers.js Management Elements
  const downloadModelBtn = document.getElementById('download-model');
  const modelList = document.getElementById('model-list');
  const progressContainer = document.getElementById('transformers-progress');
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');

  // Load saved settings
  const config = await chrome.storage.local.get([
    'backend',
    'forceInjection',
    // ...
    // Gemini
    'geminiApiKey',
    'geminiModelName',
    // OpenAI
    'openaiApiKey',
    'openaiModelName',
    // Firebase
    'firebaseApiKey',
    'firebaseProjectId',
    'firebaseAppId',
    'firebaseApiProvider',
    'firebaseModelName',
    'firebaseUseAppCheck',
    'firebaseReCaptchaSiteKey',
    'firebaseUseLimitedUseAppCheckTokens',
    // Transformers
    'transformersModelName',
    'transformersDevice',
    'transformersDtype',
  ]);

  if (config.backend) backendSelect.value = config.backend;
  if (config.forceInjection !== undefined)
    forceInjectionCheckbox.checked = config.forceInjection;

  // Gemini
  if (config.geminiApiKey)
    document.getElementById('geminiApiKey').value = config.geminiApiKey;
  if (config.geminiModelName)
    document.getElementById('geminiModelName').value = config.geminiModelName;

  // OpenAI
  if (config.openaiApiKey)
    document.getElementById('openaiApiKey').value = config.openaiApiKey;
  if (config.openaiModelName)
    document.getElementById('openaiModelName').value = config.openaiModelName;

  // Firebase
  if (config.firebaseApiKey)
    document.getElementById('firebaseApiKey').value = config.firebaseApiKey;
  if (config.firebaseProjectId)
    document.getElementById('firebaseProjectId').value =
      config.firebaseProjectId;
  if (config.firebaseAppId)
    document.getElementById('firebaseAppId').value = config.firebaseAppId;
  if (config.firebaseApiProvider)
    document.getElementById('firebaseApiProvider').value =
      config.firebaseApiProvider;
  if (config.firebaseModelName)
    document.getElementById('firebaseModelName').value =
      config.firebaseModelName;
  if (config.firebaseUseAppCheck !== undefined)
    document.getElementById('firebaseUseAppCheck').checked =
      config.firebaseUseAppCheck;
  if (config.firebaseReCaptchaSiteKey)
    document.getElementById('firebaseReCaptchaSiteKey').value =
      config.firebaseReCaptchaSiteKey;
  if (config.firebaseUseLimitedUseAppCheckTokens !== undefined)
    document.getElementById('firebaseUseLimitedUseAppCheckTokens').checked =
      config.firebaseUseLimitedUseAppCheckTokens;

  // Transformers
  if (config.transformersModelName)
    document.getElementById('transformersModelName').value =
      config.transformersModelName;
  if (config.transformersDevice)
    document.getElementById('transformersDevice').value =
      config.transformersDevice;
  if (config.transformersDtype)
    document.getElementById('transformersDtype').value =
      config.transformersDtype;

  // Show correct pane
  const updatePanes = () => {
    panes.forEach((p) => p.classList.add('hidden'));
    const activePane = document.getElementById(`config-${backendSelect.value}`);
    if (activePane) activePane.classList.remove('hidden');
  };

  backendSelect.addEventListener('change', updatePanes);
  updatePanes();

  // Model Management Logic
  const refreshModels = async () => {
    chrome.runtime.sendMessage(
      { target: 'offscreen', type: 'list-models' },
      (response) => {
        if (response && response.success) {
          if (response.models.length === 0) {
            modelList.innerHTML = '<li>No models cached.</li>';
            return;
          }
          modelList.innerHTML = '';
          response.models.forEach((model) => {
            const li = document.createElement('li');
            li.innerHTML = `
            <span>${model}</span>
            <button class="btn-delete" data-model="${model}">Delete</button>
          `;
            modelList.appendChild(li);

            li.querySelector('.btn-delete').addEventListener(
              'click',
              async () => {
                const modelName = model;
                if (confirm(`Delete cached files for ${modelName}?`)) {
                  chrome.runtime.sendMessage(
                    { target: 'offscreen', type: 'delete-model', modelName },
                    () => refreshModels()
                  );
                }
              }
            );
          });
        } else {
          modelList.innerHTML = '<li>Failed to load models.</li>';
        }
      }
    );
  };

  // Initial load of models
  refreshModels();

  downloadModelBtn.addEventListener('click', async () => {
    const modelName = document.getElementById('transformersModelName').value;
    if (!modelName) {
      alert('Please enter a model name first.');
      return;
    }

    progressContainer.classList.remove('hidden');
    progressBar.style.width = '0%';
    progressText.textContent = 'Checking model...';

    chrome.runtime.sendMessage(
      {
        target: 'offscreen',
        type: 'create-session',
        config: {
          apiKey: 'dummy',
          modelName: modelName,
          device: document.getElementById('transformersDevice').value,
          dtype: document.getElementById('transformersDtype').value,
        },
        options: {},
      },
      (response) => {
        if (response && response.success) {
          progressText.textContent = 'Model ready!';
          progressBar.style.width = '100%';
          refreshModels();
          setTimeout(() => progressContainer.classList.add('hidden'), 10000);
        } else {
          alert(
            'Download failed: ' + (response ? response.error : 'Unknown error')
          );
          progressContainer.classList.add('hidden');
        }
      }
    );
  });

  // Listen for progress messages
  chrome.runtime.onMessage.addListener((message) => {
    if (message.target === 'options' && message.type === 'download-progress') {
      const percent = Math.round(message.loaded * 100);
      progressBar.style.width = `${percent}%`;
      progressText.textContent = `Downloading... ${percent}%`;
    }
  });

  // Save settings
  const saveSettings = async () => {
    const settings = {
      backend: backendSelect.value,
      forceInjection: forceInjectionCheckbox.checked,
      // Gemini
      geminiApiKey: document.getElementById('geminiApiKey').value,
      geminiModelName: document.getElementById('geminiModelName').value,
      // OpenAI
      openaiApiKey: document.getElementById('openaiApiKey').value,
      openaiModelName: document.getElementById('openaiModelName').value,
      // Firebase
      firebaseApiKey: document.getElementById('firebaseApiKey').value,
      firebaseProjectId: document.getElementById('firebaseProjectId').value,
      firebaseAppId: document.getElementById('firebaseAppId').value,
      firebaseApiProvider: document.getElementById('firebaseApiProvider').value,
      firebaseModelName: document.getElementById('firebaseModelName').value,
      firebaseUseAppCheck: document.getElementById('firebaseUseAppCheck')
        .checked,
      firebaseReCaptchaSiteKey: document.getElementById(
        'firebaseReCaptchaSiteKey'
      ).value,
      firebaseUseLimitedUseAppCheckTokens: document.getElementById(
        'firebaseUseLimitedUseAppCheckTokens'
      ).checked,
      // Transformers
      transformersModelName: document.getElementById('transformersModelName')
        .value,
      transformersDevice: document.getElementById('transformersDevice').value,
      transformersDtype: document.getElementById('transformersDtype').value,
    };

    await chrome.storage.local.set(settings);

    statusSpan.textContent = 'Settings saved!';
    setTimeout(() => {
      statusSpan.textContent = '';
    }, 2000);
  };

  // Add event listeners for auto-save
  const inputs = document.querySelectorAll(
    'input[type="text"], input[type="password"], input[type="checkbox"], select'
  );
  inputs.forEach((input) => {
    input.addEventListener('change', saveSettings);
  });
});
