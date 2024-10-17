/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Database } from 'bun:sqlite';
import Article from '../entities/Article';

export default class ArticleDao {
    constructor(private database: Database) {}

    upsert(article: Article) {
        const sql = `
            INSERT INTO ARTICLE
                (ID, SOURCE, SOURCE_ID, TEXT)
                VALUES ($id, $source, $source_id, $text)
            ON CONFLICT(ID) DO UPDATE SET
                 SOURCE = $source,
                 SOURCE_ID = $source_id,
                 TEXT = $text
        `;
        const query = this.database.query(sql);
        query.all({
            $id: article.id,
            $source: article.source,
            $source_id: article.sourceId,
            $text: article.text,
        });
    }

    loadAll(): Array<Article> {
        const sql = 'SELECT ID, SOURCE, TEXT, SOURCE_ID FROM ARTICLE';
        const query = this.database.query(sql);
        const result = query.values();
        return result.map(value => new Article(
            value[0] as string,
            value[1] as string,
            value[2] as string,
            value[3] as string,
        ));
    }

    loadAllWithoutCoverageQuestion(): Array<Article> {
        const sql = `
            SELECT
                A.ID,
                A.SOURCE,
                A.TEXT,
                A.SOURCE_ID
            FROM ARTICLE A
            WHERE NOT EXISTS (
                SELECT 1
                FROM COVERAGE_QUESTION CQ
                WHERE A.ID = CQ.ARTICLE_ID
            )        
        `
        const query = this.database.query(sql);
        const result = query.values();
        if (result.length === 0) {
            return [];
        }

        return result.map(value => new Article(
            value[0] as string,
            value[1] as string,
            value[2] as string,
            value[3] as string,

        ));
    }

    loadAllWithoutSummaryForModel(model: string): Array<Article> {
        const sql = `
            SELECT
                A.ID,
                A.SOURCE,
                A.TEXT,
                A.SOURCE_ID
            FROM ARTICLE A
            LEFT OUTER JOIN SUMMARY S
	            ON A.ID = S.ARTICLE_ID AND S.MODEL = $model
                WHERE S.ID IS NULL
        `;
        const query = this.database.query(sql);
        const result = query.values({$model: model});
        if (result.length === 0) {
            return [];
        }

        return result.map(value => new Article(
            value[0] as string,
            value[1] as string,
            value[2] as string,
            value[3] as string,
        ));
    }
}
