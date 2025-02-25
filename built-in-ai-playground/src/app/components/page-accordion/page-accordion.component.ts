/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {Component, EventEmitter, Inject, Input, OnChanges, Output, PLATFORM_ID, SimpleChanges} from '@angular/core';
import {TaskStatus} from '../../enums/task-status.enum';
import {RequirementStatus} from '../../enums/requirement-status.enum';
import {RequirementInterface} from '../../interfaces/requirement.interface';
import {isPlatformBrowser} from '@angular/common';
@Component({
  selector: 'app-page-accordion',
  templateUrl: './page-accordion.component.html',
  standalone: false,
  styleUrl: './page-accordion.component.scss'
})
export class PageAccordionComponent {
  @Input()
  requirementsStatus: RequirementStatus = RequirementStatus.Pending;

  @Input()
  requirements: RequirementInterface[] = [];

  @Output()
  checkRequirementsEvent = new EventEmitter<void>();


  constructor(
    @Inject(PLATFORM_ID) private platformId: Object,
  ) {
  }

  checkRequirements() {
    this.checkRequirementsEvent.emit();
  }

  isPlatformBrowser() {
    return isPlatformBrowser(this.platformId);;
  }

  protected readonly RequirementStatus = RequirementStatus;
  protected readonly TaskStatus = TaskStatus;
}
