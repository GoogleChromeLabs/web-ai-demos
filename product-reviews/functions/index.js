/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import functions from '@google-cloud/functions-framework';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { SAFETY_SETTINGS_GEMINI } from './.config-ai.js';

import dotenv from 'dotenv';
dotenv.config();

functions.http('product-reviews-gemini-get-rating', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    console.log('is OPTIONS')
    // Send response to OPTIONS requests

    res.set('Access-Control-Allow-Methods', 'GET');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Max-Age', '3600');
    return res.status(204).send('');
  }

  if (!req.body.review) {
    return res.sendStatus(400);
  }
  const review = req.body.review;
  let model;
  let rating;
  try {
    model = setupGemini();
  } catch (e) {
    console.error('Error loading Gemini', e);
    return res.sendStatus(500);
  }
  try {
    rating = await getRating(model, review);
  } catch (e) {
    console.error('Error querying Gemini API (server)', e);
    return res.sendStatus(500);
  }

  return res.send(rating.toString());
});

function setupGemini() {
  const geminiGenAi = new GoogleGenerativeAI(
    process.env.GEMINI_GENAI_KEY
  );
  // https://ai.google.dev/tutorials/web_quickstart?_gl=1*mnb5md*_up*MQ..*_ga*MTI3OTI5NDU0MC4xNzA5NzMyOTI0*_ga_P1DBVKWT6V*MTcwOTczMjkyMy4xLjAuMTcwOTczMzAwOS4wLjAuMA..#use-safety-settings
  const model = geminiGenAi.getGenerativeModel({
    model: 'gemini-1.0-pro-latest',
    safetySettings: SAFETY_SETTINGS_GEMINI,
  });
  return model;
}

async function getRating(model, review) {
  const result = await model.generateContent(
    `Here is a product review: "${review}". Based on this review, assess how many stars (between 1 and 5) the review corresponds to. Return an integer. Don't give me a function, just give me a number between 1 and 5.`
  );
  const rating = parseInt(await result.response.text());
  return rating;
}