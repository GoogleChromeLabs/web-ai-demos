/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// src/background.js

// Setup listeners for options page
chrome.runtime.onInstalled.addListener(() => {
  chrome.runtime.openOptionsPage();
});

async function setupOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen/offscreen.html',
    reasons: ['LOCAL_STORAGE', 'WORKERS'],
    justification: 'Shared model storage and AI execution proxy',
  });
}

// Proxy messages to/from offscreen context
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle messages intended for the offscreen document
  if (message.target === 'offscreen') {
    (async () => {
      try {
        await setupOffscreen();
        // Forward message to offscreen document
        // We include the sender's tab ID so the offscreen doc knows who to talk back to
        const response = await chrome.runtime.sendMessage({
          ...message,
          senderTabId: sender.tab ? sender.tab.id : message.senderTabId,
          senderFrameId: sender.frameId,
        });
        sendResponse(response);
      } catch (error) {
        console.error('Relay error:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // Keep channel open for async response
  }

  // Handle messages FROM offscreen intended for content OR options
  if (
    (sender.contextType === 'OFFSCREEN_DOCUMENT' ||
      sender.url?.endsWith('offscreen.html')) &&
    (message.target === 'content' || message.target === 'options')
  ) {
    if (message.target === 'content' && message.senderTabId) {
      chrome.tabs.sendMessage(Number(message.senderTabId), message, {
        frameId: message.senderFrameId,
      });
    } else {
      // Options page listener or broadcaster
      chrome.runtime.sendMessage(message);
    }
    return true;
  }

  // Default: don't block other listeners
  return false;
});
