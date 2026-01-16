// META: title=Language Model API
// META: global=window,worker
// META: script=/resources/testharness.js
// META: script=/resources/testharnessreport.js

import geminiConfig from '/.env-gemini.json' with { type: 'json' };

setTimeout(() => {
  window.GEMINI_CONFIG = geminiConfig;

promise_test(async t => {
  assert_true('LanguageModel' in self, "LanguageModel should be available in global scope");

  const params = await LanguageModel.params();  
  assert_true(params.maxTopK > 0, 'maxTopK should be greater than 0');
  assert_true(params.maxTemperature > 0, 'maxTemperature should be greater than 0');
  assert_true(params.defaultTemperature >= 0, 'defaultTemperature should be greater than or equal to 0');
  assert_true(params.defaultTopK > 0, 'defaultTopK should be greater than 0');

  assert_true(params.maxTemperature >= params.defaultTemperature);
  assert_true(params.maxTopK >= params.defaultTopK);
}, "LanguageModel.params() returns valid technical parameters");

promise_test(async t => {
  const availability = await LanguageModel.availability();
  assert_true(['available', 'downloadable', 'downloading'].includes(availability), "Availability should be a known status");
}, "LanguageModel.availability() returns a valid status");

promise_test(async t => {
  const params = await LanguageModel.params();
  const session = await LanguageModel.create({
    temperature: params.defaultTemperature,
    topK: params.defaultTopK,
  });
  t.add_cleanup(() => session.destroy());

  assert_equals(session.topK, params.defaultTopK);
  assert_equals(session.temperature, params.defaultTemperature);
}, "LanguageModel.create() initializes a session with provided options");

promise_test(async t => {
  const session = await LanguageModel.create({
    temperature: 0,
    topK: 1,
  });
  t.add_cleanup(() => session.destroy());

  const response = await session.prompt('What is 2+2? Respond with just the number.');
  assert_true(response.includes('4'), "Response should contain common answer '4'");
}, "session.prompt() returns a valid response");

promise_test(async t => {
  const session = await LanguageModel.create({ temperature: 0, topK: 1 });
  t.add_cleanup(() => session.destroy());

  await session.prompt('My favorite color is blue.');
  const response = await session.prompt('What is my favorite color?');
  assert_true(response.toLowerCase().includes('blue'), "Session should preserve history");
}, "session.prompt() maintains conversation history");

promise_test(async t => {
  const session = await LanguageModel.create({ temperature: 0, topK: 1 });
  t.add_cleanup(() => session.destroy());

  const stream = session.promptStreaming('Say "hello"');
  let fullText = '';
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullText += value;
    }
  } finally {
    reader.releaseLock();
  }
  assert_true(fullText.length > 0, "Streaming response should not be empty");
}, "session.promptStreaming() yields chunks via ReadableStream");

promise_test(async t => {
  const session = await LanguageModel.create({ temperature: 0, topK: 1 });
  t.add_cleanup(() => session.destroy());

  const usage = await session.measureInputUsage('Test string for token counting');
  assert_equals(typeof usage, 'number', "Usage should be a number");
  assert_true(usage > 0, "Usage should be positive");
}, "session.measureInputUsage() returns a valid token count");

promise_test(async t => {
  const original = await LanguageModel.create({ temperature: 0, topK: 1 });
  t.add_cleanup(() => original.destroy());

  await original.prompt('Wait, my name is Alice.');
  const cloned = await original.clone();
  t.add_cleanup(() => cloned.destroy());

  assert_equals(cloned.temperature, original.temperature);
  assert_equals(cloned.topK, original.topK);

  const response = await cloned.prompt('What is my name?');
  assert_true(response.toLowerCase().includes('alice'), "Cloned session should preserve history");
}, "session.clone() duplicates session with history");

// Multimodal tests (OCR and Audio)

promise_test(async t => {
  const session = await LanguageModel.create({
    expectedInputs: [
      { type: 'text', languages: ['en'] },
      { type: 'image', languages: ['en'] }
    ],
    expectedOutputs: [
      { type: 'text', languages: ['en'] }
    ]
  });
  t.add_cleanup(() => session.destroy());

  const response = await fetch('/gemini.webp');
  const imageBlob = await response.blob();
  const imageUrl = URL.createObjectURL(imageBlob);
  const image = new Image();
  image.src = imageUrl;
  await image.decode();

  const aiResponse = await session.prompt([
    {
      role: 'user',
      content: [
        { type: 'text', value: 'What does the text in this image say?' },
        { type: 'image', value: image }
      ]
    }
  ]);

  assert_true(aiResponse.toLowerCase().includes('text'), "OCR should identify text in image");
}, "LanguageModel supports multimodal image input (OCR)");

promise_test(async t => {
  const session = await LanguageModel.create({
    expectedInputs: [
      { type: 'text', languages: ['en'] },
      { type: 'audio', languages: ['en'] }
    ],
    expectedOutputs: [
      { type: 'text', languages: ['en'] }
    ]
  });
  t.add_cleanup(() => session.destroy());

  const response = await fetch('/jfk.wav');
  const audioBlob = await response.blob();
  const audioBuffer = await audioBlob.arrayBuffer();

  const aiResponse = await session.prompt([
    {
      role: 'user',
      content: [
        { type: 'text', value: 'Transcribe this audio.' },
        { type: 'audio', value: audioBuffer }
      ]
    }
  ]);

  assert_true(aiResponse.toLowerCase().includes('country'), "Audio transcription should be accurate");
}, "LanguageModel supports multimodal audio input");
}, 1000);