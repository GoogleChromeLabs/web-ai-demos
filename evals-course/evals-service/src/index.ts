/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import dotenv from 'dotenv';
dotenv.config({ quiet: true });

import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { router } from './routes';

const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

app.use('/api', router);

app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'evals-service' });
});

export const evalsService = app;

if (require.main === module) {
    app.listen(port, () => {
        console.log(`Evals service running at http://localhost:${port}`);
    });
}
