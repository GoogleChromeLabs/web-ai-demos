/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import './SupportChatMessages.css';
import SupportChatMessage from "./SupportChatMessage";

export default function SupportChatMessages({messages}) {
    return (
		<div id="messages" className="chat-contents">
			{messages.map((message, i) => (
				<SupportChatMessage key={i} message={message} />
			))}
		</div>        
    )
}
