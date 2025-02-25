/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {Inject} from '@angular/core';
import {ToastMessageInterface} from '../interfaces/toast-message.interface';
import {BehaviorSubject, Subject} from 'rxjs';

@Inject({
  providedIn: 'root'
})
export class ToastStore {
  messages = new Subject<ToastMessageInterface>();

  subscribe = this.messages.subscribe;

  publish(message: ToastMessageInterface) {
    this.messages.next(message);
  }


}
