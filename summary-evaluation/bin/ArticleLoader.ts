/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import { Glob } from 'bun';
import { getOrCreateDatabase } from '../lib/database/DbHelper';
import ArticleDao from '../lib/database/ArticleDao';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Article from '../lib/entities/Article';
import { Command } from 'commander';

const db = await getOrCreateDatabase();
const articleDao = new ArticleDao(db);

const program = new Command();
const parameters = program.argument('path', 'path to directory with the input articles.').parse();
const inputPath = parameters.args[0];

const glob = new Glob(`${inputPath}/**/*.txt`);
for (const file of glob.scanSync(inputPath)) {
    const content = await fs.readFile(file, {encoding: 'utf-8'})
    const id = crypto.randomUUID();
    const article = new Article(id, 'BBC', content, file);
    console.log(`Saving file ${file} with id ${id}`);
    articleDao.upsert(article);
}
