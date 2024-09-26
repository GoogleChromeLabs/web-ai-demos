/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'preact/hooks';
import backpackImg from './assets/backpack.png';
import './app.css';
import ReviewCard from './components/ReviewCard';
import RatingStars from './components/RatingStars';
import Output from './components/Output';
import { reviews } from './data/reviews';
import { generateGemmaLLmPrompt } from '.utils.prompt';
// Only working with CDN fetches index.html import
// import * as tf from '@tensorflow/tfjs';
// import * as toxicity from '@tensorflow-models/toxicity';
import '@tensorflow/tfjs-backend-webgpu';
import { TOXICITY, SENTIMENT, RATING, UNKNOWN } from '.consts';
// Gen AI imports
import {
  TOXICITY_COMMENT_THRESHOLD,
  SAFETY_SETTINGS_GEMINI,
  SENTIMENT_THRESHOLD,
} from '.config-ai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { pipeline, env, cat } from '@xenova/transformers';
import { FilesetResolver, LlmInference } from '@mediapipe/tasks-genai';
import binarySimdPath from '/node_modules/@mediapipe/tasks-genai/wasm/genai_wasm_internal.wasm?url';
import loaderSimdPath from '/node_modules/@mediapipe/tasks-genai/wasm/genai_wasm_internal.js?url';
import binaryNoSimdPath from '/node_modules/@mediapipe/tasks-genai/wasm/genai_wasm_nosimd_internal.wasm?url';
import loaderNoSimdPath from '/node_modules/@mediapipe/tasks-genai/wasm/genai_wasm_nosimd_internal.js?url';
import SupportChatWindow from './components/supportchat/SupportChatWindow';

// This is a temp hack to fix a bug in the transformers.js library
// Details in https://github.com/xenova/transformers.js/issues/366
// TODO Fix by updating the lib once a fix is available
env.allowLocalModels = false;
env.useBrowserCache = false;
// Allocate a pipeline for sentiment-analysis
let transformersjsClassifierSentimentPromise = pipeline('sentiment-analysis');

const toxicWarning =
  'Your comment may be toxic. Please rephrase it before posting. We would like to share your feedback with other users! ';

export function App() {
  const [isToxic, setIsToxic] = useState('');
  const [ratingServer, setRatingServer] = useState(0);
  const [ratingOnDevice, setRatingOnDevice] = useState(0);
  const [sentiment, setSentiment] = useState('');
  const [userComment, setUserComment] = useState('');
  const [typingTimeout, setTypingTimeout] = useState(0);
  const [isThinkingRatingServer, setIsThinkingRatingServer] = useState(false);
  const [isThinkingRatingOnDevice, setIsThinkingRatingOnDevice] =
    useState(false);
  const [isThinkingToxic, setIsThinkingToxic] = useState(false);
  const [isThinkingSentiment, setIsThinkingSentiment] = useState(false);

  const [geminiServerModel, setGeminiServerModel] = useState(null);
  const [mediaPipeLlm, setMediaPipeLlm] = useState(null);
  const [isGenAiReady, setIsGenAiReady] = useState(false);
  const [supportChatWindowVisible, setSupportChatWindowVisible] =
    useState(false);
  // TODO Use the same approach for transformers.js - it doesn't work at the moment (getting a "missing string" error). This is why I'm creating the pipeline before App(), which blocks rendering

  const handleUserCommentChange = (event) => {
    if (typingTimeout) {
      clearTimeout(typingTimeout);
    }
    setUserComment(event.target.value);
    setTypingTimeout(
      setTimeout(() => {
        console.log('Input: User has stopped typing');
        go(event.target.value);
      }, 800)
    ); // 800ms delay
  };

  useEffect(() => {
    return () => {
      if (typingTimeout) {
        clearTimeout(typingTimeout);
      }
    };
  }, [typingTimeout]);

  useEffect(() => {
    const prep = async () => {
      await tf.setBackend('webgpu');

      try {
        const mediaPipeGenAi = await FilesetResolver.forGenAiTasks();
        if (await FilesetResolver.isSimdSupported()) {
          mediaPipeGenAi.wasmBinaryPath = binarySimdPath;
          mediaPipeGenAi.wasmLoaderPath = loaderSimdPath;
        } else {
          mediaPipeGenAi.wasmBinaryPath = binaryNoSimdPath;
          mediaPipeGenAi.wasmLoaderPath = loaderNoSimdPath;
        }
        console.log('preparing Gemma', Date.now());

        let modelMediaPipe = await LlmInference.createFromOptions(mediaPipeGenAi, {
          baseOptions: {
            modelAssetPath: import.meta.env.VITE_GEMMA_MODEL_PATH,
          },
          // maxTokens may impact model loading time
          maxTokens: 1000,
          topK: 40,
          temperature: 0.5,
          randomSeed: 101,
        });
        setMediaPipeLlm(modelMediaPipe);
        console.log('endof preparing Gemma', Date.now());
      } catch (e) {
        console.error('Error loading Gemma', e);
        console.log('endof preparing Gemma', Date.now());
      }

      try {
        const geminiGenAi = new GoogleGenerativeAI(
          import.meta.env.VITE_GEMINI_GENAI_KEY
        );
        // https://ai.google.dev/tutorials/web_quickstart?_gl=1*mnb5md*_up*MQ..*_ga*MTI3OTI5NDU0MC4xNzA5NzMyOTI0*_ga_P1DBVKWT6V*MTcwOTczMjkyMy4xLjAuMTcwOTczMzAwOS4wLjAuMA..#use-safety-settings
        let modelGemini = geminiGenAi.getGenerativeModel({
          model: 'gemini-1.0-pro-latest',
          safetySettings: SAFETY_SETTINGS_GEMINI,
        });
        setGeminiServerModel(modelGemini);
        setIsGenAiReady(true);
      } catch (e) {
        console.error('Error loading Gemini', e);
      }
    };

    prep();
  }, []);

  async function go(review) {
    setIsThinkingRatingServer(true);
    setIsThinkingRatingOnDevice(true);
    setIsThinkingToxic(true);
    setIsThinkingSentiment(true);
    setIsToxic('');
    setRatingServer(0);
    setRatingOnDevice(0);
    setSentiment(UNKNOWN);

    // POSITIVE NEGATIVE CLASSIFIER (CLIENT-SIDE)
    const transformersjsClassifierSentiment =
      await transformersjsClassifierSentimentPromise;
    const sentimentResult = await transformersjsClassifierSentiment(review);
    console.log(sentimentResult);
    const sentiment = sentimentResult[0].label;
    if (sentimentResult[0].score > SENTIMENT_THRESHOLD) {
      setSentiment(sentiment);
    } else {
      setSentiment(UNKNOWN);
    }
    setIsThinkingSentiment(false);

    // RATING (CLIENT-SIDE)
    try {
      const gemmaLlmPrompt = generateGemmaLLmPrompt(review);
      console.log(mediaPipeLlm);
      const newRatingOnDeviceRaw = await mediaPipeLlm.generateResponse(
        gemmaLlmPrompt
      );
      console.log(newRatingOnDeviceRaw);
      // Parse the output for numbers
      const int = /\d/;
      const ratingAsString = newRatingOnDeviceRaw.match(int)[0];
      const newRatingOnDevice = parseInt(ratingAsString);
      setRatingOnDevice(newRatingOnDevice);
    } catch (e) {
      console.error('Error with Gemma', e);
    }
    setIsThinkingRatingOnDevice(false);

    // RATING (SERVER)
    try {
      const result = await geminiServerModel.generateContent(
        `Here is a product review: "${review}". Based on this review, assess how many stars (between 1 and 5) the review corresponds to. Return an integer. Don't give me a function, just give me a number between 1 and 5.`
      );
      const newRatingServer = parseInt(await result.response.text());
      setRatingServer(newRatingServer);
      setIsThinkingRatingServer(false);
    } catch (e) {
      console.error('Error with Gemini API (server)', e);
      setRatingServer(0);
      setIsThinkingRatingServer(false);
    }

    // TOXICITY (TENSORFLOW.JS)
    const toxicityModel = await toxicity.load(TOXICITY_COMMENT_THRESHOLD);
    const sentences = [review];
    const toxicityPredictions = await toxicityModel.classify(sentences);
    console.log(toxicityPredictions);
    // `predictions` is an array of objects, one for each prediction head,
    // that contains the raw probabilities for each input along with the
    // final prediction in `match` (either `false` or `true`).
    // If neither prediction exceeds the threshold, `match` is `null`.
    const isToxic = toxicityPredictions.some(
      (prediction) => prediction.results[0].match
    );
    setIsToxic(isToxic);
    setIsThinkingToxic(false);
    // TODO Reincorporate this hack? It's supposed to make inference faster, but I did not observe an improvement
    // console.log(review.padStart(180, " "));
    // const sentences = [review.padStart(180, " ")];
  }

  return (
    <>
      {/* TODO make this a component + update background color */}
      <div class="debug-zone">
        AI features: {isGenAiReady ? '🟢 READY' : '🔴⏳ NOT READY YET'}
      </div>
      {/* TODO make this a component */}
      <div class="product-overview">
        <div>
          <img
            class="product-img"
            src={backpackImg}
            alt="Backpack"
            width="442px"
          />
        </div>
        <div class="product-wrapper">
          <h1>Travel backpack IO24</h1>
          <div class="price">
            <span class="old-price">$180</span> $159
          </div>
          <div class="specs-wrapper">
            <div>
              <div class="spec-label">Dimensions</div>
              <div>21" H x 14" W x 9" D (53cm x 35cm x 23cm)</div>
            </div>
            <div>
              <div class="spec-label">Style</div>
              <div>
                Colors: Black, Grey, Forest Green. Hiking-inspired design
              </div>
            </div>
            <div>
              <div class="spec-label">Features</div>
              <div>
                Padded laptop and tablet sleeves, internal organization, hip
                belt
              </div>
            </div>
            <div>
              <div class="spec-label">Capacity</div>
              <div>40L</div>
            </div>
            <div>
              <div class="spec-label">Materials</div>
              <div>400D Recycled Nylon, water-resistant</div>
            </div>
          </div>
        </div>
      </div>
      <div class="reviews">
        <h2>Leave a review</h2>
        <div class="my-review-wrapper">
          <div class="my-review-card">
            <div class="my-user">me_123</div>
            <div class="my-review">
              <textarea
                id="userComment"
                value={userComment}
                onInput={handleUserCommentChange}
              ></textarea>
              <div class="gen-ai-area">
                <Output
                  outputType={SENTIMENT}
                  title=""
                  isThinking={isThinkingSentiment}
                  value={sentiment}
                />
                <Output
                  outputType={RATING}
                  title="Rating (click to edit)"
                  isThinking={isThinkingRatingOnDevice}
                  value={ratingOnDevice}
                />
              </div>
            </div>
          </div>
          <div class="post-area">
            <div class="toxic-warning-wrapper">
              {isThinkingToxic ? (
                <span></span>
              ) : (
                <div>{isToxic ? <div>{toxicWarning}</div> : <div></div>}</div>
              )}
            </div>
            <button class="post-review">
              Post
            </button>
          </div>
        </div>
        <div class="test-accuracy-server">
          <Output
            outputType={RATING}
            title="Rating (server-side Gemini 1 pro)"
            isThinking={isThinkingRatingServer}
            value={ratingServer}
          />
        </div>
        <h2>User reviews (289)</h2>
        <h3></h3>
        <div class="summary-reviews-wrapper">
          <h3>Summary</h3>
          Average 4.2/5 <RatingStars rating={4} />
          <p>
            This backpack seems to be stylish and appreciated for its
            organization and suitability for travel and school. However, you
            should be aware of potential waterproofness issues. Some users also
            found the backpack smaller than anticipated.
          </p>
          <h4>Positive Highlights:</h4>
          <ul>
            <li>
              <b>Style:</b> Several reviewers appreciate the backpack's color
              and design.
            </li>
            <li>
              <b>Organization:</b> Some users love the compartments and find
              them useful for organization.
            </li>
          </ul>
          <h4>Negative Aspects:</h4>
          <ul>
            <li>
              <b>Durability:</b>&nbsp;Concerns regarding the zipper breaking.
            </li>
            <li>
              <b>Size:&nbsp;</b>A few reviewers found the backpack smaller than
              expected.
            </li>
          </ul>
        </div>
        <div>
          {reviews.map((r) => (
            <ReviewCard user={r.user} review={r.review} rating={r.rating} />
          ))}
        </div>
      </div>
      <div>
        <button
          onClick={() => setSupportChatWindowVisible(!supportChatWindowVisible)}
          class="support-chat-button"
        >
          Chat with our support
        </button>
      </div>
      {supportChatWindowVisible && <SupportChatWindow />}
    </>
  );
}
