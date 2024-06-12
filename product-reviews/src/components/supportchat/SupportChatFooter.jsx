/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import './SupportChatFooter.css';
import { useContext, useEffect, useState } from "react";
import { TranslationContext } from '../../contexts/TranslationContext'

export default function SupportChatFooter({onNewMessage}) {
	const translationInstance = useContext(TranslationContext);
	// console.log(translationInstance);
	let [userInput, setUserInput] = useState('');
	let [translatedInput, setTranslatedInput] = useState('');

	const onInput = (e) => {
		setUserInput(e.currentTarget.value);
	}

	useEffect(() => {
		if (!translationInstance) {
			return
		}
		translationInstance.userTranslator.translate(userInput)
			.then(translated => {
				console.log(userInput, '=>', translated);
				setTranslatedInput(translated);
			});
	}, [userInput]);

	const onSendClick = () => {
		let message = {
			sender: 'user',
			content: translatedInput,
			translatedContent: userInput,
		}
		setUserInput('');
		onNewMessage(message);
	};
	
    return (
      <div className="chat-footer">
        <div className="user-message">
          <textarea
            id="user-input"
            className="user-input-text"
            rows={5}
            onInput={onInput}
          >
            {userInput}
          </textarea>
        </div>
        <div className="user-message-translation">
          <span className="chat-bubble-language">
            <svg
              className="icon"
              xmlns="http://www.w3.org/2000/svg"
              height="15"
              viewBox="0 -960 960 960"
              width="15"
            >
              <path d="m476-80 182-480h84L924-80h-84l-43-122H603L560-80h-84ZM160-200l-56-56 202-202q-35-35-63.5-80T190-640h84q20 39 40 68t48 58q33-33 68.5-92.5T484-720H40v-80h280v-80h80v80h280v80H564q-21 72-63 148t-83 116l96 98-30 82-122-125-202 201Zm468-72h144l-72-204-72 204Z" />
            </svg>
            (en):{' '}
          </span>
          <span id="user-input-translated" className="user-input-translated">
            {translatedInput}
          </span>
        </div>
        <button id="send-button" className="send-button" onClick={onSendClick}>
          <svg
            width="15"
            height="15"
            viewBox="0 0 84 72"
            fill="#FFFFFF"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M0.04 72L84 36L0.04 0L0 28L60 36L0 44L0.04 72Z" />
          </svg>
          <span class="send-button-label">Send</span>
        </button>
      </div>
    );
}
