/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {Component, Inject, Input, OnInit} from '@angular/core';
import {RouterOutlet} from "@angular/router";
import {TaskStatus} from '../../enums/task-status.enum';
import {BaseComponent} from '../base/base.component';
import {ToastStore} from '../../stores/toast.store';
import {DOCUMENT} from '@angular/common';
import {ToastMessageInterface} from '../../interfaces/toast-message.interface';
import {delay, pipe} from 'rxjs';

@Component({
  selector: 'app-toast',
  templateUrl: './toast.component.html',
  standalone: false,
  styleUrl: './toast.component.scss'
})
export class ToastComponent extends BaseComponent implements OnInit {

  message: ToastMessageInterface | null = null;

  constructor(
    private readonly toastStore: ToastStore,
    @Inject(DOCUMENT) document: Document,
  ) {
    super(document);
  }

  override ngOnInit() {
    super.ngOnInit();

    this.subscriptions.push(this.toastStore.messages.subscribe(
      pipe(
        (message) => {
          this.message = message;
        },
        (message) => {
          setTimeout(() => {
            this.message = null;
          }, 5000)
        }
        )
    ));
  }
}
