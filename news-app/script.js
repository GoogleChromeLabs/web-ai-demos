// --- DOM Elements ---
const newsContainer = document.getElementById('news-container');
const readingLogList = document.getElementById('reading-log-list');
const recommendationsList = document.getElementById('recommendations-list');
const recommendButton = document.getElementById('recommend-button');
const recommendStatus = document.getElementById('recommend-status');
const modal = document.getElementById('article-modal');
const modalContent = document.getElementById('modal-content');
const modalCloseBtn = document.getElementById('modal-close');
const progress = document.querySelector('progress');

// --- State and Constants ---
const API_URL = 'https://www.tagesschau.de/api2u/homepage/';
const API_URL_FALLBACK = 'news.json';
const READING_LOG_KEY = 'tagesschauReadingLog';
let languageModelSession = null;
let sessionCreationTriggered = false;
let displayedArticles = []; // Cache for all currently shown articles
let translator = null;
let shouldTranslate = false;
let translatedHTML = false;

// --- Core News App Functions ---

async function translateHTML() {
  if (translatedHTML) {
    console.log('click');
    document.removeEventListener('click', translateHTML);
    return;
  }
  const searchParams = new URLSearchParams(location.search);
  if (searchParams.has('hl')) {
    const targetLanguage = searchParams.get('hl');
    try {
      translator = await Translator.create({
        sourceLanguage: 'de',
        targetLanguage,
      });
      shouldTranslate = true;
      const translatables = document.querySelectorAll('[data-translate]');
      translatables.forEach(async (element) => {
        if (element.ariaLabel) {
          element.setAttribute(
            'aria-label',
            await translator.translate(element.ariaLabel)
          );
          return;
        }
        element.textContent = await translator.translate(element.textContent);
      });
      document.documentElement.lang = targetLanguage;
      translatedHTML = true;
    } catch (error) {
      console.error('Translation failed:', error);
    }
  }
}

document.addEventListener('click', translateHTML);

async function maybeTranslate(text) {
  return !shouldTranslate ? text : await translator.translate(text);
}

async function getBreakingNewsSVG() {
  return URL.createObjectURL(
    new Blob(
      [
        `<svg viewBox="0 0 450 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      .breaking-news-text {
        font-family: system-ui, sans-serif;
        font-size: 30px;
        font-weight: 900;
        text-anchor: middle;
        fill: white;
        stroke: black;
        stroke-width: 5;
        stroke-linejoin: round;
        paint-order: stroke;
        letter-spacing: -1px;
      }
    </style>
  </defs>  
  <text class="breaking-news-text" x="50%" y="95">
    ${await maybeTranslate('Eilmeldung')}
  </text>  
</svg>`,
      ],
      {
        type: 'image/svg+xml',
      }
    )
  );
}

async function main() {
  await translateHTML();
  updateReadingLogDisplay();
  await fetchNews();
}

async function fetchNews() {
  // First attempt: Try to fetch from the primary API_URL
  try {
    const response = await fetch(API_URL);
    if (!response.ok) {
      // If the server responds with an error (like 404 or 500), throw an error to trigger the catch block.
      throw new Error(`Primary API failed with status: ${response.status}`);
    }
    const data = await response.json();
    displayNews(data.news);
  } catch (primaryError) {
    // This block is executed if the first fetch fails for any reason (network error, server error, etc.).
    console.error('Primary API fetch failed, trying fallback...', primaryError);

    // Second attempt: Try to fetch from the fallback URL
    try {
      const fallbackResponse = await fetch(API_URL_FALLBACK);
      if (!fallbackResponse.ok) {
        // If the fallback also gives a bad response, throw an error to trigger the final catch block.
        throw new Error(
          `Fallback API failed with status: ${fallbackResponse.status}`
        );
      }
      const fallbackData = await fallbackResponse.json();
      displayNews(fallbackData.news);
    } catch (fallbackError) {
      // This block is executed only if BOTH the primary and fallback attempts have failed.
      console.error('Fallback API fetch also failed:', fallbackError);
      const text = 'Nachrichten-Feed konnte nicht geladen werden.';
      displayError(await maybeTranslate(text));
    }
  }
}

async function displayNews(newsItems) {
  newsContainer.innerHTML = '';

  const filteredNews = newsItems.filter(
    (item) => item.firstSentence && item.details
  );
  displayedArticles = filteredNews; // Store articles for later use by the recommender

  if (filteredNews.length === 0) {
    const text = 'Keine Artikel mit Vorschau gefunden.';
    displayError(await maybeTranslate(text));
    return;
  }

  const text = 'Weiterlesen';
  const readMore = await maybeTranslate(text);
  filteredNews.forEach(async (article) => {
    article.title = article.title.replace(/"/g, '&quot;');
    article.firstSentence = article.firstSentence.replace(/"/g, '&quot;');
    const imageUrl = article.teaserImage?.imageVariants?.['16x9-640'] || '';
    let formattedDate = '';
    if (article.date) {
      try {
        const date = new Date(article.date);
        formattedDate = date.toLocaleString(
          shouldTranslate ? translator.targetLanguage : 'de-DE',
          {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }
        );
      } catch (e) {
        console.warn('Date could not be formatted:', article.date);
      }
    }

    const card = document.createElement('article');
    card.className = 'news-card';
    const altText = article.teaserImage?.alttext || article.title;
    card.innerHTML = `
      <div class="news-card__image-container">
        <img src="${imageUrl || (await getBreakingNewsSVG())}" alt="${await maybeTranslate(altText)}" loading="lazy" class="news-card__image">
        <span class="news-card__type-badge">${article.type || 'News'}</span>
      </div>
      <div class="news-card__content">
        ${article.topline ? `<h3 class="news-card__topline">${await maybeTranslate(article.topline)}</h3>` : ''}
        <h2 class="news-card__title">${await maybeTranslate(article.title)}</h2>
        <p class="news-card__date">${formattedDate}</p>
        <p class="news-card__teaser">${await maybeTranslate(article.firstSentence)}</p>
        <button class="news-card__button"
            data-details-url="${article.details}"
            data-id="${article.sophoraId}"
            data-title="${article.title}"
            data-first-sentence="${article.firstSentence}"
        >
          ${readMore}
        </button>
      </div>`;
    newsContainer.appendChild(card);
  });
}

async function fetchArticleDetails(url) {
  const text = 'Lade Artikel...';
  showModal(`<div id="loading">${await maybeTranslate(text)}</div>`);
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const articleData = await response.json();
    console.log(articleData);
    let fullArticleHtml = '';
    if (articleData.content && Array.isArray(articleData.content)) {
      articleData.content.forEach(async (contentBlock) => {
        if (contentBlock.value) {
          fullArticleHtml += `<p>${contentBlock.value}</p>`;
        } else if (contentBlock.box && contentBlock.box.text) {
          fullArticleHtml += `<div class="content-box"><h4>${contentBlock.box.title || ''}</h4><div>${contentBlock.box.text}</div></div>`;
        }
      });
    }

    let text = 'Ohne Titel';
    text = await maybeTranslate(text);
    let otherText =
      'Der vollständige Artikelinhalt konnte nicht geladen werden.';
    otherText = await maybeTranslate(otherText);
    const finalModalHTML = `
      <h1>${articleData.title ? await maybeTranslate(articleData.title) : text}</h1>
      <p><strong>${articleData.topline ? await maybeTranslate(articleData.topline) : ''}</strong></p>
      <hr>
      <div>${fullArticleHtml ? await maybeTranslate(fullArticleHtml) : `<p>${otherText}</p>`}</div>`;
    modalContent.innerHTML = finalModalHTML;
  } catch (error) {
    console.error('Failed to fetch article details:', error);
    const text =
      'Entschuldigung, der vollständige Artikel konnte nicht geladen werden.';
    modalContent.innerHTML = `<div id="error">${await maybeTranslate(text)}</div>`;
  }
}

// --- Reading Log Functions ---

function logArticleRead(articleInfo) {
  const log = JSON.parse(sessionStorage.getItem(READING_LOG_KEY) || '[]');
  const isAlreadyLogged = log.some((item) => item.id === articleInfo.id);

  if (!isAlreadyLogged) {
    log.unshift(articleInfo);
    sessionStorage.setItem(READING_LOG_KEY, JSON.stringify(log));
    updateReadingLogDisplay();
  }
}

async function updateReadingLogDisplay() {
  const log = JSON.parse(sessionStorage.getItem(READING_LOG_KEY) || '[]');
  if (log.length === 0) {
    const text = 'Sie haben noch keine Artikel gelesen.';
    readingLogList.innerHTML = `<li><span class="empty-log-message">${await maybeTranslate(text)}</span></li>`;

    recommendButton.disabled = true;
    {
      const text =
        'Lesen Sie mindestens 3 Artikel, um Empfehlungen zu erhalten.';
      recommendStatus.textContent = await maybeTranslate(text);
    }
    return;
  }

  // --- Start of Fix ---

  // 1. Create an array of promises. Each promise will resolve to an HTML string.
  const logItemPromises = log.map(async (item) => {
    const translatedTitle = await maybeTranslate(item.title);
    return `
        <li>
          <a data-details-url="${item.url}" data-id="${item.id}" data-title="${item.title}" data-first-sentence="${item.firstSentence}">${translatedTitle}</a>
        </li>`;
  });

  // 2. Wait for all the translation promises to resolve.
  const logHtmlItems = await Promise.all(logItemPromises);

  // 3. Join the resulting array of HTML strings and update the DOM.
  readingLogList.innerHTML = logHtmlItems.join('');

  // --- End of Fix ---

  if (log.length >= 3) {
    recommendButton.disabled = false;
    const text = 'Bereit für Empfehlungen!';
    recommendStatus.textContent = await maybeTranslate(text);
  } else {
    recommendButton.disabled = true;
    const text = `Lesen Sie noch ${3 - log.length} Artikel.`;
    recommendStatus.textContent = await maybeTranslate(text);
  }
}
// --- Language Model (AI Recommendation) Functions ---

const createSession = async (options = {}) => {
  if (sessionCreationTriggered) return;
  progress.hidden = true;
  progress.value = 0;

  try {
    if (!('LanguageModel' in self)) {
      throw new Error('The Prompt API is not supported by your browser.');
    }
    const availability = await LanguageModel.availability();
    if (availability === 'unavailable') {
      throw new Error('The large language model is not available.');
    }

    let modelNewlyDownloaded = availability !== 'available';
    if (modelNewlyDownloaded) progress.hidden = false;

    sessionCreationTriggered = true;
    const session = await LanguageModel.create({
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          progress.value = e.loaded;
          if (modelNewlyDownloaded && e.loaded === 1) {
            progress.removeAttribute('value'); // Indeterminate state while loading
          }
        });
      },
      ...options,
    });
    sessionCreationTriggered = false;
    return session;
  } catch (error) {
    sessionCreationTriggered = false;
    throw error;
  } finally {
    progress.hidden = true;
    progress.value = 0;
  }
};

async function getRecommendations() {
  recommendButton.disabled = true;
  const text = 'Analysiere Artikel...';
  recommendStatus.textContent = await maybeTranslate(text);
  recommendationsList.innerHTML = '';

  const readArticlesLog = JSON.parse(
    sessionStorage.getItem(READING_LOG_KEY) || '[]'
  );
  if (readArticlesLog.length < 3) return;

  try {
    // 1. Get read and unread articles from the cached list
    const readArticleIDs = new Set(
      readArticlesLog.map((article) => article.id)
    );
    const unreadArticles = displayedArticles.filter(
      (article) => !readArticleIDs.has(article.sophoraId)
    );

    if (unreadArticles.length < 3) {
      const text = 'Nicht genügend ungelesene Artikel für Empfehlungen.';
      recommendStatus.textContent = await maybeTranslate(text);
      recommendButton.disabled = false;
      return;
    }

    // 2. Build the system prompt with UNREAD article teasers
    let systemPromptContent =
      'Du bist ein Nachrichten-Redakteur. Deine Aufgabe ist es, aus der folgenden Liste verfügbarer Artikel, passende Empfehlungen für einen Nutzer zu generieren, basierend auf bisher gelesenen Artikeln. Gib für jede Empfehlung eine sehr kurze Begründung an, bezugnehmend auf die bereits gelesenen Artikel. Die verfügbaren Artikel sind:\n\n';
    unreadArticles.forEach((article) => {
      systemPromptContent += `---\nTitel: ${article.title.replaceAll('&quot;', '"')}\nTeaser: ${article.firstSentence.replaceAll('&quot;', '"')}\nID: ${article.sophoraId}\n---\n\n`;
    });

    // 3. Create the dynamic JSON Schema based on UNREAD articles
    const schema = {
      type: 'object',
      properties: {
        recommendations: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                enum: unreadArticles.map((a) => a.sophoraId),
              },
              rationale: {
                type: 'string',
              },
            },
            required: ['id', 'rationale'],
          },
        },
      },
      required: ['recommendations'],
    };

    console.log('JSON Schema:', schema);

    // 4. Build the user prompt with READ article titles
    let userPromptContent =
      'Bitte empfiehl mir 3 neue, thematisch passende Artikel aus der Liste, die du bereits hast. Empfiehl mir ausdrücklich keine Artikel, die ich schon gelesen habe. Ich habe die folgenden Artikel schon gelesen:\n\n';
    readArticlesLog.forEach((article) => {
      userPromptContent += `---\nTitel: ${article.title.replaceAll('&quot;', '"')}\nTeaser: ${article.firstSentence.replaceAll('&quot;', '"')}\nID: ${article.id}\n---\n\n`;
    });

    userPromptContent += `\nBeispiel für eine Antwort:

{
"recommendations": [
{
"id": "Eine Artikel-ID",
"rationale": "Eine kurze Beschreibung"
},
{
"id": "Eine Artikel-ID",
"rationale": "Eine kurze Beschreibung"
}
]
}`;

    // 5. Create session and prompt
    {
      const text = 'Initialisiere KI-Sitzung (kann dauern)...';
      recommendStatus.textContent = await maybeTranslate(text);
      languageModelSession = await createSession({
        initialPrompts: [{ role: 'system', content: systemPromptContent }],
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      });
      console.log('System prompt:', {
        initialPrompts: [{ role: 'system', content: systemPromptContent }],
      });
      console.log('User prompt:', userPromptContent);
    }
    {
      const text = 'Generiere Empfehlungen...';
      recommendStatus.textContent = await maybeTranslate(text);
    }
    recommendStatus.classList.add('busy-indicator');
    const stream = languageModelSession.promptStreaming(userPromptContent, {
      responseConstraint: { schema },
      omitResponseConstraintInput: false,
    });
    let result = '';
    for await (const chunk of stream) {
      result += chunk;
    }
    recommendStatus.classList.remove('busy-indicator');
    console.log('AI response:', result);
    const { recommendations } = JSON.parse(result);

    // 6. Display results
    displayRecommendations(recommendations, unreadArticles);
    const text = 'Hier sind Ihre Empfehlungen:';
    recommendStatus.textContent = await maybeTranslate(text);
  } catch (error) {
    console.error('Recommendation failed:', error);
    const text = 'Fehler bei der Empfehlung.';
    recommendStatus.textContent = await maybeTranslate(text);
    recommendationsList.innerHTML = `<li>${error.message}</li>`;
  } finally {
    if (readArticlesLog.length >= 3) recommendButton.disabled = false;
  }
}

async function displayRecommendations(recommendations, unreadArticles) {
  console.log('Recommendations:', recommendations);

  // 1. .map() creates an array of promises, one for each recommendation.
  const recommendationPromises = recommendations.map(async (rec) => {
    const originalArticle = unreadArticles.find(
      (item) => item.sophoraId === rec.id
    );

    // If an article isn't found, resolve the promise with an empty string.
    if (!originalArticle) return '';

    // Await the translation for the 'reason' text if needed.
    let text = 'Begründung:';
    text = await maybeTranslate(text);

    // Await the translations for title and rationale.
    const translatedTitle = await maybeTranslate(originalArticle.title);
    const translatedRationale = await maybeTranslate(rec.rationale);

    // Return the final HTML string for this list item.
    return `
      <li class="recommendation-item">
        <a data-details-url="${originalArticle.details}" data-id="${originalArticle.sophoraId}" data-title="${originalArticle.title.replace(/"/g, '&quot;')}" data-first-sentence="${originalArticle.firstSentence.replace(/"/g, '&quot;')}}">
          ${translatedTitle}
        </a>
        <p>${text} ${translatedRationale}</p>
      </li>`;
  });

  // 2. Wait for ALL the promises in the array to resolve.
  // The result is an array of the resolved values (our HTML strings).
  const recommendationHtmlItems = await Promise.all(recommendationPromises);

  // 3. Now join the resolved HTML strings and set the innerHTML.
  recommendationsList.innerHTML = recommendationHtmlItems.join('');
}

// --- UI Helper Functions ---
function showModal(content = '') {
  document.body.classList.add('modal-open');
  modalContent.innerHTML = content;
  modal.classList.add('visible');
  modal.showModal();
}

function displayError(message) {
  newsContainer.innerHTML = `<div id="error">${message}</div>`;
}

function articleClick(event) {
  const clickableItem = event.target.closest('[data-details-url]');
  if (clickableItem) {
    const articleInfo = {
      id: clickableItem.dataset.id,
      title: clickableItem.dataset.title,
      firstSentence: clickableItem.dataset.firstSentence,
      url: clickableItem.dataset.detailsUrl,
    };
    if (
      articleInfo.id &&
      articleInfo.title &&
      articleInfo.firstSentence &&
      articleInfo.url
    ) {
      fetchArticleDetails(articleInfo.url);
      logArticleRead(articleInfo);
    }
  }
}

// --- Event Listeners ---
document.body.addEventListener('click', articleClick);

recommendButton.addEventListener('click', getRecommendations);

recommendationsList.addEventListener('click', articleClick);

readingLogList.addEventListener('click', articleClick);

function closeModal() {
  document.body.classList.remove('modal-open');
  modal.classList.remove('visible');
  modalContent.innerHTML = '';
}
modalCloseBtn.addEventListener('click', () => modal.close());
modal.addEventListener('close', closeModal);

// --- Initial Load ---
main();
