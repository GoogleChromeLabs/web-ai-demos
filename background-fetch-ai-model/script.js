const MODEL_URL = 'face_stylizer_color_sketch.task';
const FETCH_ID = 'face_stylizer_color_sketch';

const progress = document.querySelector('progress');
const progressContainer = document.querySelector('.progress');
const successContainer = document.querySelector('.success');
const label = document.querySelector('label');
const startButton = document.querySelector('.start-button');
const cancelButton = document.querySelector('.cancel-button');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    const registration = await navigator.serviceWorker.register('sw.js');
    console.log('Service worker registered for scope', registration.scope);
    await trackDownloadProgress();
  });

  navigator.serviceWorker.addEventListener('message', async (event) => {
    console.log(event.data.message, event.data.id);
    const cache = await caches.open('downloads');
    const keys = await cache.keys();
    for (const key of keys) {
      const modelBlob = await cache
        .match(key)
        .then((response) => response.blob());
      // Do something with the model.
      console.log(modelBlob);
      successContainer.hidden = false;
      successContainer.textContent = `Model "${event.data.id}" (${formatBytes(
        modelBlob.size
      )}) downloaded and cached successfully.`;
    }
  });
}

const getResourceSize = async (url) => {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
    });
    if (response.ok) {
      const contentSize = response.headers.get('Content-Length');
      return contentSize;
    }
    console.error(`HTTP error: ${response.status}`);
    return 0;
  } catch (error) {
    console.error('Error fetching content size:', error);
    return 0;
  }
};

const updateUI = (bgFetch) => {
  progress.value = bgFetch.downloaded / bgFetch.downloadTotal;
  label.textContent = `${formatBytes(bgFetch.downloaded)}/${formatBytes(
    bgFetch.downloadTotal
  )} (${((bgFetch.downloaded / bgFetch.downloadTotal) * 100).toFixed(2)}%)`;
};

const formatBytes = (bytes) => {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'];
  let unitIndex = 0;

  // Calculate the correct unit
  while (bytes >= 1024 && unitIndex < units.length - 1) {
    bytes /= 1024;
    unitIndex++;
  }

  // Use Intl.NumberFormat to format the number with appropriate precision and unit
  return new Intl.NumberFormat('en', {
    style: 'unit',
    unit: units[unitIndex],
    unitDisplay: 'short',
    maximumFractionDigits: 2,
  }).format(bytes);
};

const trackDownloadProgress = async () => {
  const registration = await navigator.serviceWorker.ready;
  const bgFetch = await registration.backgroundFetch.get(FETCH_ID);
  if (!bgFetch) {
    startButton.ariaDisabled = 'false';
    return;
  }
  updateUI(bgFetch);
  cancelButton.ariaDisabled = 'false';
  progressContainer.hidden = false;

  let interval = setInterval(async () => {
    const bgFetch = await registration.backgroundFetch.get(FETCH_ID);
    console.log('interval', bgFetch);
    updateUI(bgFetch);
  }, 3000);

  bgFetch.addEventListener('progress', (e) => {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    if (!bgFetch.downloadTotal) {
      return;
    }
    if (bgFetch.failureReason || bgFetch.result === 'success') {
      progressContainer.hidden = true;
      cancelButton.ariaDisabled = 'true';
      startButton.ariaDisabled = 'false';
      return;
    }
    updateUI(bgFetch);
  });
};

startButton.addEventListener('click', async () => {
  successContainer.hidden = true;
  // If the model is already downloaded, return it from the cache.
  const modelAlreadyDownloaded = await caches.match(MODEL_URL);
  if (modelAlreadyDownloaded) {
    const modelBlob = await modelAlreadyDownloaded.blob();
    successContainer.hidden = false;
    successContainer.textContent = `Model "${FETCH_ID}" (${formatBytes(
      modelBlob.size
    )}) was found in cache.`;
    return modelBlob;
  }

  if (startButton.ariaDisabled === 'true') {
    return;
  }
  if (!('BackgroundFetchManager' in self)) {
    return;
  }
  const registration = await navigator.serviceWorker.ready;
  let bgFetch = await registration.backgroundFetch.get(FETCH_ID);
  if (!bgFetch) {
    bgFetch = await registration.backgroundFetch.fetch(FETCH_ID, MODEL_URL, {
      title: MODEL_URL.split('/').pop(),
      icons: [
        {
          src: 'favicon.png',
          size: '129x129',
          type: 'image/png',
        },
      ],
      downloadTotal: await getResourceSize(MODEL_URL),
    });
  }
  startButton.ariaDisabled = 'true';
  await trackDownloadProgress();
});

cancelButton.addEventListener('click', async () => {
  if (cancelButton.ariaDisabled === 'true') {
    return;
  }
  const registration = await navigator.serviceWorker.ready;
  const bgFetch = await registration.backgroundFetch.get(FETCH_ID);
  if (!bgFetch) {
    return;
  }
  await bgFetch.abort();
  startButton.ariaDisabled = 'false';
  cancelButton.ariaDisabled = 'true';
  progressContainer.hidden = true;
});

if (!('BackgroundFetchManager' in self)) {
  document.querySelector('.error').hidden = false;
}