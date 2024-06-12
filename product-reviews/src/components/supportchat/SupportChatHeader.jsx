/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import './SupportChatHeader.css';

export default function SupportChatHeader({selectedLanguage, onLanguageChange}) {
    return (
      <div className="chat-header">
        <h1>Support Chat</h1>
        <div className="chat-header-translation">
          <div class="auto-translate-control">
            Automatic translation
            <div class="toggle-switch">
              <input class="toggle-input" id="toggle" type="checkbox"></input>
              <label class="toggle-label" for="toggle"></label>
            </div>
          </div>
          <div>
            <span class="label">Language</span>
            <select
              id="language-selector"
              onChange={(e) => onLanguageChange(e.target.value)}
            >
              <option selected={selectedLanguage === 'zh'} value="zh">
                Chinese
              </option>
              <option selected={selectedLanguage === 'ja'} value="ja">
                Japanese
              </option>
              <option selected={selectedLanguage === 'pt'} value="pt">
                Portuguese
              </option>
              <option selected={selectedLanguage === 'es'} value="es">
                Spanish
              </option>
            </select>
          </div>
        </div>
      </div>
    );
}
