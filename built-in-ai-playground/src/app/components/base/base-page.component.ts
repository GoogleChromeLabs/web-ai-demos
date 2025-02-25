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
import {BaseComponent} from './base.component';

@Directive()
export abstract class BasePageComponent extends BaseComponent implements OnInit, OnDestroy {
  constructor(
    document: Document,
    protected readonly titleService: Title,
    ) {
    super(document);
  }

  setTitle(title: string) {
    if(Environment.name === EnvironmentNameEnum.ChromeDev) {
      this.titleService.setTitle(title);
      return;
    }

    if(Environment.name === EnvironmentNameEnum.Development) {
      this.titleService.setTitle("[DEV] " + title + " | ai.etiennenoel.com");
      return;
    }

    this.titleService.setTitle(title + " | ai.etiennenoel.com");
  }
}
