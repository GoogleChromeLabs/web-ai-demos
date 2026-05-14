# 🛡️ Sensitive Data Validator

Client-side chat guard that uses Chrome's **local Gemini Nano** to detect sensitive information in support chat messages before they're sent.

🌐 **Live:** [chrome.dev/web-ai-demos/sensitive-data-validator/](https://chrome.dev/web-ai-demos/sensitive-data-validator/)

---

## What It Detects

| Type | Example |
|------|---------|
| 💳 Credit/debit card numbers | `4532 0150 1234 5678` |
| 🔑 Passwords, PINs, security codes | `my password is hunter2` |
| 🆔 Social Security / national IDs | `SSN: 123-45-6789` |
| 🔐 API keys & access tokens | `sk-proj-abc123...` |
| 🗝️ Private keys & certificates | PEM blocks, SSH keys |
| 🏦 Bank account / routing numbers | account + routing pairs |
| 🛂 Passport numbers | `passport: AB1234567` |
| 📱 Phone numbers | numbers with country codes |
| 📧 Email + password combos | `john@x.com / pass123` |

## How It Works

```
User message → Gemini Nano (SAFE or FOUND: TYPE) → Block or Allow
```

- **Blocked** — specific warning with the type of data detected
- **Allowed** — "Message sent, awaiting response"

No API keys. No server. No data leaves your machine.

## Requirements

- **Chrome 148+** with [Prompt API](https://developer.chrome.com/docs/ai/prompt-api) enabled

## Run Locally

```bash
simplehttpserver -https .
# Open https://0.0.0.0:8000/
```

No build step — plain HTML/CSS/JS.

## Files

```
index.html   — chat UI with example cards + info modal
style.css    — dark-themed chat interface
script.js    — Prompt API integration + multi-type detection logic
```
