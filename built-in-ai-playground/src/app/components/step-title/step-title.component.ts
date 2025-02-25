/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {Component, Input} from '@angular/core';
import {RouterOutlet} from "@angular/router";
import {TaskStatus} from '../../enums/task-status.enum';

@Component({
  selector: 'app-step-title',
  templateUrl: './step-title.component.html',
  standalone: false,
  styleUrl: './step-title.component.scss'
})
export class StepTitleComponent {
  @Input()
  status?: TaskStatus;

  @Input()
  title?: string;

  protected readonly StepStatus = TaskStatus;
}
