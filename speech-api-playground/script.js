/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

document.addEventListener('DOMContentLoaded', () => {

    // Get all the DOM elements
    const langInput = document.getElementById('lang-input');
    const processLocallyCheck = document.getElementById('process-locally-check');
    const continuousCheck = document.getElementById('continuous-check');
    const interimResultsCheck = document.getElementById('interim-results-check');
    const unspokenPunctuationCheck = document.getElementById('unspoken-punctuation-check');
    const qualitySelect = document.getElementById('quality-select');
    const codeDisplay = document.getElementById('code-display');
    const audioSource = document.getElementById('audio-source');
    const executeBtn = document.getElementById('execute-btn');
    const stopBtn = document.getElementById('stop-btn');
    const checkAvailabilityBtn = document.getElementById('check-availability-btn');
    const installBtn = document.getElementById('install-btn');
    const addPhraseBtn = document.getElementById('add-phrase-btn');
    const phrasesContainer = document.getElementById('phrases-container');
    const outputEl = document.getElementById('output');
    const translateLangSelect = document.getElementById('translate-lang-select');
    const translationStatus = document.getElementById('translation-status');
    const translationOutput = document.getElementById('translation-output');

    // --- 1. UI and Code Generation ---

    function createPhraseRow() {
        const row = document.createElement('div');
        row.className = 'phrase-row';
        row.innerHTML = `
            <input type="text" class="phrase-input" placeholder="e.g., Gemini Code Assist" title="Phrase">
            <input type="text" class="boost-input" value="1.0" title="Boost value">
            <button class="remove-phrase-btn">×</button>
        `;
        phrasesContainer.appendChild(row);
        row.querySelector('.remove-phrase-btn').addEventListener('click', () => {
            row.remove();
            generateCode();
        });
        // Re-generate code when inputs change
        row.querySelector('.phrase-input').addEventListener('input', generateCode);
        row.querySelector('.boost-input').addEventListener('input', generateCode);
    }
    
    function generateCode() {
        const lang = langInput.value;
        const isProcessLocally = processLocallyCheck.checked;
        const isContinuous = continuousCheck.checked;
        const isInterimResults = interimResultsCheck.checked;
        const isUnspokenPunctuation = unspokenPunctuationCheck.checked;
        const quality = qualitySelect.value;

        const phraseRows = phrasesContainer.querySelectorAll('.phrase-row');
        const phrasesCode = Array.from(phraseRows).map(row => {
            const phrase = row.querySelector('.phrase-input').value.trim();
            const boost = parseFloat(row.querySelector('.boost-input').value) || 1.0;
            return phrase ? `        new SpeechRecognitionPhrase("${phrase.replace(/"/g, '\\"')}", ${boost})` : '';
        }).filter(Boolean).join(',\n    ');

        // Use a template literal to build the JS code string
        const codeTemplate = `
// Get the output element from the page
const output = document.getElementById('output');
output.innerHTML = "<p>Initializing speech recognition...</p>";

try {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const SpeechRecognitionPhrase = window.SpeechRecognitionPhrase || window.webkitSpeechRecognitionPhrase;
    
    if (!SpeechRecognition) {
        output.innerHTML = "<p>Error: Speech Recognition API is not supported in this browser.</p>";
        return;
    }

    const recognition = new SpeechRecognition();
    window.currentRecognition = recognition;

    // Timing and metrics variables
    let startTime = 0;
    let firstTokenTime = 0;
    let endTime = 0;
    let fullTranscript = '';

    // --- Options Set by You ---
    recognition.lang = "${lang}";
    recognition.processLocally = ${isProcessLocally};
${quality ? '    recognition.quality = "' + quality + '";\n' : ''}    recognition.interimResults = ${isInterimResults};
    recognition.continuous = ${isContinuous};
    recognition.unspokenPunctuation = ${isUnspokenPunctuation};
    recognition.phrases = SpeechRecognitionPhrase ? [
${phrasesCode}
    ] : [];
    // --------------------------

    recognition.onstart = () => {
        performance.mark('speech-recognition-onstart');
        startTime = performance.now();
        firstTokenTime = 0;
        output.innerHTML = "<p>Listening... Speak into your microphone.</p>";
        window.onLiveTranslationStart?.();
    };

    recognition.onresult = (event) => {
        if (firstTokenTime === 0) {
            performance.mark('speech-recognition-first-token');
            firstTokenTime = performance.now();
            performance.measure('SpeechRecognition (TFTT)', 'speech-recognition-start', 'speech-recognition-first-token');
        }
        
        fullTranscript = '';
        for (let i = 0; i < event.results.length; ++i) {
            fullTranscript += event.results[i][0].transcript;
        }
        
        output.innerHTML = \`
            <p><strong>Transcript:</strong> \${fullTranscript}</p>
        \`;

        // Hand the transcript to the live translation panel below the output.
        window.onLiveTranslationTranscript?.(fullTranscript);
    };

    recognition.onerror = (event) => {
        output.innerHTML = \`<p><strong>Error:</strong> \${event.error}</p>\`;
    };

    recognition.onend = () => {
        if (endTime === 0) {
            performance.mark('speech-recognition-end');
            endTime = performance.now();
            performance.measure('SpeechRecognition (end to end)', 'speech-recognition-start', 'speech-recognition-end');
        }
        
        const coldStartMs = firstTokenTime ? (firstTokenTime - startTime).toFixed(2) : 0;
        const e2eMs = (endTime - startTime).toFixed(2);
        
        const tokens = fullTranscript.trim().split(/\\s+/).filter(word => word.length > 0).length;
        const decodeTimeS = firstTokenTime ? (endTime - firstTokenTime) / 1000 : 0;
        const tokensPerSec = decodeTimeS > 0 ? (tokens / decodeTimeS).toFixed(2) : 0;

        const metricsHtml = \`
            <div class="metrics">
                <p><strong>Cold Start (Time to First Token):</strong> \${coldStartMs} ms</p>
                <p><strong>Decoding Speed:</strong> \${tokensPerSec} tokens/sec (\${tokens} tokens)</p>
                <p><strong>End-to-End Latency:</strong> \${e2eMs} ms</p>
            </div>
        \`;

        output.innerHTML += metricsHtml + "<p>(Recognition ended.)</p>";

        // Translate whatever is left over, even without closing punctuation.
        window.onLiveTranslationEnd?.(fullTranscript);
    };

    // Start the recognition
    performance.mark('speech-recognition-start');
    recognition.start();

} catch (e) {
    output.innerHTML = \`<p>An execution error occurred: \${e.message}</p>\`;
    console.error(e);
}
`;
        // Set the text of the code block (trim whitespace)
        codeDisplay.textContent = codeTemplate.trim();
    }

    // --- 2. Execution Logic ---
    
    function executeCode() {
        if (window.currentRecognition) {
            try { window.currentRecognition.stop(); } catch (e) {}
            window.currentRecognition = null;
        }
        // Get the *current* text from the editable code block
        const userCode = codeDisplay.textContent;

        // --- SECURITY WARNING ---
        // Using new Function() is safer than eval() as it runs in its
        // own scope, but it's still executing arbitrary user code.
        // This is fine for a personal playground but not for production
        // with untrusted users.
        try {
            const F = new Function(userCode);
            F();
        } catch (e) {
            outputEl.innerHTML = `<p><strong>Execution Error:</strong> ${e.message}</p>`;
            console.error(e);
        }
    }

    // --- 2b. Function to Execute with Audio Track ---
    async function executeWithAudioTrack() {
        if (window.currentRecognition) {
            try { window.currentRecognition.stop(); } catch (e) {}
            window.currentRecognition = null;
        }
        const output = document.getElementById('output');
        output.innerHTML = "<p>Initializing speech recognition with audio track...</p>";

        try {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognition) {
                output.innerHTML = "<p>Error: Speech Recognition API is not supported.</p>";
                return;
            }

            // Capture the stream from the audio element
            const stream = audioSource.captureStream ? audioSource.captureStream() : audioSource.mozCaptureStream();
            const audioTracks = stream.getAudioTracks();

            if (audioTracks.length === 0) {
                output.innerHTML = "<p>Error: Could not find an audio track in the media element.</p>";
                return;
            }

            // This is the correct implementation: create a standard recognition object.
            const recognition = new SpeechRecognition();
            window.currentRecognition = recognition;
            const audioTrack = audioTracks[0];

            // Timing and metrics variables
            let startTime = 0;
            let firstTokenTime = 0;
            let endTime = 0;
            let fullTranscript = '';

            // Get phrases from the UI
            const SpeechRecognitionPhrase = window.SpeechRecognitionPhrase || window.webkitSpeechRecognitionPhrase;
            const phrases = SpeechRecognitionPhrase ? Array.from(phrasesContainer.querySelectorAll('.phrase-row')).map(row => {
                const phrase = row.querySelector('.phrase-input').value.trim();
                const boost = parseFloat(row.querySelector('.boost-input').value) || 1.0;
                // Use the constructor to create a proper SpeechRecognitionPhrase object
                return phrase ? new SpeechRecognitionPhrase(phrase, boost) : null;
            }).filter(Boolean) : [];


            // Re-implement the logic from generateCode, but for the audio track.
            // This is more robust than string manipulation.
            recognition.lang = langInput.value;
            recognition.processLocally = processLocallyCheck.checked;
            if (qualitySelect.value) {
                recognition.quality = qualitySelect.value;
            }
            recognition.interimResults = interimResultsCheck.checked;
            recognition.continuous = continuousCheck.checked;
            recognition.phrases = phrases;
            recognition.unspokenPunctuation = unspokenPunctuationCheck.checked;

            recognition.onstart = () => {
                performance.mark('speech-recognition-onstart');
                startTime = performance.now();
                firstTokenTime = 0;
                metricsRendered = false;
                resetTranslations();
                output.innerHTML = `
                    <div id="transcript-area"><p>Listening to audio track...</p></div>
                    <div id="metrics-area"></div>
                `;
            };

            recognition.onresult = (event) => {
                if (firstTokenTime === 0) {
                    performance.mark('speech-recognition-first-token');
                    firstTokenTime = performance.now();
                    performance.measure('SpeechRecognition (TFTT)', 'speech-recognition-start', 'speech-recognition-first-token');
                }
                
                fullTranscript = '';
                for (let i = 0; i < event.results.length; ++i) {
                    fullTranscript += event.results[i][0].transcript;
                }
                
                const transcriptArea = document.getElementById('transcript-area');
                if (transcriptArea) {
                    transcriptArea.innerHTML = `<p><strong>Transcript:</strong> ${fullTranscript}</p>`;
                }

                handleTranscript(fullTranscript);

                if (metricsRendered) {
                    // Update metrics if more results trickle in after we thought we were done
                    endTime = performance.now();
                    updateMetricsArea();
                } else if (typeof resetResultDebounce === 'function') {
                    resetResultDebounce();
                }
            };

            recognition.onerror = (event) => {
                const transcriptArea = document.getElementById('transcript-area');
                if (transcriptArea) {
                    transcriptArea.innerHTML += `<p><strong>Error:</strong> ${event.error}</p>`;
                } else {
                    output.innerHTML += `<p><strong>Error:</strong> ${event.error}</p>`;
                }
            };

            const updateMetricsArea = () => {
                if (endTime === 0) {
                    performance.mark('speech-recognition-end');
                    endTime = performance.now();
                    performance.measure('SpeechRecognition (end to end)', 'speech-recognition-start', 'speech-recognition-end');
                }
                
                const coldStartMs = firstTokenTime ? (firstTokenTime - startTime).toFixed(2) : 0;
                const e2eMs = (endTime - startTime).toFixed(2);
                
                const tokens = fullTranscript.trim().split(/\s+/).filter(word => word.length > 0).length;
                const decodeTimeS = firstTokenTime ? (endTime - firstTokenTime) / 1000 : 0;
                const tokensPerSec = decodeTimeS > 0 ? (tokens / decodeTimeS).toFixed(2) : 0;

                const metricsHtml = `
                    <div class="metrics">
                        <p><strong>Cold Start (Time to First Token):</strong> ${coldStartMs} ms</p>
                        <p><strong>Decoding Speed:</strong> ${tokensPerSec} tokens/sec (${tokens} tokens)</p>
                        <p><strong>End-to-End Latency:</strong> ${e2eMs} ms</p>
                    </div>
                `;
                
                const metricsArea = document.getElementById('metrics-area');
                if (metricsArea) {
                    metricsArea.innerHTML = metricsHtml + "<p>(Audio track recognition finished)</p>";
                }
            };

            let metricsRendered = false;
            let resultDebounceTimer = null;

            const renderMetrics = () => {
                if (metricsRendered) return;
                metricsRendered = true;

                updateMetricsArea();
                flushTranslations();
                
                // Clean up listeners
                audioSource.removeEventListener('ended', handleAudioPlaybackEnded);
                audioSource.removeEventListener('pause', handleAudioPlaybackEnded);
                
                // Now that we are confident no more results are coming (or we timed out),
                // safely tell the recognition engine to stop if it hasn't already.
                try { recognition.stop(); } catch(e) {}
            };

            const handleAudioPlaybackEnded = () => {
                resetResultDebounce();
            };

            const resetResultDebounce = () => {
                clearTimeout(resultDebounceTimer);
                // Only start the finish timer if the audio has actually stopped playing
                if (audioSource.ended || audioSource.paused) {
                    resultDebounceTimer = setTimeout(() => {
                        renderMetrics();
                    }, 2500); // Wait 2.5 seconds after audio ends or last result
                }
            };

            audioSource.addEventListener('ended', handleAudioPlaybackEnded);
            audioSource.addEventListener('pause', handleAudioPlaybackEnded);

            recognition.onend = () => {
                renderMetrics();
            };

            // The correct way to start recognition with a track is via the start() method.
            performance.mark('speech-recognition-start');
            recognition.start(audioTrack);
        } catch (e) {
            output.innerHTML = `<p>An execution error occurred: ${e.message}</p>`;
            console.error(e);
        }
    }

    // --- 2c. Functions for On-Device Model Management ---
    async function checkAvailability() {
        const lang = langInput.value;
        outputEl.innerHTML = `<p>Checking availability for on-device model [${lang}]...</p>`;

        try {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognition.available) {
                outputEl.innerHTML = `<p>Error: SpeechRecognition.available() is not supported in this browser.</p>`;
                return;
            }

            const options = { processLocally: true, langs: [lang] };
            if (qualitySelect.value) {
                options.quality = qualitySelect.value;
            }
            const availability = await SpeechRecognition.available(options);

            outputEl.innerHTML = `<p><strong>Availability for [${lang}]:</strong> ${availability}</p>`;

        } catch (e) {
            outputEl.innerHTML = `<p>An error occurred while checking availability: ${e.message}</p>`;
            console.error(e);
        }
    }

    async function installModel() {
        const lang = langInput.value;
        outputEl.innerHTML = `<p>Starting installation for on-device model [${lang}]...</p>`;

        try {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognition.install) {
                outputEl.innerHTML = `<p>Error: SpeechRecognition.install() is not supported in this browser.</p>`;
                return;
            }

            const options = { processLocally: true, langs: [lang] };
            if (qualitySelect.value) {
                options.quality = qualitySelect.value;
            }
            const installed = await SpeechRecognition.install(options);

            if (installed) {
                outputEl.innerHTML = `<p><strong>Success!</strong> Model for [${lang}] has been installed.</p>`;
            } else {
                outputEl.innerHTML = `<p><strong>Installation Failed.</strong> The model for [${lang}] could not be installed. The browser may provide more details in the console.</p>`;
            }
        } catch (e) {
            outputEl.innerHTML = `<p>An error occurred while starting installation: ${e.message}</p>`;
            console.error(e);
        }
    }

    // --- 2d. Live Translation with the Translator API ---

    // Matches everything up to and including a run of sentence-ending punctuation.
    // An unterminated tail is left out, so a sentence is only picked up once the
    // speaker has actually finished it.
    const SENTENCE_REGEX = /[^.!?\u2026\u3002\uFF01\uFF1F]*[.!?\u2026\u3002\uFF01\uFF1F]+/g;

    let sentences = [];      // One { source, target, state } entry per complete sentence.
    let lastTranscript = '';
    let tailFlushed = false; // Once recognition is over, an unfinished sentence counts too.
    let translator = null;
    let translatorPromise = null;
    let translatorKey = '';

    // "en-US" -> "en", "zh-Hant-TW" -> "zh-Hant". The Translator API expects a
    // language, optionally with a script, but not a region.
    function baseLanguageTag(tag) {
        const [language, second] = tag.trim().replace(/_/g, '-').split('-');
        if (!language) {
            return '';
        }
        if (second && /^[a-z]{4}$/i.test(second)) {
            return `${language.toLowerCase()}-${second[0].toUpperCase()}${second.slice(1).toLowerCase()}`;
        }
        return language.toLowerCase();
    }

    function splitSentences(text, includeTail) {
        const matches = Array.from(text.matchAll(SENTENCE_REGEX));
        const result = matches.map(match => match[0].trim());
        if (includeTail) {
            const last = matches[matches.length - 1];
            result.push(text.slice(last ? last.index + last[0].length : 0).trim());
        }
        // Drop fragments that are punctuation or whitespace only.
        return result.filter(sentence => /[\p{L}\p{N}]/u.test(sentence));
    }

    function escapeHtml(text) {
        const element = document.createElement('div');
        element.textContent = text;
        return element.innerHTML;
    }

    function setTranslationStatus(message, isError) {
        translationStatus.textContent = message || '';
        translationStatus.hidden = !message;
        translationStatus.classList.toggle('error', Boolean(isError));
    }

    function destroyTranslator() {
        if (translator) {
            try { translator.destroy(); } catch (e) {}
        }
        translator = null;
        translatorPromise = null;
        translatorKey = '';
    }

    // Creates (and caches) one Translator for the current language pair. The
    // promise is reused so that sentences arriving back to back share a model
    // download instead of triggering one each.
    function getTranslator() {
        const sourceLanguage = baseLanguageTag(langInput.value);
        const targetLanguage = translateLangSelect.value;
        const key = `${sourceLanguage}>${targetLanguage}`;
        if (translatorPromise && translatorKey === key) {
            return translatorPromise;
        }

        destroyTranslator();
        translatorKey = key;
        translatorPromise = (async () => {
            if (!('Translator' in self)) {
                throw new Error('The Translator API is not supported in this browser.');
            }
            if (!sourceLanguage) {
                throw new Error('Set a recognition language to translate from.');
            }
            if (sourceLanguage === targetLanguage) {
                throw new Error(`Nothing to translate: recognition is already in "${targetLanguage}".`);
            }

            const availability = await Translator.availability({ sourceLanguage, targetLanguage });
            if (availability === 'unavailable') {
                throw new Error(`Translation from "${sourceLanguage}" to "${targetLanguage}" is unavailable.`);
            }
            if (availability !== 'available') {
                setTranslationStatus(`Preparing the ${sourceLanguage} \u2192 ${targetLanguage} model\u2026`);
            }

            const instance = await Translator.create({
                sourceLanguage,
                targetLanguage,
                monitor(monitor) {
                    monitor.addEventListener('downloadprogress', (e) => {
                        setTranslationStatus(`Downloading the ${sourceLanguage} \u2192 ${targetLanguage} model\u2026 ${Math.floor(e.loaded * 100)}%`);
                    });
                },
            });

            translator = instance;
            setTranslationStatus(`Translating ${sourceLanguage} \u2192 ${targetLanguage}.`);
            return instance;
        })();
        return translatorPromise;
    }

    async function translateSentence(index) {
        const entry = sentences[index];
        try {
            const instance = await getTranslator();
            // A later interim result may have rewritten this sentence in the meantime.
            if (sentences[index] !== entry) {
                return;
            }
            const target = await instance.translate(entry.source);
            if (sentences[index] !== entry) {
                return;
            }
            entry.target = target;
            entry.state = 'done';
        } catch (e) {
            if (sentences[index] !== entry) {
                return;
            }
            entry.target = e.message;
            entry.state = 'error';
            setTranslationStatus(e.message, true);
            console.error(e);
        }
        renderTranslations();
    }

    function renderTranslations() {
        if (!translateLangSelect.value) {
            translationOutput.hidden = true;
            return;
        }
        translationOutput.hidden = false;
        if (!sentences.length) {
            translationOutput.innerHTML = '<p>Completed sentences are translated here\u2026</p>';
            return;
        }
        translationOutput.innerHTML = sentences.map(entry => `
            <p class="translation-entry ${entry.state}">
                <span class="translation-source">${escapeHtml(entry.source)}</span>
                <span class="translation-target">${entry.state === 'pending' ? '\u2026' : escapeHtml(entry.target)}</span>
            </p>
        `).join('');
    }

    // Called with the transcript recognized so far. Every sentence that has been
    // completed since the last call is queued for translation.
    function handleTranscript(transcript, includeTail = false) {
        lastTranscript = transcript;
        if (!translateLangSelect.value) {
            return;
        }

        const complete = splitSentences(transcript, includeTail || tailFlushed);
        // Interim results can rewrite an earlier sentence, so compare by position
        // and re-translate only the entries whose text actually changed.
        sentences.length = complete.length;
        complete.forEach((source, index) => {
            if (sentences[index] && sentences[index].source === source) {
                return;
            }
            sentences[index] = { source, target: '', state: 'pending' };
            translateSentence(index);
        });
        renderTranslations();
    }

    // Recognition is over: translate the trailing words even if the speaker never
    // finished the sentence with punctuation.
    function flushTranslations(transcript = lastTranscript) {
        tailFlushed = true;
        handleTranscript(transcript, true);
    }

    function resetTranslations() {
        sentences = [];
        lastTranscript = '';
        tailFlushed = false;
        setTranslationStatus('');
        renderTranslations();
    }

    // The language pair changed: keep the recognized sentences, throw away their
    // translations and run them through the new model.
    function retranslateAll() {
        destroyTranslator();
        setTranslationStatus('');
        if (!translateLangSelect.value) {
            renderTranslations();
            return;
        }
        sentences = sentences.map(entry => ({ source: entry.source, target: '', state: 'pending' }));
        sentences.forEach((entry, index) => translateSentence(index));
        renderTranslations();
        if (!sentences.length) {
            // Warm the model up (and surface any error) before the next utterance.
            getTranslator().catch(e => setTranslationStatus(e.message, true));
        }
    }

    // Hooks that the generated, user-editable code calls into.
    window.onLiveTranslationStart = resetTranslations;
    window.onLiveTranslationTranscript = transcript => handleTranscript(transcript);
    window.onLiveTranslationEnd = transcript => flushTranslations(transcript);

    // --- 3. Attach Event Listeners ---

    // Update the code block whenever an option changes
    langInput.addEventListener('input', generateCode);
    processLocallyCheck.addEventListener('input', generateCode);
    continuousCheck.addEventListener('input', generateCode);
    interimResultsCheck.addEventListener('input', generateCode);
    unspokenPunctuationCheck.addEventListener('input', generateCode);
    qualitySelect.addEventListener('input', generateCode);
    addPhraseBtn.addEventListener('click', createPhraseRow);

    // Attach event listeners
    executeBtn.addEventListener('click', executeCode);
    stopBtn.addEventListener('click', () => {
        if (!audioSource.paused) {
            audioSource.pause();
        }
        if (window.currentRecognition) {
            try { window.currentRecognition.stop(); } catch (e) {}
            window.currentRecognition = null;
            outputEl.innerHTML += '<p>(Stopped by user.)</p>';
        }
        flushTranslations();
    });
    translateLangSelect.addEventListener('change', retranslateAll);
    // A different recognition language means a different translation source language.
    // Debounced, so that typing a tag does not probe the model for every keystroke.
    let langChangeTimer = null;
    langInput.addEventListener('input', () => {
        clearTimeout(langChangeTimer);
        langChangeTimer = setTimeout(retranslateAll, 500);
    });
    checkAvailabilityBtn.addEventListener('click', checkAvailability);
    installBtn.addEventListener('click', installModel);
    audioSource.addEventListener('play', executeWithAudioTrack);
    

    // --- 4. Initial Call ---
    // Generate the code for the first time on page load
    generateCode();
});
