/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {Component, EventEmitter, Inject, Input, OnChanges, Output, SimpleChanges} from '@angular/core';
import {RouterOutlet} from "@angular/router";
import {TaskStatus} from '../../enums/task-status.enum';
import {FormControl, FormGroup} from '@angular/forms';
import {SearchSelectDropdownOptionsInterface} from '../../interfaces/search-select-dropdown-options.interface';
import {PromptInterface} from './prompt.interface';
import {BaseComponent} from '../base/base.component';
import {DOCUMENT} from '@angular/common';

@Component({
  selector: 'app-prompt',
  templateUrl: './prompt.component.html',
  standalone: false,
  styleUrl: './prompt.component.scss'
})
export class PromptComponent extends BaseComponent implements OnChanges {
  @Input()
  prompt?: PromptInterface<any>;

  @Input()
  roles: SearchSelectDropdownOptionsInterface[] = [];

  @Output()
  promptChange = new EventEmitter<PromptInterface<any>>();

  promptFormControl = new FormControl();
  roleFormControl = new FormControl();

  constructor(@Inject(DOCUMENT) document: Document,) {
    super(document);
  }

  override ngOnInit() {
    super.ngOnInit();

    this.subscriptions.push(this.promptFormControl.valueChanges.subscribe(value => {
      if(!this.prompt) {
        return;
      }

      this.prompt.content = value;
      this.promptChange.emit(this.prompt);
    }))

    this.subscriptions.push(this.roleFormControl.valueChanges.subscribe(value => {
      if(!this.prompt) {
        return;
      }

      this.prompt.role = value;
      this.promptChange.emit(this.prompt);
    }))
  }

  ngOnChanges(changes: SimpleChanges) {
    if(changes['prompt'] && this.prompt) {
      this.promptFormControl.setValue(this.prompt.content);
      this.roleFormControl.setValue(this.prompt.role);
    }
  }
}
