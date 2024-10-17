/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export default class Article {
    constructor(
        readonly id: string,
        readonly source: string,
        readonly text: string,
        readonly sourceId: string,
    ) { }
}

