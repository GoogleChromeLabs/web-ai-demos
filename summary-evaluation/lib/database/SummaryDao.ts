/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Database } from 'bun:sqlite';
import Summary from '../entities/Summary';

export default class SummaryDao {
    constructor(private database: Database) {}

    loadSummaries(): Array<Summary> {
        const sql = `SELECT ID, MODEL, ARTICLE_ID, TEXT FROM SUMMARY`;
        const query = this.database.query(sql);
        const summaries = query.values();
        return summaries.map(value => 
            new Summary(value[0] as string, value[1] as string, value[2] as string, value[3] as string));
    }

    loadSummariesWithoutStructureVerdict(): Array<Summary> {
        const sql = `SELECT
            S.ID,
            S.MODEL,
            S.ARTICLE_ID,
            S.TEXT
        FROM SUMMARY S
            LEFT OUTER JOIN STRUCTURE_VERDICT V
                ON S.ID = V.SUMMARY_ID
        WHERE V.SUMMARY_ID IS NULL`;
        const query = this.database.query(sql);
        const summaries = query.values();
        return summaries.map(value => 
            new Summary(value[0] as string, value[1] as string, value[2] as string, value[3] as string));     
    }

    loadSummariesWithoutVerdict(): Array<Summary> {
        const sql = `SELECT
            S.ID,
            S.MODEL,
            S.ARTICLE_ID,
            S.TEXT
        FROM SUMMARY S
            LEFT OUTER JOIN ALIGNMENT_VERDICT V
                ON S.ID = V.SUMMARY_ID
        WHERE V.SUMMARY_ID IS NULL`;
        const query = this.database.query(sql);
        const summaries = query.values();
        return summaries.map(value => 
            new Summary(value[0] as string, value[1] as string, value[2] as string, value[3] as string));        
    }

    upsert(summary: Summary) {
        const sql = `
            INSERT INTO SUMMARY
                (ID, MODEL, ARTICLE_ID, TEXT)
                VALUES ($id, $model, $article_id, $text)
            ON CONFLICT(ID) DO UPDATE SET
                 MODEL = $model,
                 ARTICLE_ID = $article_id,
                 TEXT = $text
        `;
        const query = this.database.query(sql);
        query.all({
            $id: summary.id,
            $model: summary.model,
            $article_id: summary.article_id,
            $text: summary.text,
        });
    }
}