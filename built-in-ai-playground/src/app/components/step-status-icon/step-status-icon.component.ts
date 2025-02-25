/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {Component, Input} from '@angular/core';
import {RouterOutlet} from "@angular/router";
import {TaskStatus} from '../../enums/task-status.enum';

@Component({
  selector: 'app-step-status-icon',
  templateUrl: './step-status-icon.component.html',
  standalone: false,
  styleUrl: './step-status-icon.component.scss'
})
export class StepStatusIconComponent {
  @Input()
  status?: TaskStatus;
  protected readonly StepStatus = TaskStatus;
}
