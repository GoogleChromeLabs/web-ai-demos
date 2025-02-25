/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {TaskStatus} from '../../../enums/task-status.enum';

export interface Step0 {
  status: TaskStatus,
  available: string;
  outputCollapsed: boolean;
  log: string;
}
