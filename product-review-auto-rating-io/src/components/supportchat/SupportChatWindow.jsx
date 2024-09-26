/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import SupportChatFooter from './SupportChatFooter';
import SupportChatHeader from './SupportChatHeader';
import SupportChatMessages from './SupportChatMessages';
import './SupportChatWindow.css';
import { Translation, TranslationContext } from '../../contexts/TranslationContext';
import { useEffect, useState } from 'preact/hooks';

const DEFAULT_USER_LANGUAGE = 'pt';

export default function SupportChatWindow() {
	let [translationInstance, setTranslationInstance] = useState(new Translation(DEFAULT_USER_LANGUAGE));
	let [messages, setMessages] = useState([{
		sender: 'support', content: 'Hello, how can I help you today?', translatedContent: null
	}]);
	let [userLanguage, setUserLanguage] = useState(DEFAULT_USER_LANGUAGE);

	const onLanguageChange = async (language) => {
		setTranslationInstance(new Translation(language));
		setUserLanguage(language);
	};

	const onNewUserMessage = (newMessage) => {
		setMessages([...messages, newMessage]);	
	};

	// Updates the translation for all messages.
	useEffect(() => {
		Promise.all(messages.map(async m => {
			return {
			   ...m,
			   translatedContent: await translationInstance.systemTranslator.translate(m.content)
		    }
	    })).then(translatedMessages => {
			setMessages(translatedMessages);
	    });	   
	}, [translationInstance]);

    return (
        <div className='chat-window'>
			<TranslationContext.Provider value={translationInstance}>
				<SupportChatHeader selectedLanguage={userLanguage} onLanguageChange={onLanguageChange} />
				<SupportChatMessages messages={messages} />
				<SupportChatFooter onNewMessage={onNewUserMessage}/>
			</TranslationContext.Provider>
        </div>
    )
}