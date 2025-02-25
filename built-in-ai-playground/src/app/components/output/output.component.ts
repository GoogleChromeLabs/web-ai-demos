/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges
} from '@angular/core';
import {TaskStatus} from '../../enums/task-status.enum';
import {ExecutionPerformanceResultInterface} from '../../interfaces/execution-performance-result.interface';
import {ToastStore} from '../../stores/toast.store';

@Component({
  selector: 'app-output',
  templateUrl: './output.component.html',
  standalone: false,
  styleUrl: './output.component.scss'
})
export class OutputComponent implements OnChanges, AfterViewInit {

  @Input()
  status: TaskStatus = TaskStatus.Idle;

  @Input()
  outputCollapsed: boolean = true;

  @Input()
  executionPerformanceResult?: ExecutionPerformanceResultInterface;

  @Input()
  downloadProgress: number = 0;

  @Input()
  output: string = "";

  @Input()
  outputChunks: string[] = [];

  @Input()
  error?: Error;

  @Output()
  abortExecution = new EventEmitter<void>();

  @Output()
  abortExecutionFromCreate = new EventEmitter<void>();

  showDownloadProgress: boolean = true;

  hasLoaded = false;

  constructor(
    private readonly toastStore: ToastStore,
    private elRef:ElementRef
    ) {
  }

  copyToClipboard(chunk: string) {
    navigator.clipboard.writeText(chunk)
    this.toastStore.publish({
      message: "Copied to clipboard",
    })
  }

  ngAfterViewInit() {
    this.hasLoaded = true;
  }

  ngOnChanges(changes: SimpleChanges) {
    if(this.hasLoaded && (changes["status"])) {
      // Scroll into view
      this.elRef.nativeElement.scrollIntoView({
        behavior: "smooth",
      });
    }
  }

  protected readonly TaskStatus = TaskStatus;
}
