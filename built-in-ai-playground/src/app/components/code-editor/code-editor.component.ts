/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {AfterViewInit, Component, ElementRef, Inject, Input, PLATFORM_ID, ViewChild} from '@angular/core';
import {RouterOutlet} from "@angular/router";
import {TaskStatus} from '../../enums/task-status.enum';

import {isPlatformBrowser, isPlatformServer} from '@angular/common';

@Component({
  selector: 'code-editor',
  templateUrl: './code-editor.component.html',
  standalone: false,
  styleUrl: './code-editor.component.scss'
})
export class CodeEditorComponent implements AfterViewInit {
  @ViewChild("editor")
  private editorElement?: ElementRef<HTMLElement>;

  editor: any;

  private _code: string = "";

  get code(): string {
    return this._code;
  }

  @Input()
  set code(value: string) {
    this._code = value;

    if(!this.editor) {
      return;
    }

    this.editor.setValue(value, -1);
  }

  @Input()
  readonly = false;

  @Input()
  height: string = "250px"

  constructor(@Inject(PLATFORM_ID) private readonly platformId: Object) {
  }

  ngAfterViewInit(): void {
    if (!this.editorElement || isPlatformServer(this.platformId)) {
      return;
    }

    // @ts-ignore
    this.editor = ace.edit(this.editorElement.nativeElement, {
      mode: "ace/mode/javascript",
      selectionStyle: "text",
      useWorker: false,
    });

    this.editor.setReadOnly(this.readonly)
    //editor.setTheme("ace/theme/github");
    this.editor.setShowPrintMargin(false);
    this.editor.setHighlightActiveLine(false);

    //ace.config.set("", "14px");
    //const aceEditor = ace.edit(this.editor.nativeElement);
    //aceEditor.session.setValue(this.code);
  }
}
