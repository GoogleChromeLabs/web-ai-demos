/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// note_search.js
import { initializeApp, escapeHtml, debounce } from './shared_ui.js';
import { cosineSimilarity } from './utils.js';


let embedder = null;
let notes = []; // Array of { text, embedding vector }

// DOM Elements
const statusBar = document.getElementById('statusBar');
const noteEditor = document.getElementById('noteEditor');
const noteSearchInput = document.getElementById('noteSearchInput');
const noteSearchBtn = document.getElementById('noteSearchBtn');
const noteSearchResults = document.getElementById('noteSearchResults');
const saveStatus = document.getElementById('saveStatus');

async function init() {
    embedder = await initializeApp(statusBar);
    
    // Wire up event listeners
    if (noteEditor) {
        noteEditor.addEventListener('input', (e) => {
            updateNoteEmbeddings(e.target.value);
        });
    }
    
    if (noteSearchBtn) {
        noteSearchBtn.addEventListener('click', performNoteSearch);
    }
    
    if (noteSearchInput) {
        noteSearchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') performNoteSearch();
        });
    }
}

const updateNoteEmbeddings = debounce(async (text) => {
    if (!embedder) return;
    
    saveStatus.textContent = "Generating embeddings...";
    saveStatus.style.color = "var(--accent-color)";
    
    try {
        const paragraphs = text.split('\n').map(p => p.trim()).filter(p => p.length > 0);
        
        if (paragraphs.length === 0) {
            notes = [];
            saveStatus.textContent = "Saved (Empty)";
            saveStatus.style.color = "var(--text-secondary)";
            return;
        }
        
        const startTime = performance.now();
        const result = await embedder.embed(paragraphs);
        const endTime = performance.now();
        const duration = endTime - startTime;
        
        notes = paragraphs.map((p, i) => {
            return {
                text: p,
                embedding: Array.from(result.embeddings[i].values)
            };
        });
        
        saveStatus.textContent = `Saved locally (${paragraphs.length} paras in ${duration.toFixed(0)}ms, avg ${(duration/paragraphs.length).toFixed(1)}ms/str)`;
        saveStatus.style.color = "var(--success-color)";
    } catch (error) {
        saveStatus.textContent = `Error: ${error.message}`;
        saveStatus.style.color = "var(--error-color)";
        console.error(error);
    }
}, 1000);

async function performNoteSearch() {
    const query = noteSearchInput.value.trim();
    if (!query) return;
    
    if (!embedder) {
        alert("API not initialized.");
        return;
    }
    
    if (notes.length === 0) {
        noteSearchResults.innerHTML = '<p class="placeholder-text">No notes to search. Type something in the editor first.</p>';
        return;
    }
    
    noteSearchResults.innerHTML = '<p class="placeholder-text">Searching...</p>';
    
    try {
        const startTime = performance.now();
        const result = await embedder.embed([query]);
        const queryEmbedding = Array.from(result.embeddings[0].values);
        
        const endTime = performance.now();
        const duration = endTime - startTime;
        
        const results = [];
        for (const note of notes) {
            const sim = cosineSimilarity(queryEmbedding, note.embedding);
            results.push({
                text: note.text,
                score: !isNaN(sim) ? sim : 0
            });
        }
        
        results.sort((a, b) => b.score - a.score);
        displayNoteResults(results, duration, queryEmbedding);
    } catch (error) {
        noteSearchResults.innerHTML = `<p class="status-bar error">Search failed: ${error.message}</p>`;
        console.error(error);
    }
}

function displayNoteResults(results, duration, queryEmbedding) {
    const fullEmbeddingStr = JSON.stringify(queryEmbedding);
    
    noteSearchResults.innerHTML = `
        <p class="info-text">Search took ${duration.toFixed(0)}ms</p>
        <details class="embedding-toggle" style="margin-bottom: 1rem; background: rgba(255,255,255,0.02); border-radius: 6px; border: 1px solid var(--border-color);">
            <summary style="padding: 0.5rem; cursor: pointer; font-size: 0.9rem; color: var(--accent-color); font-weight: 600;">Show embedding</summary>
            <div class="embedding-content" style="padding: 0.5rem; border-top: 1px solid var(--border-color);">
                <pre style="background: rgba(0,0,0,0.2); padding: 0.5rem; border-radius: 4px; overflow: auto; font-size: 0.75rem; color: #a9b7c6; max-height: 150px; white-space: pre-wrap; word-break: break-all;"><code>${fullEmbeddingStr}</code></pre>
            </div>
        </details>
    `;
    
    if (results.length === 0) {
        noteSearchResults.innerHTML += '<p class="placeholder-text">No results found.</p>';
        return;
    }
    
    results.forEach(res => {
        const div = document.createElement('div');
        div.className = 'result-item';
        div.innerHTML = `
            <div class="result-score">Score: ${res.score.toFixed(4)}</div>
            <div class="result-text">${escapeHtml(res.text)}</div>
        `;
        noteSearchResults.appendChild(div);
    });
}

// Start execution
init();