/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getOrCreateDatabase } from '../lib/database/DbHelper';
import ArticleDao from '../lib/database/ArticleDao';
import SummaryDao from '../lib/database/SummaryDao';
import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from '@google/generative-ai';
import Summary from '../lib/entities/Summary';

const MODEL = 'gemini-1.5-flash-002';
const db = await getOrCreateDatabase();
const articleDao = new ArticleDao(db);
const summaryDao = new SummaryDao(db);

const SUMMARIZATION_SYSTEM_PROMPT = 'Summarize the article in one paragraph'; 
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);
const model = genAI.getGenerativeModel({ model: MODEL, systemInstruction: SUMMARIZATION_SYSTEM_PROMPT, safetySettings: [
    {category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE},
    {category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE},
    {category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE},
    {category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE},
] });

let articles = articleDao.loadAllWithoutSummaryForModel(MODEL);
for (const article of articles) {
    console.info(`processing article ${article.id}.`);
    const result = await model.generateContent(article.text);
    const summaryText = await result.response.text();
    const summary = new Summary(crypto.randomUUID(), MODEL, article.id, summaryText);
    summaryDao.upsert(summary);
}
