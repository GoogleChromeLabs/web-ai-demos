/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// shared_ui.js
// NON-CORE LOGIC: Common UI elements, initialization boilerplate, and helpers

/**
 * Initializes the AI API and handles the download/status UI updates.
 * @param {HTMLElement} statusBarElement 
 * @returns {Promise<SemanticEmbedder|null>}
 */
export async function initializeApp(statusBarElement) {
    statusBarElement.textContent = "Checking API availability...";
    statusBarElement.className = "status-bar";
    
    try {
        const availability = await window.SemanticEmbedder.availability();
        
        if (availability === 'unavailable') {
            throw new Error(`Embedder API is not available.`);
        }
        
        if (availability === 'downloadable') {
            statusBarElement.textContent = "Click 'Start' to download the AI model";
            statusBarElement.style.color = "var(--warning-color)";
            
            const startBtn = document.createElement('button');
            startBtn.textContent = "Start Download";
            Object.assign(startBtn.style, {
                display: 'block', margin: '10px auto', padding: '10px 20px',
                background: 'var(--accent-color)', color: 'white',
                border: 'none', borderRadius: '4px', cursor: 'pointer'
            });
            
            statusBarElement.parentNode.insertBefore(startBtn, statusBarElement.nextSibling);
            
            // Wait for user to trigger download
            await new Promise(resolve => {
                startBtn.addEventListener('click', () => {
                    startBtn.remove();
                    resolve();
                }, { once: true });
            });
            
            statusBarElement.textContent = "Checking Semantic Embedder API (downloading model)...";
            window.downloadAnimInterval = setInterval(() => {
                const dots = Math.floor((Date.now() / 500) % 4);
                statusBarElement.textContent = "Checking Semantic Embedder API (downloading model)" + ".".repeat(dots);
            }, 500);
        } else if (availability === 'downloading') {
            statusBarElement.textContent = "Model is downloading... Please wait.";
            statusBarElement.style.color = "var(--warning-color)";
        } else {
            statusBarElement.textContent = "Creating Embedder session...";
        }
        
        const embedder = await window.SemanticEmbedder.create();
        
        if (window.downloadAnimInterval) {
            clearInterval(window.downloadAnimInterval);
            window.downloadAnimInterval = null;
        }
        
        statusBarElement.textContent = "Ready.";
        statusBarElement.className = "status-bar ready";
        statusBarElement.style.color = ""; // reset color
        return embedder;
        
    } catch (error) {
        statusBarElement.textContent = error.message;
        statusBarElement.className = "status-bar error";
        statusBarElement.style.color = "var(--error-color)";
        console.error(error);
        return null;
    }
}

/**
 * Escapes HTML characters to prevent XSS.
 */
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Debounces a function call.
 */
export function debounce(func, wait) {
    let timeout;
    return function (...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}