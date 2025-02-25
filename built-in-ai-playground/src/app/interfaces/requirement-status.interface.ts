/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {RequirementStatus} from '../enums/requirement-status.enum';

export interface RequirementStatusInterface {
  status: RequirementStatus;
  message: string;
}
