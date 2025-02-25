/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {Directive, HostBinding, Input} from '@angular/core';
import {TaskStatus} from '../enums/task-status.enum';

@Directive({
  selector: '[stepVisualStatus]',
  standalone: false,
})
export class StepContainerVisualStatusDirective {

  @Input()
  public status?: TaskStatus

  @HostBinding('style.borderLeftWidth')
  get border() {
    return `5px !important`;
  }

  @HostBinding('class')
  get getClass() {
    let classes = "border-start";

    switch (this.status) {
      case TaskStatus.Idle:
        classes += " border-dark-subtle"
        break;
      case TaskStatus.Executing:
        classes += " border-primary"
        break;
      case TaskStatus.Error:
        classes += " border-danger"
        break;
      case TaskStatus.Completed:
        classes += " border-success"
        break;
    }

    return classes;
  }
}
