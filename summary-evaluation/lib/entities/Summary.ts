/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export default class Summary {
    constructor(
        readonly id: string,
        readonly model: string,
        readonly article_id: string,
        readonly text: string,
    ) {}
}
