/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {Component, EventEmitter, Inject, Input, OnInit, Output, PLATFORM_ID} from '@angular/core';
import {TaskStatus} from '../../enums/task-status.enum';
import {RequirementStatus} from '../../enums/requirement-status.enum';
import {DOCUMENT, isPlatformBrowser} from '@angular/common';
import {FormControl} from '@angular/forms';
import {BaseWritingAssistanceApiComponent} from '../../components/base-writing-assistance-api/base-writing-assistance-api.component';
import {TextUtils} from '../../utils/text.utils';
import {AvailabilityStatusEnum} from '../../enums/availability-status.enum';
import {SearchSelectDropdownOptionsInterface} from '../../interfaces/search-select-dropdown-options.interface';
import {LocaleEnum} from '../../enums/locale.enum';
import {RewriterLengthEnum} from '../../enums/rewriter-length.enum';
import {RewriterFormatEnum} from '../../enums/rewriter-format.enum';
import {RewriterToneEnum} from '../../enums/rewriter-tone.enum';
import {ActivatedRoute, Router} from '@angular/router';
import {RequirementInterface} from '../../interfaces/requirement.interface';
import {Title} from '@angular/platform-browser';


@Component({
  selector: 'app-rewriter',
  templateUrl: './rewriter-api.component.html',
  standalone: false,
  styleUrl: './rewriter-api.component.scss'
})
export class RewriterApiComponent extends BaseWritingAssistanceApiComponent implements OnInit {

  // <editor-fold desc="Tone">
  private _tone: RewriterToneEnum | null = RewriterToneEnum.AsIs;
  public toneFormControl: FormControl<RewriterToneEnum | null> = new FormControl<RewriterToneEnum | null>(RewriterToneEnum.AsIs);

  get tone(): RewriterToneEnum | null {
    return this._tone;
  }

  @Input()
  set tone(value: RewriterToneEnum | null) {
   this.setTone(value);
  }

  setTone(value: RewriterToneEnum | null, options?: {emitFormControlEvent?: boolean, emitChangeEvent?: boolean}) {
    this._tone = value;
    this.toneFormControl.setValue(value, {emitEvent: options?.emitFormControlEvent ?? true});
    if(options?.emitChangeEvent ?? true) {
      this.toneChange.emit(value);
    }
    this.router.navigate(['.'], { relativeTo: this.route, queryParams: { rewriterTone: value}, queryParamsHandling: 'merge' });
  }

  @Output()
  toneChange = new EventEmitter<RewriterToneEnum | null>();
  // </editor-fold>

  // <editor-fold desc="Format">
  private _format: RewriterFormatEnum | null = RewriterFormatEnum.PlainText;
  public formatFormControl: FormControl<RewriterFormatEnum | null> = new FormControl<RewriterFormatEnum | null>(RewriterFormatEnum.PlainText);

  get format(): RewriterFormatEnum | null {
    return this._format;
  }

  @Input()
  set format(value: RewriterFormatEnum | null) {
    this.setFormat(value);
  }

  setFormat(value: RewriterFormatEnum | null, options?: {emitFormControlEvent?: boolean, emitChangeEvent?: boolean}) {
    this._format = value;
    this.formatFormControl.setValue(value, {emitEvent: options?.emitFormControlEvent ?? true});
    if(options?.emitChangeEvent ?? true) {
      this.formatChange.emit(value);
    }
    this.router.navigate(['.'], { relativeTo: this.route, queryParams: { rewriterFormat: value}, queryParamsHandling: 'merge' });
  }

  @Output()
  formatChange = new EventEmitter<RewriterFormatEnum | null>();
  // </editor-fold>

  // <editor-fold desc="Length">
  private _length: RewriterLengthEnum | null = RewriterLengthEnum.AsIs;
  public lengthFormControl: FormControl<RewriterLengthEnum | null> = new FormControl<RewriterLengthEnum | null>(RewriterLengthEnum.AsIs);

  get length(): RewriterLengthEnum | null {
    return this._length;
  }

  @Input()
  set length(value: RewriterLengthEnum | null) {
    this.setLength(value);
  }

  setLength(value: RewriterLengthEnum | null, options?: {emitFormControlEvent?: boolean, emitChangeEvent?: boolean}) {
    this._length = value;
    this.lengthFormControl.setValue(value, {emitEvent: options?.emitFormControlEvent ?? true});
    if(options?.emitChangeEvent ?? true) {
      this.lengthChange.emit(value);
    }
    this.router.navigate(['.'], { relativeTo: this.route, queryParams: { rewriterLength: value}, queryParamsHandling: 'merge' });
  }

  @Output()
  lengthChange = new EventEmitter<RewriterLengthEnum | null>();
  // </editor-fold>

  protected outputStatusMessage: string = "";
  apiFlagContentHtml = `Activate <span class="code">chrome://flags/#rewriter-api-for-gemini-nano</span>`;
  getRequirement(): RequirementInterface {
    return {
      ...this.apiFlag,
      contentHtml: this.apiFlagContentHtml,
    }
  }

  get checkAvailabilityCode() {
    return `window.ai.rewriter.availability({
  tone: '${this.toneFormControl.value}',
  format: '${this.formatFormControl.value}',
  length: '${this.lengthFormControl.value}',
  expectedInputLanguages: ${JSON.stringify(this.expectedInputLanguagesFormControl.value)},
  expectedContextLanguages: ${JSON.stringify(this.expectedContextLanguagesFormControl.value)},
  outputLanguage: '${this.outputLanguageFormControl.value}',
})`
  }

  get rewriteCode() {
    if(this.useStreamingFormControl.value) {
      return `const abortController = new AbortController();

const rewriter = await window.ai.rewriter.create({
  tone: '${this.toneFormControl.value}',
  format: '${this.formatFormControl.value}',
  length: '${this.lengthFormControl.value}',
  sharedContext: '${this.sharedContext}',
  expectedInputLanguages: ${JSON.stringify(this.expectedInputLanguagesFormControl.value)},
  expectedContextLanguages: ${JSON.stringify(this.expectedContextLanguagesFormControl.value)},
  outputLanguage: '${this.outputLanguageFormControl.value}',
  monitor(m: any)  {
    m.addEventListener("downloadprogress", (e: any) => {
      console.log(\`Downloaded \${e.loaded * 100}%\`);
    });
  },
  signal: abortController.signal,
})

const stream: ReadableStream = rewriter.rewriteStreaming('${this.input}', {context: '${this.contextFormControl.value}'});

for await (const chunk of stream) {
  // Do something with each 'chunk'
  this.rewriterOutput += chunk;
}`;
    } else {
      return `const abortController = new AbortController();

const rewriter = await window.ai.rewriter.create({
  tone: '${this.toneFormControl.value}',
  format: '${this.formatFormControl.value}',
  length: '${this.lengthFormControl.value}',
  sharedContext: '${this.sharedContext}',
  expectedInputLanguages: ${JSON.stringify(this.expectedInputLanguagesFormControl.value)},
  expectedContextLanguages: ${JSON.stringify(this.expectedContextLanguagesFormControl.value)},
  outputLanguage: '${this.outputLanguageFormControl.value}',
  monitor(m: any)  {
    m.addEventListener("downloadprogress", (e: any) => {
      console.log(\`Downloaded \${e.loaded * 100}%\`);
    });
  },
  signal: abortController.signal,
})

await rewriter.rewrite('${this.input}', {context: '${this.contextFormControl.value}'})`;
    }
  }

  constructor(
    @Inject(PLATFORM_ID) private platformId: Object,
    @Inject(DOCUMENT) document: Document,
    router: Router,
    route: ActivatedRoute,
    title: Title,
  ) {
    super(document, router, route, title);
  }


  override ngOnInit() {
    super.ngOnInit();

    this.checkRequirements()

    this.subscriptions.push(this.route.queryParams.subscribe((params) => {
      if (params['rewriterTone']) {
        this.toneFormControl.setValue(params['rewriterTone']);
      }

      if (params['rewriterFormat']) {
        this.formatFormControl.setValue(params['rewriterFormat']);
      }

      if (params['rewriterLength']) {
        this.lengthFormControl.setValue(params['rewriterLength']);
      }
    }));


    // Register form changes events
    this.subscriptions.push(this.toneFormControl.valueChanges.subscribe((value) => {
      this.setTone(value, {emitChangeEvent: true, emitFormControlEvent: false});
    }));
    this.subscriptions.push(this.formatFormControl.valueChanges.subscribe((value) => {
      this.setFormat(value, {emitChangeEvent: true, emitFormControlEvent: false});
    }));
    this.subscriptions.push(this.lengthFormControl.valueChanges.subscribe((value) => {
      this.setLength(value);
    }));
  }

  checkRequirements() {
    // @ts-ignore
    if (isPlatformBrowser(this.platformId) && !("ai" in this.window)) {
      this.apiFlag.status = RequirementStatus.Fail;
      this.apiFlag.message = "'window.ai' is not defined. Activate the flag.";
    }
    // @ts-ignore
    else if (isPlatformBrowser(this.platformId) && !("rewriter" in this.window.ai)) {
      this.apiFlag.status = RequirementStatus.Fail;
      this.apiFlag.message = "'window.ai.rewriter' is not defined. Activate the flag.";
    }
    else if(isPlatformBrowser(this.platformId)) {
      this.apiFlag.status = RequirementStatus.Pass;
      this.apiFlag.message = "Passed";
    }
  }

  async checkAvailability() {
    try {
      // @ts-ignore
      this.availabilityStatus = await this.window.ai.rewriter.availability({
        tone: this.toneFormControl.value,
        format: this.formatFormControl.value,
        length: this.lengthFormControl.value,
        expectedInputLanguages: this.expectedInputLanguagesFormControl.value,
        expectedContextLanguages: this.expectedContextLanguagesFormControl.value,
        outputLanguage: this.outputLanguageFormControl.value
      })
    } catch (e: any) {
      this.availabilityStatus = AvailabilityStatusEnum.Unknown
      this.availabilityError = e;
      this.errorChange.emit(e);
    }
  }

  async rewrite() {
    this.status = TaskStatus.Executing;
    this.outputCollapsed = false;
    this.outputStatusMessage = "Preparing and downloading model...";
    this.outputChunks = [];
    this.outputChunksChange.emit(this.outputChunks);
    this.output = "";
    this.error = undefined;
    this.outputStatusMessage = "Running query...";
    this.loaded = 0;

    try {
      this.abortControllerFromCreate  = new AbortController();
      this.abortController = new AbortController();

      // @ts-ignore
      const rewriter = await this.window.ai.rewriter.create({
        tone: this.toneFormControl.value,
        format: this.formatFormControl.value,
        length: this.lengthFormControl.value,
        sharedContext: this.sharedContext,
        expectedInputLanguages: this.expectedInputLanguagesFormControl.value,
        expectedContextLanguages: this.expectedContextLanguagesFormControl.value,
        outputLanguage: this.outputLanguageFormControl.value,
        monitor(m: any)  {
          m.addEventListener("downloadprogress", (e: any) => {
            console.log(`Downloaded ${e.loaded * 100}%`);
            this.loaded = e.loaded;
          });
        },
        signal: this.abortControllerFromCreate.signal,
      });

      this.startExecutionTime();

      this.executionPerformance.firstResponseNumberOfWords = 0;
      this.executionPerformance.totalNumberOfWords = 0;
      this.emitExecutionPerformanceChange();

      if(this.useStreamingFormControl.value) {
        const stream: ReadableStream = rewriter.rewriteStreaming(this.input, {context: this.contextFormControl.value, signal: this.abortController.signal});

        let hasFirstResponse = false;

        for await (const chunk of stream) {
          if(!hasFirstResponse) {
            hasFirstResponse = true;
            this.lapFirstResponseTime();
          }

          if(this.executionPerformance.firstResponseNumberOfWords == 0) {
            this.executionPerformance.firstResponseNumberOfWords = TextUtils.countWords(chunk);
          }
          this.executionPerformance.totalNumberOfWords += TextUtils.countWords(chunk);

          this.emitExecutionPerformanceChange();

          // Do something with each 'chunk'
          this.output += chunk;
          this.outputChunks.push(chunk);
          this.outputChunksChange.emit(this.outputChunks);
        }

      }
      else {
        const output = await rewriter.rewrite(this.input, {context: this.contextFormControl.value, signal: this.abortController.signal});
        this.executionPerformance.totalNumberOfWords = TextUtils.countWords(output);
        this.emitExecutionPerformanceChange();

        this.output = output;
      }

      this.status = TaskStatus.Completed;
    } catch (e: any) {
      this.status = TaskStatus.Error;
      this.outputStatusMessage = `Error: ${e}`;
      this.errorChange.emit(e);
      this.error = e;
    } finally {
      this.stopExecutionTime();
    }

  }

  RewriterToneEnum = RewriterToneEnum;
  RewriterFormatEnum = RewriterFormatEnum;
  RewriterLengthEnum = RewriterLengthEnum;
  protected readonly LocaleEnum = LocaleEnum;
}
