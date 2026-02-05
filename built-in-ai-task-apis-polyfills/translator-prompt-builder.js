/**
 * Translator Prompt Builder
 */
export class TranslatorPromptBuilder {
  static #systemPrompt = `You are a helpful and accurate translator. Your goal is to translate the given text from the source language to the target language. Preserve the meaning, tone, and any formatting as much as possible. Do not include any explanations or extra text in your response, only the translated text itself. If you are unsure of the translation, provide the most likely one.`;

  static #initialPrompts = [
    {
      role: 'user',
      content: 'SOURCE: en\nTARGET: de\nTEXT: Good morning, how are you?',
    },
    {
      role: 'assistant',
      content: 'Guten Morgen, wie geht es Ihnen?',
    },
    {
      role: 'user',
      content: "SOURCE: de\nTARGET: en\nTEXT: Guten Morgen, wie geht's?",
    },
    {
      role: 'assistant',
      content: "Good morning, how's it going?",
    },
    {
      role: 'user',
      content: 'SOURCE: en\nTARGET: fr\nTEXT: Bonjour, comment ça va ?',
    },
    {
      role: 'assistant',
      content: 'Bonjour, comment ça va ?',
    },
    {
      role: 'user',
      content: 'SOURCE: en\nTARGET: ja\nTEXT: Good morning, how are you?',
    },
    {
      role: 'assistant',
      content: 'おはようございます、お元気ですか？',
    },
    {
      role: 'user',
      content: 'SOURCE: en\nTARGET: zh\nTEXT: Good morning, how are you?',
    },
    {
      role: 'assistant',
      content: '早上好，你好吗？',
    },
    {
      role: 'user',
      content:
        'SOURCE: ja\nTARGET: en\nTEXT: おはようございます、お元気ですか？',
    },
    {
      role: 'assistant',
      content: 'Good morning, how are you?',
    },
  ];

  buildPrompt(inputText, sourceLanguage, targetLanguage) {
    return {
      systemPrompt: TranslatorPromptBuilder.#systemPrompt,
      initialPrompts: TranslatorPromptBuilder.#initialPrompts,
      userPrompt: `SOURCE: ${sourceLanguage}\nTARGET: ${targetLanguage}\nTEXT: ${inputText}`,
    };
  }
}
