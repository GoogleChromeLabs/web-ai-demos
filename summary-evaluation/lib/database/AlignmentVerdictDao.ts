/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Database } from 'bun:sqlite';
import AlignmentVerdict from '../entities/AlignmentVerdict';

export default class AlignentVerdictDao {
    constructor(private database: Database) {}
    upsert(verdict: AlignmentVerdict) {
        const sql = `
            INSERT INTO ALIGNMENT_VERDICT
                (SUMMARY_ID, SEQUENCE, STATEMENT, VERDICT, REASON)
                VALUES ($summary_id, $sequence, $statement, $verdict, $reason)
            ON CONFLICT(SUMMARY_ID, SEQUENCE) DO UPDATE SET
                 STATEMENT = $statement,
                 VERDICT = $verdict,
                 REASON = $reason
        `;
        const query = this.database.query(sql);
        query.all({
            $summary_id: verdict.summaryId,
            $sequence: verdict.sequence,
            $statement: verdict.statement,
            $verdict: verdict.verdict,
            $reason: verdict.reason,
        });
    } 
}