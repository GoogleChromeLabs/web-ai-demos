/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Command } from 'commander';
import Ollama from '../lib/ai/OollamaClient';
import ArticleDao from '../lib/database/ArticleDao';
import { getOrCreateDatabase } from '../lib/database/DbHelper';
import SummaryDao from '../lib/database/SummaryDao';
import Summary from '../lib/entities/Summary';

const db = await getOrCreateDatabase();
const articleDao = new ArticleDao(db);
const summaryDao = new SummaryDao(db);

const program = new Command();
const parameters = program.argument(
    'model',
    'Ollama model to use. Make sure the model is installed with `ollama pull`.',
).parse();
const model = parameters.args[0];
const SYSTEM_PROMPT = 'Summarize the article in one paragraph.'

const ollama = new Ollama(process.env.OLLAMA_SERVER as string, model);

const articles = articleDao.loadAllWithoutSummaryForModel(model);
for (let article of articles) {
    console.log(`Processing article ${article.id}`);
    const response = await ollama.prompt(article.text, SYSTEM_PROMPT);
    const summary = new Summary(crypto.randomUUID(), model, article.id, response);
    summaryDao.upsert(summary);
}

