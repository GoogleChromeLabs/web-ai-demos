/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {EnvironmentNameEnum} from '../enums/environment-name.enum';

export interface EnvironmentInterface {
  multimodal: boolean;

  name: EnvironmentNameEnum;
}
