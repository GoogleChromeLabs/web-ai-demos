/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const form = document.querySelector("#search-form");
const queryInput = document.querySelector("#query");
const button = form.querySelector("button");
const status = document.querySelector("#status");
const progress = document.querySelector("#progress");
const passages = [...document.querySelectorAll("[data-passage]")];

let embedder;
let passageVectors;

const passageText = (passage) =>
  `${passage.querySelector("h3").textContent}\n${passage.querySelector("p").textContent}`;

const checkAvailability = async () => {
  if (!("SemanticEmbedder" in self)) {
    status.textContent =
      "SemanticEmbedder is not available. Open this page in Chrome Canary and enable the flag below.";
    return;
  }

  const availability = await self.SemanticEmbedder.availability();
  status.textContent =
    availability === "available"
      ? "SemanticEmbedder is ready."
      : `SemanticEmbedder is ${availability}. The first search may download the model.`;
  button.disabled = availability === "unavailable";
};

const getEmbedder = async () => {
  if (embedder) {
    return embedder;
  }

  progress.hidden = false;
  status.textContent = "Preparing the model…";
  embedder = await self.SemanticEmbedder.create({
    monitor(monitor) {
      monitor.addEventListener("downloadprogress", (event) => {
        progress.value = event.loaded;
        status.textContent = `Downloading model: ${Math.round(event.loaded * 100)}%`;
      });
    },
  });
  progress.hidden = true;
  return embedder;
};

const cosineSimilarity = (a, b) => {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let index = 0; index < a.length; index += 1) {
    dotProduct += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};

const search = async (query) => {
  const session = await getEmbedder();

  if (!passageVectors) {
    status.textContent = "Reading the Spanish document…";
    const response = await session.embed(passages.map(passageText), {
      taskType: "retrieval-document",
    });
    passageVectors = response.embeddings.map((embedding) => embedding.values);
  }

  status.textContent = "Searching…";
  const queryResponse = await session.embed(query, {
    taskType: "retrieval-query",
  });
  const queryVector = queryResponse.embeddings[0].values;

  const bestMatch = passages
    .map((passage, index) => ({
      passage,
      score: cosineSimilarity(queryVector, passageVectors[index]),
    }))
    .sort((a, b) => b.score - a.score)[0].passage;

  passages.forEach((passage) => passage.removeAttribute("data-match"));
  bestMatch.dataset.match = "";
  bestMatch.scrollIntoView({ behavior: "smooth", block: "center" });
  status.textContent = `Best match: ${bestMatch.querySelector("h3").textContent}`;
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  button.disabled = true;

  try {
    await search(queryInput.value.trim());
  } catch (error) {
    status.textContent = `Search failed: ${error.message}`;
  } finally {
    button.disabled = false;
  }
});

self.addEventListener("pagehide", () => embedder?.destroy());

await checkAvailability();
