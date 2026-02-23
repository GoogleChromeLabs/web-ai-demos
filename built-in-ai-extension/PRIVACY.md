# Privacy Policy for Built-in AI Extension

**Last Updated: February 20, 2026**

This Privacy Policy describes how the Built-in AI Extension ("the Extension")
handles data. By using the Extension, you agree to the practices described in
this policy.

## 1. Overview

The Extension is a developer tool that provides polyfills for Built-in AI web
APIs (e.g., `LanguageModel`, `Summarizer`, `Writer`). It operates as a proxy
between web pages and various AI backends. Your privacy depends entirely on the
backend provider you select in the Extension's settings.

## 2. Data Handling by Backend Type

### A. Local AI (Transformers.js)

If you select **Transformers.js** as your backend:

- **Zero Data Retention**: All AI processing occurs locally on your device
  within the browser's execution context.
- **Local Storage**: AI models are downloaded to and stored in your browser's
  local cache.
- **Privacy**: No prompt data, generated text, or model-related information is
  sent to external servers or collected by the Extension developer.

### B. Cloud-Based Backends (Google Gemini, OpenAI, Firebase)

If you select a cloud provider:

- **Data Transmission**: Your prompt data is sent directly from your browser to
  the respective cloud provider's API for processing.
- **Provider Policies**: Usage of these backends is subject to the privacy
  policies and terms of service of the respective providers:
  - [Google Privacy Policy](https://policies.google.com/privacy) (for Gemini and
    Firebase)
  - [OpenAI Privacy Policy](https://openai.com/policies/privacy-policy)
- **No Intermediate Collection**: The Extension does not log, monitor, or store
  your prompts or AI responses on any intermediate servers.

## 3. Local Storage of Configuration

The Extension uses `chrome.storage.local` to store:

- User-provided **API keys** for cloud providers.
- User-selected **backend preferences**.
- **Model configuration** (e.g., model names, execution devices).

This data is stored exclusively on your local machine and is never transmitted
to the Extension developer.

## 4. Browser Permissions

The Extension requests the following permissions for specific technical reasons:

- **`storage`**: To save your configuration and API keys locally.
- **`offscreen`**: To host a stable environment for long-running AI processing
  tasks.
- **`tabs`**: To provide asynchronous updates (e.g., streaming chunks) back to
  the specific tab that initiated the request.
- **`<all_urls>`**: To inject the AI polyfill globally across all websites,
  ensuring that standardized AI APIs are available wherever they are needed.

## 5. Third-Party Services

This Extension itself does not include any tracking, analytics, or third-party
advertising scripts. It only communicates with the AI backends explicitly
configured by the user.

## 6. Contact

For questions regarding this Privacy Policy, please refer to the project's
[GitHub repository](https://github.com/GoogleChromeLabs/web-ai-demos).
