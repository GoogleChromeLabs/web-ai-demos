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

// --- Core News App Functions ---

async function main() {
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
      displayError('Nachrichten-Feed konnte nicht geladen werden.');
    }
  }
}

function displayNews(newsItems) {
  newsContainer.innerHTML = '';

  const filteredNews = newsItems.filter(
    (item) => item.firstSentence && item.details
  );
  displayedArticles = filteredNews; // Store articles for later use by the recommender

  if (filteredNews.length === 0) {
    displayError('Keine Artikel mit Vorschau gefunden.');
    return;
  }

  filteredNews.forEach((article) => {
    article.title = article.title.replace(/"/g, '&quot;');
    article.firstSentence = article.firstSentence.replace(/"/g, '&quot;');
    const imageUrl = article.teaserImage?.imageVariants?.['16x9-640'] || '';
    let formattedDate = '';
    if (article.date) {
      try {
        const date = new Date(article.date);
        formattedDate =
          date.toLocaleString('de-DE', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }) + ' Uhr';
      } catch (e) {
        console.warn('Datum konnte nicht verarbeitet werden:', article.date);
      }
    }

    const card = document.createElement('article');
    card.className = 'news-card';

    card.innerHTML = `
      <div class="news-card__image-container">
        <img src="${imageUrl}" alt="${article.teaserImage?.alttext || article.title}" loading="lazy" class="news-card__image">
        <span class="news-card__type-badge">${article.type || 'News'}</span>
      </div>
      <div class="news-card__content">
        ${article.topline ? `<h3 class="news-card__topline">${article.topline}</h3>` : ''}
        <h2 class="news-card__title">${article.title}</h2>
        <p class="news-card__date">${formattedDate}</p>
        <p class="news-card__teaser">${article.firstSentence}</p>
        <button class="news-card__button"
            data-details-url="${article.details}"
            data-id="${article.sophoraId}"
            data-title="${article.title}"
            data-first-sentence="${article.firstSentence}"
        >
          Weiterlesen
        </button>
      </div>`;
    newsContainer.appendChild(card);
  });
}

async function fetchArticleDetails(url) {
  showModal('<div id="loading">Lade Artikel...</div>');
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const articleData = await response.json();

    let fullArticleHtml = '';
    if (articleData.content && Array.isArray(articleData.content)) {
      articleData.content.forEach((contentBlock) => {
        if (contentBlock.value) {
          fullArticleHtml += `<p>${contentBlock.value}</p>`;
        } else if (contentBlock.box && contentBlock.box.text) {
          fullArticleHtml += `<div class="content-box"><h4>${contentBlock.box.title || ''}</h4><div>${contentBlock.box.text}</div></div>`;
        }
      });
    }

    const finalModalHTML = `
      <h1>${articleData.title || 'Ohne Titel'}</h1>
      <p><strong>${articleData.topline || ''}</strong></p>
      <hr>
      <div>${fullArticleHtml || '<p>Der vollständige Artikelinhalt konnte nicht geladen werden.</p>'}</div>`;
    modalContent.innerHTML = finalModalHTML;
  } catch (error) {
    console.error('Failed to fetch article details:', error);
    modalContent.innerHTML =
      '<div id="error">Entschuldigung, der vollständige Artikel konnte nicht geladen werden.</div>';
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

function updateReadingLogDisplay() {
  const log = JSON.parse(sessionStorage.getItem(READING_LOG_KEY) || '[]');
  if (log.length === 0) {
    readingLogList.innerHTML =
      '<li><span class="empty-log-message">Sie haben noch keine Artikel gelesen.</span></li>';
    recommendButton.disabled = true;
    recommendStatus.textContent =
      'Lesen Sie mindestens 3 Artikel, um Empfehlungen zu erhalten.';
    return;
  }

  readingLogList.innerHTML = log
    .map(
      (item) => `
        <li>
          <a data-details-url="${item.url}" data-id="${item.id}" data-title="${item.title}" data-first-sentence="${item.firstSentence}">${item.title}</a>
        </li>`
    )
    .join('');

  if (log.length >= 3) {
    recommendButton.disabled = false;
    recommendStatus.textContent = 'Bereit für Empfehlungen!';
  } else {
    recommendButton.disabled = true;
    recommendStatus.textContent = `Lesen Sie noch ${3 - log.length} Artikel.`;
  }
}

// --- Language Model (AI Recommendation) Functions ---

const createSession = async (options = {}) => {
  if (sessionCreationTriggered) return;
  progress.hidden = true;
  progress.value = 0;

  try {
    if (!('LanguageModel' in self)) {
      throw new Error(
        'Die Prompt API wird von Ihrem Browser nicht unterstützt. Bitte aktivieren Sie chrome://flags/#prompt-api in Chrome 127+.'
      );
    }
    const availability = await LanguageModel.availability();
    if (availability === 'unavailable') {
      throw new Error('Das Sprachmodell ist auf diesem Gerät nicht verfügbar.');
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
  recommendStatus.textContent = 'Analysiere Artikel...';
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
      recommendStatus.textContent =
        'Nicht genügend ungelesene Artikel für Empfehlungen.';
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
    recommendStatus.textContent = 'Initialisiere KI-Sitzung (kann dauern)...';
    languageModelSession = await createSession({
      initialPrompts: [{ role: 'system', content: systemPromptContent }],
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
    });
    console.log('System prompt:', {
      initialPrompts: [{ role: 'system', content: systemPromptContent }],
    });
    console.log('User prompt:', userPromptContent);
    recommendStatus.textContent = 'Generiere Empfehlungen...';
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
    recommendStatus.textContent = 'Hier sind Ihre Empfehlungen:';
  } catch (error) {
    console.error('Recommendation failed:', error);
    recommendStatus.textContent = 'Fehler bei der Empfehlung.';
    recommendationsList.innerHTML = `<li>Fehler: ${error.message}</li>`;
  } finally {
    if (readArticlesLog.length >= 3) recommendButton.disabled = false;
  }
}

function displayRecommendations(recommendations, unreadArticles) {
  console.log('Recommendations:', recommendations);
  recommendationsList.innerHTML = recommendations
    .map((rec) => {
      const originalArticle = unreadArticles.find(
        (item) => item.sophoraId === rec.id
      );
      if (!originalArticle) return '';
      return `
        <li class="recommendation-item">
          <a data-details-url="${originalArticle.details}" data-id="${originalArticle.sophoraId}" data-title="${originalArticle.title.replace(/"/g, '&quot;')}" data-first-sentence="${originalArticle.firstSentence.replace(/"/g, '&quot;')}}">
            ${originalArticle.title}
          </a>
          <p>Begründung: ${rec.rationale}</p>
        </li>`;
    })
    .join('');
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
  console.log(event);
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
