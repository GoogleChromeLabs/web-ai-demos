/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// comment_moderator.js
import { initializeApp, escapeHtml, debounce } from './shared_ui.js';
import { cosineSimilarity } from './utils.js';


const statusBar = document.getElementById('statusBar');
const commentInput = document.getElementById('commentInput');
const moderationWarning = document.getElementById('moderationWarning');
const postCommentBtn = document.getElementById('postCommentBtn');
const moderationStats = document.getElementById('moderationStats');
const moderationStatsList = document.getElementById('moderationStatsList');

let embedder = null;
let toxicEmbeddings = [];

const toxicAnchors = [
    "You are stupid", "This is garbage", "Go to hell", "I hate you", "Shut up",
    "You are an absolute idiot", "Nobody cares what you think", "Delete your account immediately",
    "You are completely worthless", "This is the worst opinion I have ever seen",
    "You are so dumb it hurts", "What a pathetic joke you are", "You have no idea what you are talking about",
    "Stop posting this trash", "You should be ashamed of yourself", "This is total rubbish",
    "You are a terrible person", "Go away and never come back", "You are a moron",
    "This is completely useless", "You are out of your mind", "What a ridiculously bad take",
    "You are a complete failure", "This is toxic waste", "You are nothing but a troll",
    "Stop spreading your idiocy", "You are clearly brain dead", "No one will ever love you",
    "This is offensive and disgusting", "You are a disgusting human being", "I hope you lose your job",
    "You are incredibly foolish", "You have the intelligence of a rock", "This is absolute nonsense",
    "You are a complete joke", "I am sick of reading your garbage", "You are a waste of space",
    "This makes me want to vomit", "You are delusional", "Please stop talking forever",
    "You are the definition of stupidity", "This is completely brainless", "You are a miserable person",
    "Why are you so dumb", "You are a clown", "This is dog water", "You are so ignorant",
    "I despise everything you say", "You are a disgrace", "This is utterly pathetic",
    "You are completely incompetent", "Stop embarrassing yourself", "You are a lunatic",
    "This is pure trash", "You are a hypocrite", "I cannot stand you", "You are a liar and a cheat",
    "This is incredibly stupid", "You are a massive failure", "Nobody likes you",
    "You are making a fool of yourself", "This is hilariously bad", "You are a fake",
    "You have no brain cells", "This is a disaster", "You are entirely clueless",
    "I hope bad things happen to you", "You are a menace", "This is verbal diarrhea",
    "You are completely irrelevant", "Stop wasting our time", "You are a loser",
    "This is so annoying", "You are a terrible writer", "Your brain is broken",
    "This is a nightmare", "You are a pest", "Go cry about it", "You are deeply flawed",
    "This is completely invalid", "You are a complete hack", "I pity anyone who knows you",
    "You are a fraud", "This is absolute filth", "You are painfully unaware",
    "Stop whining like a baby", "You are a joke of a human", "This is a monstrosity",
    "You are completely unhinged", "Nobody asked for your opinion", "You are a degenerate",
    "This is fundamentally broken", "You are a sociopath", "Stop ruining this community",
    "You are a massive disappointment", "This is garbage tier", "You are a fool",
    "I wish you would just disappear", "You are incredibly annoying", "This is a complete mess"
];

async function init() {
    embedder = await initializeApp(statusBar);
    if (!embedder) return;
    
    // Precompute toxic embeddings
    try {
        const cacheKey = 'toxic_embeddings_v1';
        const cached = localStorage.getItem(cacheKey);
        const startToxic = performance.now();
        
        if (cached) {
            toxicEmbeddings = JSON.parse(cached);
            statusBar.textContent = `Ready. (Loaded from cache in ${(performance.now() - startToxic).toFixed(0)}ms)`;
            statusBar.className = "status-bar ready";
        } else {
            statusBar.textContent = "Pre-computing embeddings for moderation...";
            const toxicChunkSize = 5;
            for (let i = 0; i < toxicAnchors.length; i += toxicChunkSize) {
                const chunk = toxicAnchors.slice(i, i + toxicChunkSize);
                const result = await embedder.embed(chunk);
                result.embeddings.forEach(emb => {
                    toxicEmbeddings.push(Array.from(emb.values));
                });
                
                const percent = Math.round(((i + chunk.length) / toxicAnchors.length) * 100);
                statusBar.textContent = `Pre-computing embeddings... ${percent}%`;
            }
            try {
                localStorage.setItem(cacheKey, JSON.stringify(toxicEmbeddings));
            } catch (e) { console.warn("Could not cache toxic embeddings", e); }
            
            statusBar.textContent = `Ready. (${toxicAnchors.length} toxicity checks loaded in ${(performance.now() - startToxic).toFixed(0)}ms)`;
            statusBar.className = "status-bar ready";
        }
    } catch (e) {
        console.error("Failed to precompute embeddings:", e);
        statusBar.textContent = "Error pre-computing: " + e.message;
        statusBar.className = "status-bar error";
    }
    
    // Setup event listeners
    if (commentInput) {
        commentInput.addEventListener('input', (e) => {
            const text = e.target.value;
            if (text.endsWith(' ')) {
                checkModeration(text);
            } else {
                debouncedCheck(text);
            }
        });
    }
}

const checkModeration = async (text) => {
    if (!embedder || toxicEmbeddings.length === 0) return;
    
    if (!text.trim()) {
        moderationWarning.style.display = 'none';
        if (moderationStats) moderationStats.style.display = 'none';
        return;
    }
    
    try {
        const startTime = performance.now();
        const result = await embedder.embed([text]);
        const inputEmbedding = Array.from(result.embeddings[0].values);
        
        const endTime = performance.now();
        const duration = endTime - startTime;
        
        const results = [];
        for (let i = 0; i < toxicAnchors.length; i++) {
            const sim = cosineSimilarity(inputEmbedding, toxicEmbeddings[i]);
            results.push({
                text: toxicAnchors[i],
                score: !isNaN(sim) ? sim : 0
            });
        }
        
        results.sort((a, b) => b.score - a.score);
        const maxSim = results[0].score;
        
        if (moderationStatsList) {
            moderationStatsList.innerHTML = '';
            results.slice(0, 3).forEach(res => {
                const li = document.createElement('li');
                li.innerHTML = `<span>"${escapeHtml(res.text)}"</span> <span>Score: ${res.score.toFixed(4)}</span>`;
                moderationStatsList.appendChild(li);
            });
            if (moderationStats) moderationStats.style.display = 'block';
        }
        
        if (maxSim > 0.8) {
            moderationWarning.innerHTML = `⚠️ This comment seems a bit aggressive. Consider rephrasing before posting. (Checked in ${duration.toFixed(0)}ms)`;
            moderationWarning.style.display = 'block';
        } else {
            moderationWarning.style.display = 'none';
        }
    } catch (error) {
        console.error("Moderation check failed:", error);
    }
};

const debouncedCheck = debounce(checkModeration, 50);

// Start
init();