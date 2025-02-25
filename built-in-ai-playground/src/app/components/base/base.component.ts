/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {Directive, OnDestroy, OnInit} from '@angular/core';
import {TaskStatus} from '../../enums/task-status.enum';
import {Subscription} from 'rxjs';
import {Environment} from '../../environments/environment';
import {EnvironmentNameEnum} from '../../enums/environment-name.enum';
import {Title} from '@angular/platform-browser';

@Directive()
export abstract class BaseComponent implements OnInit, OnDestroy {
  protected subscriptions: Subscription[] = [];

  protected window: Window | null;

  constructor(
    protected readonly document: Document,
    ) {
    this.window = this.document?.defaultView;
  }

  ngOnInit() {
  }

  ngOnDestroy() {
    this.subscriptions.forEach(subscription => subscription.unsubscribe());
  }

  public TaskStatus = TaskStatus;
}
