/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {Component, Input} from '@angular/core';
import {RequirementStatus} from '../../enums/requirement-status.enum';

@Component({
  selector: 'app-requirement',
  templateUrl: './requirement.component.html',
  standalone: false,
  styleUrl: './requirement.component.scss'
})
export class RequirementComponent {
  @Input()
  status?: RequirementStatus;

  @Input()
  message?: string;
  protected readonly RequirementStatus = RequirementStatus;
}
