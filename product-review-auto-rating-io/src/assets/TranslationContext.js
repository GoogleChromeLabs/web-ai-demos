/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createContext } from 'preact';
import HybridTranslator from "../lib/HybridTranslator";

const SYSTEM_LANGUAGE = 'en';

class Translation {
	userTranslator;
	systemTranslator;

	constructor(userLanguage) {
		this.userTranslator = new HybridTranslator(userLanguage, SYSTEM_LANGUAGE);
		this.systemTranslator = new HybridTranslator(SYSTEM_LANGUAGE, userLanguage);
	}
}

const TranslationContext = createContext<Translation | null>(null);

export {Translation, TranslationContext};

