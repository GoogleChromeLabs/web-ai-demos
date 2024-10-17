/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import AlignentVerdictDao from '../lib/database/AlignmentVerdictDao';
import ArticleDao from '../lib/database/ArticleDao';
import { getOrCreateDatabase } from '../lib/database/DbHelper';
import SummaryDao from '../lib/database/SummaryDao';
import StatementExtractor from '../lib/agents/StatementExtractor';
import StatementChecker from '../lib/agents/StatementChecker';
import type Article from '../lib/entities/Article';
import AlignmentVerdict from '../lib/entities/AlignmentVerdict';

const db = await getOrCreateDatabase();
const summaryDao = new SummaryDao(db);
const articleDao = new ArticleDao(db);
const alignmentVerdictDao = new AlignentVerdictDao(db);

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);
const summaryExtractor = new StatementExtractor(genAI);
const statementChecker = new StatementChecker(genAI);


const summaries = summaryDao.loadSummariesWithoutVerdict();
summaries.sort((a, b) => a.article_id.localeCompare(b.article_id));
const articles: Map<string, Article> = articleDao.loadAll().reduce((map, article) => {
    map.set(article.id, article);
    return map;
}, new Map());

console.log(`Found ${summaries.length} summaries`);
let count = 0;
for (const summary of summaries) {
    count++;
    console.log(`Processing ${count} of ${summaries.length}`);
    try {
        console.log(summary.id, summary.model)
        const statements = await summaryExtractor.extractStatements(summary.text);
        console.log('Generated statements...');
        const article = articles.get(summary.article_id);
        if (!article) continue;
        (await statementChecker.checkStatements(article.text, statements))
            .map((v, i) => new AlignmentVerdict(summary.id, i, v.statement, v.verdict, v.reason))
            .forEach(v => alignmentVerdictDao.upsert(v));
        console.log('Generated verdicts...');
    } catch(e) {
        console.error(e);
    }
}