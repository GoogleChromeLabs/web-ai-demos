/**
 * Sensitive Data Validator
 * Uses Chrome's built-in Prompt API (Gemini Nano) to detect sensitive
 * information in messages before "sending" them to support.
 */

const SYSTEM_PROMPT = `You are a sensitive data detector for a customer support chat.
Your job is to check if a message contains ANY of these types of sensitive information:

1. CREDIT_CARD — credit/debit card numbers (13-19 digits)
2. PASSWORD — passwords, PINs, security codes, passphrases (e.g. "my password is ...", "PIN: 1234")
3. SSN — Social Security Numbers or national ID numbers (e.g. 123-45-6789)
4. API_KEY — API keys, access tokens, secret keys (long alphanumeric strings, bearer tokens)
5. PRIVATE_KEY — private keys, SSH keys, PEM certificates
6. BANK_ACCOUNT — bank account numbers, routing numbers
7. PASSPORT — passport numbers
8. PHONE — phone numbers with country codes
9. EMAIL_WITH_PASSWORD — email + password combos

Reply with EXACTLY this format:
SAFE — if no sensitive data found
or
FOUND: TYPE — if sensitive data found (use the type name from the list above)

Examples:
- "Can you help me reset my account?" → SAFE
- "My password is hunter2" → FOUND: PASSWORD
- "Card 4532 0150 1234 5678 exp 12/26" → FOUND: CREDIT_CARD
- "Here is my token: sk-abc123xyz456" → FOUND: API_KEY`;

const SENSITIVITY_LABELS = {
  CREDIT_CARD: { icon: "💳", label: "Credit/debit card number" },
  PASSWORD: { icon: "🔑", label: "Password or PIN" },
  SSN: { icon: "🆔", label: "Social Security / National ID number" },
  API_KEY: { icon: "🔐", label: "API key or access token" },
  PRIVATE_KEY: { icon: "🗝️", label: "Private key or certificate" },
  BANK_ACCOUNT: { icon: "🏦", label: "Bank account number" },
  PASSPORT: { icon: "🛂", label: "Passport number" },
  PHONE: { icon: "📱", label: "Phone number" },
  EMAIL_WITH_PASSWORD: { icon: "📧", label: "Email + password combination" },
};

(async () => {
  const chatArea = document.getElementById("chat-area");
  const form = document.getElementById("chat-form");
  const input = document.getElementById("message-input");
  const sendBtn = document.getElementById("send-btn");
  const aiBadge = document.getElementById("ai-badge");
  const errorBanner = document.getElementById("error-banner");
  const statusText = document.getElementById("status-text");
  const infoBtn = document.getElementById("info-btn");
  const infoModal = document.getElementById("info-modal");
  const modalClose = document.getElementById("modal-close");
  const modalOk = document.getElementById("modal-ok");

  let session = null;
  let welcomeVisible = true;

  // ── Check Prompt API availability ──
  if (!("LanguageModel" in self)) {
    aiBadge.textContent = "AI Unavailable";
    aiBadge.className = "badge badge-unavailable";
    errorBanner.classList.remove("hidden");
    sendBtn.disabled = true;
    return;
  }

  // ── Create AI session ──
  try {
    session = await LanguageModel.create({
      initialPrompts: [{ role: "system", content: SYSTEM_PROMPT }],
    });
    aiBadge.textContent = "🟢 Local AI Ready";
    aiBadge.className = "badge badge-ready";
  } catch (err) {
    console.error("Failed to create LanguageModel session:", err);
    aiBadge.textContent = "AI Error";
    aiBadge.className = "badge badge-unavailable";
    errorBanner.textContent = `Failed to initialize AI: ${err.message}`;
    errorBanner.classList.remove("hidden");
    sendBtn.disabled = true;
    return;
  }

  // ── Helpers ──
  const clearWelcome = () => {
    if (welcomeVisible) {
      const welcome = chatArea.querySelector(".welcome-message");
      if (welcome) welcome.remove();
      welcomeVisible = false;
    }
  };

  const addMessage = (html, className) => {
    const div = document.createElement("div");
    div.className = `msg ${className}`;
    div.innerHTML = html;
    chatArea.appendChild(div);
    chatArea.scrollTop = chatArea.scrollHeight;
    return div;
  };

  const setProcessing = (active) => {
    sendBtn.disabled = active;
    input.disabled = active;
    statusText.textContent = active ? "Analyzing message with local AI…" : "";
  };

  const parseAiResponse = (raw) => {
    const text = raw.trim().toUpperCase();
    if (text.startsWith("SAFE") || text.startsWith("NO")) {
      return { safe: true };
    }
    // Try to extract type: "FOUND: PASSWORD" or just "PASSWORD"
    const match = text.match(/FOUND:\s*(\w+)/);
    if (match) {
      const type = match[1];
      return { safe: false, type };
    }
    // Fallback — check if the response contains any known type name
    for (const key of Object.keys(SENSITIVITY_LABELS)) {
      if (text.includes(key)) {
        return { safe: false, type: key };
      }
    }
    // If response contains YES, treat as blocked (unknown type)
    if (text.startsWith("YES")) {
      return { safe: false, type: null };
    }
    // Default to safe if we can't parse
    console.warn("Unparseable AI response, defaulting to SAFE:", raw);
    return { safe: true };
  };

  // ── Handle message submission ──
  const handleSubmit = async () => {
    const text = input.value.trim();
    if (!text || !session) return;

    clearWelcome();
    addMessage(text, "msg-user");
    input.value = "";
    input.style.height = "auto";

    const analyzingMsg = addMessage(
      '<span class="spinner"></span>Scanning for sensitive data…',
      "msg-system msg-analyzing"
    );

    setProcessing(true);

    try {
      const prompt = `Check this support chat message for sensitive data. Reply SAFE or FOUND: TYPE.\n\nMessage: "${text}"`;
      const response = await session.prompt(prompt);
      console.log("AI response:", response);

      analyzingMsg.remove();
      const result = parseAiResponse(response);

      if (result.safe) {
        addMessage(
          '<span class="msg-icon">✅</span>Message sent successfully. Awaiting support response.',
          "msg-system msg-safe"
        );
      } else {
        const info = SENSITIVITY_LABELS[result.type] || { icon: "⚠️", label: "Sensitive information" };
        addMessage(
          `<span class="msg-icon">${info.icon}</span><strong>Blocked:</strong> ${info.label} detected. Your message was <strong>not sent</strong> to protect your privacy.`,
          "msg-system msg-blocked"
        );
      }
    } catch (err) {
      console.error("AI prompt error:", err);
      analyzingMsg.remove();
      addMessage(
        `<span class="msg-icon">⚠️</span>Error analyzing message: ${err.message}`,
        "msg-system msg-blocked"
      );
    } finally {
      setProcessing(false);
      input.focus();
    }
  };

  // ── Event listeners ──
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    handleSubmit();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  });

  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });

  // Example cards
  document.querySelectorAll(".example-card").forEach((card) => {
    card.addEventListener("click", () => {
      input.value = card.dataset.text;
      input.dispatchEvent(new Event("input"));
      input.focus();
    });
  });

  // Modal
  infoBtn.addEventListener("click", () => infoModal.classList.remove("hidden"));
  modalClose.addEventListener("click", () => infoModal.classList.add("hidden"));
  modalOk.addEventListener("click", () => infoModal.classList.add("hidden"));
  infoModal.addEventListener("click", (e) => {
    if (e.target === infoModal) infoModal.classList.add("hidden");
  });
})();
