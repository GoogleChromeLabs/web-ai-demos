# 🧾 Invoice Engine — Local AI Smart Invoice

**Zero-cloud invoice parser** — drop a scanned invoice image, get structured data instantly.  
Multimodal vision via Chrome's built-in Gemini Nano — everything runs locally in your browser.

🌐 **Live:** [chrome.dev/web-ai-demos/local-ai-smart-invoice/](https://chrome.dev/web-ai-demos/local-ai-smart-invoice/)

---

## How It Works

```
Image → Gemini Nano (Multimodal vision) → Structured Invoice Fields
```

1. **AI Vision & Extraction** — Chrome's [Prompt API](https://developer.chrome.com/docs/ai/built-in) (Gemini Nano) uses multimodal capabilities to directly read the scanned image and parse it into structured invoice fields.
2. **Auto-fill** — sender, receiver, dates, line items, VAT — all populated automatically

No API keys. No server. No data leaves your machine.

## Extracted Fields

| Section | Fields |
|---------|--------|
| **Sender** | Company name, VAT ID, IBAN, BIC/SWIFT |
| **Receiver** | Company name, address, VAT ID |
| **Invoice** | Invoice number, issue date, due date |
| **Line Items** | Description, quantity, unit price, VAT rate, total |

## Requirements

- **Chrome 148+** with [Prompt API](https://developer.chrome.com/docs/ai/prompt-api) enabled
- Node.js (for building)

## Run Locally

```bash
npm install
npm run dev
# Opens on http://localhost:3000 (or 3001 if port is busy)
```

> **Note:** Chrome treats `localhost` as a secure context, so the Prompt API works without HTTPS locally.

## Tech Stack

- **React 19** + TypeScript
- **Vite** — build tooling
- **Tailwind CSS v4** — styling
- **Chrome Prompt API** — local Gemini Nano multimodal inference
- **Lucide React** — icons

## Project Structure

```
dist/         — production build output (generated via `npm run build`)
src/
  App.tsx     — main app: Multimodal AI integration, invoice form UI
  main.tsx    — React entry point
  index.css   — Tailwind imports + fonts
index.html    — entry HTML
vite.config.ts
```
