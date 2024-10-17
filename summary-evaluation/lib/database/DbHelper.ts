/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Database } from 'bun:sqlite';
import fs from 'node:fs';

const DATABASE_FILENAME = 'summary-evaluation.sqlite';
const DDL_FILE = 'database.sql';

export async function getOrCreateDatabase(): Promise<Database> {
    const databaseExists = fs.existsSync(DATABASE_FILENAME);
    const database = new Database(DATABASE_FILENAME, {create: true});
    if (!databaseExists) {
        await bootstrapDatabase(database);
    }
    return database;
}

async function bootstrapDatabase(database: Database) {
    const file = Bun.file(DDL_FILE);
    const ddl = await file.text();
    database.run(ddl);
}
