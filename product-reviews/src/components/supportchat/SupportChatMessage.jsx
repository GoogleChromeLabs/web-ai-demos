/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import './SupportChatMessage.css';

import SupportChatAvatar from "./SupportChatAvatar";

export default function SupportChatMessage({message}) {
    let className = message.sender === 'user' ?
            'chat-message chat-message-user' : 'chat-message chat-message-support';

    let senderName = message.sender === 'user' ? 'You' : 'Support';

    return (
      <div className={className}>
        <SupportChatAvatar width={25} height={25} />
        <div className="chat-bubble">
          <div class="name">{senderName}</div>
          <div className="chat-bubble-translation">
            <span className="chat-bubble-translated">
              {message.translatedContent}
            </span>
          </div>
          <div className="chat-bubble-message">
            <span className="chat-bubble-language">
              (en): {message.content}
            </span>
          </div>
        </div>
      </div>
    );
}