/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export default class AlignmentVerdict {
    constructor(
        readonly summaryId: string,
        readonly sequence: number,
        readonly statement: string,
        readonly verdict: string,
        readonly reason: string | null = null) {}
}
