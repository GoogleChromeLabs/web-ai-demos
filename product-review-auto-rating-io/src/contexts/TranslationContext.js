/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createContext } from "preact";
import HybridTranslator from "../lib/HybridTranslator";

const SYSTEM_LANGUAGE = 'en';

class Translation {
	constructor(userLanguage, { onStatus } = {}) {
		this.systemTranslator = new HybridTranslator(SYSTEM_LANGUAGE, userLanguage, { onStatus });
		// Created once the first is done, because creating a translator uses up the user
		// activation that a download needs, so each download needs an interaction of its own.
		this.userTranslator = new HybridTranslator(userLanguage, SYSTEM_LANGUAGE, {
			onStatus,
			after: this.systemTranslator.onDeviceTranslator,
		});
	}
}
const TranslationContext = createContext(null);

export {Translation, TranslationContext};
