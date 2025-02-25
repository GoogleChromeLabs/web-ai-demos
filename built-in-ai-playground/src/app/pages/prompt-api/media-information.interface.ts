/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
export interface MediaInformationInterface {
  type: "audio" | "image";

  content: Blob;

  filename: string;

  includeInPrompt: boolean;

  fileSystemFileHandle: FileSystemFileHandle;
}
