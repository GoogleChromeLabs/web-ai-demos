/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  SearchSelectDropdownOptionsInterface
} from '../interfaces/search-select-dropdown-options.interface';

export class EnumToSearchSelectDropdownOptionsMapper {
  static map(enumType: any): SearchSelectDropdownOptionsInterface[] {
    return Object.entries(enumType).map(([key, value]) => ({
      label: key,
      value: value
    } as SearchSelectDropdownOptionsInterface));
  }
}
