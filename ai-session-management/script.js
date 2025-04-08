/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const assistantTemplate = document.querySelector('#assistant');
const conversationTemplate = document.querySelector('#conversation');

const newAssistantButton = document.querySelector('.new-assistant');
const stopButton = document.querySelector('.stop-button');
const assistantContainer = document.querySelector('div');
const promptForm = document.querySelector('.prompt-form');
const activeAssistantForm = document.querySelector('.active-assistant-form');
const promptInput = document.querySelector('.prompt-input');

const assistants = {};

let controller = null;

stopButton.addEventListener('click', () => {
  controller.abort();
});

const getUUIDs = () => {
  try {
    const uuids = localStorage.getItem('uuids');
    if (!uuids) {
      return [];
    }
    return JSON.parse(uuids);
  } catch {
    return [];
  }
};

(async function init() {
  // Get the default parameters.
  const { defaultTopK: topK, defaultTemperature: temperature } =
    await LanguageModel.params();

  const uuids = getUUIDs();

  if (uuids.length) {
    promptForm.hidden = false;
  }

  let isFirst = true;

  for (const uuid of uuids) {
    // Restore the options from localStorage, or initialize new options.
    const storedOptions = ((uuid) => {
      try {
        const storedOptions = localStorage.getItem(uuid);
        if (!storedOptions) {
          return false;
        }
        return JSON.parse(storedOptions);
      } catch {
        return false;
      }
    })(uuid);

    const options = storedOptions || {
      systemPrompt: '',
      initialPrompts: [],
      topK,
      temperature,
      conversationSummary: 'New conversation',
    };

    const assistant = await LanguageModel.create(options);
    const { inputQuota, inputUsage } = assistant;
    console.log(uuid, inputUsage, inputQuota);

    assistants[uuid] = { assistant, options };

    const assistantClone = assistantTemplate.content.cloneNode(true);
    if (isFirst) {
      assistantClone.querySelector('details').open = true;
      assistantClone.querySelector('input').checked = true;
      isFirst = false;
    }
    assistantClone.querySelector('.conversation-summary').textContent =
      options.conversationSummary;
    assistantClone.querySelector('input').value = uuid;
    const conversationContainer = assistantClone.querySelector(
      '.conversation-container'
    );
    assistantClone.querySelector('.tokens-so-far').textContent = assistant.inputUsage;
    assistantClone.querySelector('.tokens-left').textContent = assistant.inputQuota - assistant.inputUsage;
    assistantContainer.append(assistantClone);

    for (const initialPrompt of options.initialPrompts) {
      const conversationClone = conversationTemplate.content.cloneNode(true);
      const item = conversationClone.querySelector('.item');
      item.classList.add(initialPrompt.role);
      item.textContent = initialPrompt.content;
      conversationContainer.append(conversationClone);
    }
  }
})();

activeAssistantForm.addEventListener('click', async (e) => {
  const nodeName = e.target.nodeName.toLowerCase();
  if (nodeName !== 'summary' && nodeName !== 'button') {
    return;
  }
  if (nodeName === 'summary') {
    setTimeout(() => {
      const openDetails = activeAssistantForm.querySelector(
        'details[open] input'
      );
      if (!openDetails) {
        return;
      }
      openDetails.checked = true;
    }, 0);
  } else if (
    nodeName === 'button' &&
    e.target.classList.contains('delete-conversation')
  ) {
    const details = e.target.closest('details');
    const uuid = details.querySelector(
      '[name="active-assistant"][value]'
    ).value;
    details.remove();

    let uuids = getUUIDs();
    uuids = uuids.filter((item) => item !== uuid);
    localStorage.setItem('uuids', JSON.stringify(uuids));
    localStorage.removeItem(uuid);
  }
});

const createAssistant = async (options = {}) => {
  try {
    const uuid = crypto.randomUUID();
    options.initialPrompts = options.initialPrompts || [];
    const assistant = await LanguageModel.create(options);
    assistantTemplate.content.querySelector('.tokens-left').textContent = assistant.inputQuota;
    assistants[uuid] = { assistant, options };
    const uuids = getUUIDs();
    uuids.push(uuid);
    localStorage.setItem('uuids', JSON.stringify(uuids));
    return uuid;
  } catch (err) {
    console.error(err.name, err.message);
  }
};

newAssistantButton.addEventListener('click', async () => {
  const uuid = await createAssistant();
  const assistantClone = assistantTemplate.content.cloneNode(true);
  assistantClone.querySelector('.conversation-summary').textContent =
    'New conversation';
  assistantClone.querySelector('input').value = uuid;
  assistantContainer.append(assistantClone);
  assistantContainer
    .querySelectorAll('details')
    .forEach((details) => (details.open = false));
  assistantContainer.querySelector(
    `details:has([value="${uuid}"])`
  ).open = true;
  assistantContainer.querySelector(`[value="${uuid}"]`).checked = true;
  promptForm.hidden = false;
  promptInput.value = '';
  promptInput.focus();
});

promptForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const value = promptInput.value.trim();
  if (!value) {
    return;
  }
  if (!activeAssistantForm.querySelector('details[open]')) {
    alert('Select an active assistant first.');
    return;
  }
  const formData = new FormData(activeAssistantForm);
  const uuid = formData.get('active-assistant');
  const { assistant, options } = assistants[uuid];
  console.log(assistant, options);

  const conversationContainer = activeAssistantForm.querySelector(
    `input[value="${uuid}"] + .conversation-container`
  );
  const conversationClone = conversationTemplate.content.cloneNode(true);
  const item = conversationClone.querySelector('.item');
  item.classList.add('user');
  item.textContent = value;
  conversationContainer.append(conversationClone);

  try {
    controller = new AbortController();
    const stream = assistant.promptStreaming(value, {
      signal: controller.signal,
    });
    const conversationClone = conversationTemplate.content.cloneNode(true);
    const item = conversationClone.querySelector('.item');
    item.classList.add('assistant');
    conversationContainer.append(conversationClone);

    let result = '';
    let previousChunk = '';
    for await (const chunk of stream) {
      const newChunk = chunk.startsWith(previousChunk)
        ? chunk.slice(previousChunk.length)
        : chunk;
      item.append(newChunk);
      result += newChunk;
      previousChunk = chunk;
    }
    const details = conversationContainer.closest('details');
    details.querySelector('.tokens-so-far').textContent = assistant.inputUsage;
    details.querySelector('.tokens-left').textContent = assistant.inputQuota - assistant.inputUsage;

    options.initialPrompts.push(
      {
        role: 'user',
        content: value,
      },
      {
        role: 'assistant',
        content: result,
      }
    );

    promptInput.value = '';
    promptInput.focus();

    const summaryAssistant = await LanguageModel.create(options);
    const summaryStream = summaryAssistant.promptStreaming(
      'Summarize the conversation as briefly as possible in one short sentence.'
    );
    const conversationSummary = conversationContainer
      .closest('details')
      .querySelector('summary');
    let previousSummaryChunk = '';
    let firstTime = true;
    for await (const chunk of summaryStream) {
      if (firstTime) {
        conversationSummary.textContent = '';
        firstTime = false;
      }
      const newChunk = chunk.startsWith(previousSummaryChunk)
        ? chunk.slice(previousSummaryChunk.length)
        : chunk;
      conversationSummary.append(newChunk);
      previousSummaryChunk = chunk;
    }
    summaryAssistant.destroy();

    options.conversationSummary = conversationSummary.textContent;
    localStorage.setItem(uuid, JSON.stringify(options));
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error(err.name, err.message);
      return;
    }
    console.log(err.message);
  }
});
