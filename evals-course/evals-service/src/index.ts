/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import dotenv from 'dotenv';
dotenv.config({ quiet: true });

import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import { router } from './routes';

const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
// Increase body size limit to support large JSON payloads
app.use(bodyParser.json({ limit: '50mb' }));

// API routes
app.use('/api', router);

// Quick health check
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'evals-service' });
});

// Serve static HTML evaluation reports
app.use('/reports', express.static(path.join(process.cwd(), 'reports')));

export const evalsService = app;

if (require.main === module) {
    app.listen(port, () => {
        console.log(`Evals service running at http://localhost:${port}`);
    });
}
