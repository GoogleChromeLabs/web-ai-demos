/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// docs_rag.js
import { initializeApp, escapeHtml } from './shared_ui.js';
import { cosineSimilarity } from './utils.js';


const statusBar = document.getElementById('statusBar');
const statusDot = document.getElementById('ai-status-dot');
const statusText = document.getElementById('ai-status-text');
const docsChatInput = document.getElementById('chat-input');
const docsChatBtn = document.getElementById('chat-send');
const docsChatResults = document.getElementById('chat-messages');
const mockDocsList = document.getElementById('mockDocsList');

let embedder = null;
let languageModelSession = null;
let docEmbeddings = [];

const rawDocString = `Title: Normans
The Normans (Norman: Nourmands; French: Normands; Latin: Normanni) were the people who in the 10th and 11th centuries gave their name to Normandy, a region in France. They were descended from Norse ("Norman" comes from "Norseman") raiders and pirates from Denmark, Iceland and Norway who, under their leader Rollo, agreed to swear fealty to King Charles III of West Francia. Through generations of assimilation and mixing with the native Frankish and Roman-Gaulish populations, their descendants would gradually merge with the Carolingian-based cultures of West Francia. The distinct cultural and ethnic identity of the Normans emerged initially in the first half of the 10th century, and it continued to evolve over the succeeding centuries.
The Norman dynasty had a major political, cultural and military impact on medieval Europe and even the Near East. The Normans were famed for their martial spirit and eventually for their Christian piety, becoming exponents of the Catholic orthodoxy into which they assimilated. They adopted the Gallo-Romance language of the Frankish land they settled, their dialect becoming known as Norman, Normaund or Norman French, an important literary language. The Duchy of Normandy, which they formed by treaty with the French crown, was a great fief of medieval France, and under Richard I of Normandy was forged into a cohesive and formidable principality in feudal tenure. The Normans are noted both for their culture, such as their unique Romanesque architecture and musical traditions, and for their significant military accomplishments and innovations. Norman adventurers founded the Kingdom of Sicily under Roger II after conquering southern Italy on the Saracens and Byzantines, and an expedition on behalf of their duke, William the Conqueror, led to the Norman conquest of England at the Battle of Hastings in 1066. Norman cultural and military influence spread from these new European centres to the Crusader states of the Near East, where their prince Bohemond I founded the Principality of Antioch in the Levant, to Scotland and Wales in Great Britain, to Ireland, and to the coasts of north Africa and the Canary Islands.
The English name "Normans" comes from the French words Normans/Normanz, plural of Normant, modern French normand, which is itself borrowed from Old Low Franconian Nortmann "Northman" or directly from Old Norse Norðmaðr, Latinized variously as Nortmannus, Normannus, or Nordmannus (recorded in Medieval Latin, 9th century) to mean "Norseman, Viking".`;

// Emulating VectorStore's chunking strategy (maxChunkSizeTokens: 128, chunkOverlapTokens: 20)
// Assuming 1 token ~= 0.75 words for Embedding Gemma 300M Model
// 128 * 0.75 = 96 words max chunk size. 20 * 0.75 = 15 words overlap.
function chunkText(text, maxWords = 50, overlapWords = 7) {
    const words = text.split(/\s+/);
    const chunks = [];
    for (let i = 0; i < words.length; ) {
        const chunk = words.slice(i, i + maxWords).join(" ");
        chunks.push(chunk);
        if (i + maxWords >= words.length) {
            break;
        }
        i += (maxWords - overlapWords);
    }
    return chunks;
}

const mockDocs = chunkText(rawDocString);

async function init() {
    // Populate UI right away
    if (mockDocsList) {
        let docsHtml = '<div class="doc-container">';
        docsHtml += '<h1 style="font-size: 1.2rem; margin-bottom: 0.5rem; color: var(--primary-color);">Normans (from SQuAD 2.0)</h1>';
        docsHtml += `<div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); padding: 0.75rem; border-radius: 8px; margin-bottom: 0.75rem;">
                <p id="main-original-doc" style="font-size: 0.85rem; margin-top: 0.25rem; line-height: 1.4; color: var(--text-primary); white-space: pre-wrap;">${escapeHtml(rawDocString)}</p>
            </div>`;
        docsHtml += '</div>';
        mockDocsList.innerHTML = docsHtml;
    }

    // Sync global status bar down to the chat header for better visibility
    const syncInterval = setInterval(() => {
        if (statusText && statusBar) {
            statusText.textContent = statusBar.textContent;
        }
    }, 100);

    embedder = await initializeApp(statusBar);
    
    clearInterval(syncInterval);
    
    if (!embedder) {
        if (statusDot) statusDot.className = "status-dot";
        return;
    }
    
    // Precompute docs embeddings
    const cacheKey = 'docs_rag_embeddings_v2';
    const cached = localStorage.getItem(cacheKey);
    
    if (cached) {
        docEmbeddings = JSON.parse(cached);
        statusBar.textContent = "Ready.";
    } else {
        statusBar.textContent = "Pre-computing embeddings for mock docs...";
        if(statusText) statusText.textContent = "Pre-computing embeddings...";
        
        try {
            const docChunkSize = 2;
            for (let i = 0; i < mockDocs.length; i += docChunkSize) {
                const chunk = mockDocs.slice(i, i + docChunkSize);
                const result = await embedder.embed(chunk);
                result.embeddings.forEach(emb => {
                    docEmbeddings.push(Array.from(emb.values));
                });
            }
            try {
                localStorage.setItem(cacheKey, JSON.stringify(docEmbeddings));
            } catch (e) { console.warn("Could not cache docs embeddings", e); }
        } catch (e) {
            console.error("Failed to precompute embeddings:", e);
            if(statusText) statusText.textContent = "Error pre-computing: " + e.message;
            if(statusDot) statusDot.className = "status-dot";
            return;
        }
    }

    // Initialize Language Model Session
    if(statusText) statusText.textContent = "Checking Prompt API availability...";
    try {
        if (!window.LanguageModel) throw new Error("Prompt API (LanguageModel) not found in this browser.");
        
        const availability = await window.LanguageModel.availability({
            expectedOutputs: [ { type: "text", languages: ["en"] } ]
        });
        
        if (availability === 'no' || availability === 'unavailable') {
            throw new Error(`Model availability: ${availability}`);
        }

        if (availability === 'downloadable' || availability === 'downloading' || availability === 'after-download') {
            statusText.textContent = 'Model needs downloading. Please click to start.';
            const btn = document.createElement('button');
            btn.textContent = 'Start Download';
            btn.className = "btn";
            btn.style.marginLeft = '10px';
            statusText.parentNode.insertBefore(btn, statusText.nextSibling);
            
            await new Promise(resolve => {
                btn.addEventListener('click', () => {
                    btn.remove();
                    resolve();
                });
            });
        }

        if(statusText) statusText.textContent = "Checking Prompt API (downloading model)...";
        languageModelSession = await window.LanguageModel.create({
            systemPrompt: "You are a strictly grounded assistant. Answer the user's question based ONLY on the provided <context> tags. Do not use external knowledge. Synthesize the information from ALL the provided documents to form your answer.",
            expectedOutputs: [ { type: "text", languages: ["en"] } ],
            monitor(m) {
                m.addEventListener('downloadprogress', (e) => {
                    const percentage = Math.round((e.loaded / e.total) * 100);
                    if(statusText) statusText.textContent = `Checking Prompt API (downloading model ${percentage}%)`;
                });
            }
        });
        
        if(statusText) statusText.textContent = "Ready! Ask a question.";
        if(statusDot) statusDot.className = "status-dot ready";
        statusBar.textContent = "Ready.";
        statusBar.className = "status-bar ready";
        
        docsChatInput.disabled = false;
        docsChatBtn.disabled = false;
        
    } catch (e) {
        console.error("Language Model Error:", e);
        if(statusText) statusText.textContent = "Prompt API Error: " + e.message;
        if(statusDot) statusDot.className = "status-dot";
    }

    if (docsChatBtn) {
        docsChatBtn.addEventListener('click', (e) => { e.preventDefault(); performDocsChat(); });
    }
    if (docsChatInput) {
        docsChatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); performDocsChat(); }
        });
    }

    const suggestionBtns = document.querySelectorAll('.suggestion-btn');
    suggestionBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (docsChatInput && !docsChatInput.disabled) {
                docsChatInput.value = btn.textContent;
                performDocsChat();
                // Optionally hide the suggestions after clicking one
                // btn.parentElement.style.display = 'none';
            }
        });
    });
}

function appendMessage(sender, text, isBot = false, contextText = '') {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${isBot ? 'bot' : 'user'}`;
    
    let innerHTML;
    if (isBot && contextText) {
      innerHTML = `
        <div class="message-sender">${sender}</div>
        <div class="message-bubble">
          <span class="bot-text">${text}</span>
          <div class="context-used"><strong>Retrieved Context:</strong><br>${contextText.replace(/\n/g, '<br>')}</div>
        </div>
      `;
    } else {
      innerHTML = `
        <div class="message-sender">${sender}</div>
        <div class="message-bubble"><span class="bot-text">${text}</span></div>
      `;
    }
    
    msgDiv.innerHTML = innerHTML;
    docsChatResults.appendChild(msgDiv);
    
    if (isBot && contextText) {
      setTimeout(() => {
        msgDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    } else {
      docsChatResults.scrollTop = docsChatResults.scrollHeight;
    }
    
    return msgDiv;
}


async function performDocsChat() {
    const question = docsChatInput.value.trim();
    if (!question || !languageModelSession) return;
    
    docsChatInput.value = '';
    docsChatInput.disabled = true;
    docsChatBtn.disabled = true;

    appendMessage('You', question, false);
    
    try {
        const result = await embedder.embed([question]);
        const queryEmbedding = Array.from(result.embeddings[0].values);
        
        const searchResults = [];
        for (let i = 0; i < mockDocs.length; i++) {
            const sim = cosineSimilarity(queryEmbedding, docEmbeddings[i]);
            searchResults.push({
                content: mockDocs[i],
                score: !isNaN(sim) ? sim : 0,
                index: i
            });
        }
        searchResults.sort((a, b) => b.score - a.score);
        
        // Take top 3 chunks for context
        const topChunks = searchResults.slice(0, 3);
        
        let contextText = topChunks.map((r, i) => `<document id="${i+1}">\n${r.content}\n</document>`).join('\n\n');
        
        let displayContextText = topChunks.map((r, i) => {
          let confClass = 'conf-low';
          let confText = 'Low Match';
          if (r.score > 0.8) { confClass = 'conf-high'; confText = 'High Match'; }
          else if (r.score > 0.6) { confClass = 'conf-medium'; confText = 'Medium Match'; }
          
          const badge = `<span class="confidence-badge ${confClass}">${(r.score*100).toFixed(0)}% ${confText}</span>`;
          return `[${i+1}] ${badge} <span id="rag-doc-${i}" class="rag-doc-text">${r.content}</span>`;
        }).join('<br><br>');

        const prompt = `<context>\n${contextText}\n</context>\n\n<question>\n${question}\n</question>\n\nBased ONLY on the information provided in the <context> tags above, answer the question. \nCRITICAL INSTRUCTION: After your answer, you MUST provide the exact sentence from the context that you used, formatted exactly like this:\nSOURCE QUOTE: [exact sentence from context]`;
        
        const botMsg = appendMessage('Chatbot', 'Thinking...', true, displayContextText);
        const botTextEl = botMsg.querySelector('.bot-text');
        
        const rawResponse = await languageModelSession.prompt(prompt);
        
        // Parse the Quote and Highlight
        let finalAnswer = rawResponse;
        let quote = "";
        
        if (rawResponse.includes("SOURCE QUOTE:")) {
          const parts = rawResponse.split("SOURCE QUOTE:");
          finalAnswer = parts[0].trim();
          quote = parts[1].trim().replace(/^["']|["']$/g, '');
        }
        
        botTextEl.textContent = finalAnswer;


        

        
    } catch (error) {
        appendMessage('Chatbot', `Error generating response: ${error.message}`, true);
        console.error(error);
    } finally {
        docsChatInput.disabled = false;
        docsChatBtn.disabled = false;
        docsChatInput.focus();
    }
}

// Start
init();