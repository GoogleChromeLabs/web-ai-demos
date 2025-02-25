/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
export class TextUtils {
  static countWords(str: string) {
    // Trim leading and trailing whitespace
    str = str.trim();

    // If the string is empty, return 0
    if (str === "") {
      return 0;
    }

    // Split the string into an array of words
    const words = str.split(/\s+/);

    // Return the length of the array
    return words.length;
  }
}
