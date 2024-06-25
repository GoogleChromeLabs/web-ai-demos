/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const dotenv = require('dotenv');
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');

dotenv.config();

const MODEL = 'gemini-1.0-pro';
const PORT = process.env.PORT || 3000;
const GENERATIVE_AI_API_KEY = process.env.API_KEY;

// Create the Vertex AI client.
const genAi = new GoogleGenerativeAI(GENERATIVE_AI_API_KEY);
const generativeModel = genAi.getGenerativeModel({
    model: MODEL,
});

// Create the Express server.
const app = express();

app.use(express.static('public'));

app.get('/prompt', async (req, res) => {
    // Validate the request parameter.
    let prompt = req.query.content;
    if (!prompt || prompt.trim().length === 0) {
        res.send(500, 'Server Error - missing or invalid content parameter');
    }

    // Send the SSE header.
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    // Send the user prompt to the generative AI model.
    let modelResponse = await generativeModel.generateContentStream(prompt);

    // Iterate over the stream of response chunks from the model. For each chunk received, send
    // an SSE event.
    for await (const item of modelResponse.stream) {
        // Ignore this stream chunk if there are no candidates.
        if (item.candidates.length == 0) {
            continue;
        }

        // Collect the text from the chunk parts.
        let content = item.candidates[0].content;
        let modelResponse = content.parts
            .map(part => part.text ? part.text : null)
            .filter(text => text != null)
            .join('');

        // Send an event to the browser.
        res.write(`event: chunk\n`);
        res.write(`data: ${modelResponse}\n\n`);
    }

    // SSE will throw errors on the client if the connection is closed abruptly by the server. To
    // control that, send a status event that allows the client to close the connection gracefully.
    res.write(`event: status\n`);
    res.write(`data: done\n\n`);

    // Close the response when finished.
    res.end();
})

app.listen(PORT, () => {
    console.log(`Example app listening on port ${PORT}`)
})

