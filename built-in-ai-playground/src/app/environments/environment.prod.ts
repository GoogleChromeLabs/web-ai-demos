/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {EnvironmentInterface} from './environment.interface';
import {EnvironmentNameEnum} from '../enums/environment-name.enum';

export const Environment: EnvironmentInterface = {
  multimodal: true,

  name: EnvironmentNameEnum.Production,
}
