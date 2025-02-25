/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {Component, EventEmitter, Inject, Input, OnInit, Output, PLATFORM_ID} from '@angular/core';
import {DOCUMENT, isPlatformBrowser} from '@angular/common';
import {RequirementStatus} from '../../enums/requirement-status.enum';
import {BaseComponent} from '../../components/base/base.component';
import {RequirementStatusInterface} from '../../interfaces/requirement-status.interface';
import {AvailabilityStatusEnum} from '../../enums/availability-status.enum';
import {LocaleEnum} from '../../enums/locale.enum';
import {FormControl} from '@angular/forms';
import {TaskStatus} from '../../enums/task-status.enum';
import {ActivatedRoute, Router} from '@angular/router';
import {RequirementInterface} from '../../interfaces/requirement.interface';
import {Title} from '@angular/platform-browser';
import {BasePageComponent} from '../../components/base/base-page.component';


@Component({
  selector: 'app-language-detector',
  templateUrl: './language-detector.component.html',
  standalone: false,
  styleUrl: './language-detector.component.scss'
})
export class LanguageDetectorComponent extends BasePageComponent implements OnInit {

  public apiFlag: RequirementInterface = {
    status: RequirementStatus.Pending,
    message: 'Pending',
    contentHtml: `Activate <span class="code">chrome://flags/#language-detection-api</span>`,
  }

  availabilityStatus: AvailabilityStatusEnum = AvailabilityStatusEnum.Unknown;

  error?: Error;

  outputCollapsed = true;

  output: string = "";

  detectionStatus = TaskStatus.Idle;

  availabilityTaskStatus = TaskStatus.Idle;

  // <editor-fold desc="Expected Input Languages">
  private _expectedInputLanguages: LocaleEnum[] | null = [];
  public expectedInputLanguagesFormControl: FormControl<LocaleEnum[] | null> = new FormControl<LocaleEnum[] | null>([]);

  get expectedInputLanguages(): LocaleEnum[] | null {
    return this._expectedInputLanguages;
  }

  @Input()
  set expectedInputLanguages(value: LocaleEnum[] | null) {
    this.setExpectedInputLanguages(value);
  }

  setExpectedInputLanguages(value: LocaleEnum[] | null, options?: {
    emitFormControlEvent?: boolean,
    emitChangeEvent?: boolean
  }) {
    this._expectedInputLanguages = value;
    this.expectedInputLanguagesFormControl.setValue(value, {emitEvent: options?.emitFormControlEvent ?? true});
    if (options?.emitChangeEvent ?? true) {
      this.expectedInputLanguagesChange.emit(value);
    }
  }

  @Output()
  expectedInputLanguagesChange = new EventEmitter<LocaleEnum[] | null>();

  // </editor-fold>

  // <editor-fold desc="Download Progress">
  private _loaded: number = 0;
  get loaded(): number {
    return this._loaded;
  }

  set loaded(value: number) {
    this._loaded = value;
    this.loadedChange.emit(value);
  }

  @Output()
  loadedChange = new EventEmitter<number>();
  // </editor-fold>

  inputFormControl = new FormControl<string>("");

  results: {
    confidence: number;
    detectedLanguage: string;
  }[] = []

  constructor(
    @Inject(PLATFORM_ID) private platformId: Object,
    @Inject(DOCUMENT) document: Document,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    title: Title,
  ) {
    super(document, title);
  }

  override ngOnInit() {
    super.ngOnInit();

    this.setTitle('Language Detector API | AI Playground');

    this.checkRequirements()

    this.subscriptions.push(this.route.queryParams.subscribe((params) => {
      if (params['input']) {
        this.inputFormControl.setValue(params['input']);
      }

      if(params['expectedInputLanguages']) {
        if(!Array.isArray(params['expectedInputLanguages'])) {
          this.expectedInputLanguages = [params['expectedInputLanguages']];
        } else {
          this.expectedInputLanguages = params['expectedInputLanguages'];
        }

      }

    }));

    this.subscriptions.push(this.inputFormControl.valueChanges.subscribe((value) => {
      this.router.navigate(['.'], { relativeTo: this.route, queryParams: { input: value}, queryParamsHandling: 'merge' });
    }))

    this.subscriptions.push(this.expectedInputLanguagesFormControl.valueChanges.subscribe((value) => {
      this.router.navigate(['.'], { relativeTo: this.route, queryParams: { expectedInputLanguages: value}, queryParamsHandling: 'merge' });
    }));
  }

  checkRequirements() {
    if (isPlatformBrowser(this.platformId) && this.window && !("ai" in this.window)) {
      this.apiFlag.status = RequirementStatus.Fail;
      this.apiFlag.message = "'window.ai' is not defined. Activate the flag.";
    } else if (isPlatformBrowser(this.platformId) && this.window && !("languageDetector" in this.window.ai)) {
      this.apiFlag.status = RequirementStatus.Fail;
      this.apiFlag.message = "'window.ai.languageDetector' is not defined. Activate the flag.";
    } else if(isPlatformBrowser(this.platformId)) {
      this.apiFlag.status = RequirementStatus.Pass;
      this.apiFlag.message = "Passed";
    }
  }

  getRequirements() {
    return [this.apiFlag];
  }

  get availabilityCode(): string {
//     return `window.ai.languageDetector.availability({
//   expectedInputLanguages: ${JSON.stringify(this.expectedInputLanguagesFormControl.value)},
// })`;

    return `const capabilities = await window.ai.languageDetector.capabilities({
  expectedInputLanguages: ${JSON.stringify(this.expectedInputLanguagesFormControl.value)},
});

const availabilityStatus = capabilities.available;`;
  }

  // todo: remove this.
  async checkAvailability() {
    try {
      this.availabilityTaskStatus = TaskStatus.Executing;
      const capabilities = await this.window?.ai.languageDetector.capabilities({
        expectedInputLanguages: this.expectedInputLanguagesFormControl.value,
      })

      this.availabilityStatus = capabilities.available;

      this.availabilityTaskStatus = TaskStatus.Completed;
    } catch (e: any) {
      this.error = e;
      this.availabilityStatus = AvailabilityStatusEnum.No;
      this.availabilityTaskStatus = TaskStatus.Error;
    }
  }

  async checkAvailabilityExplainer() {
    try {
      this.availabilityTaskStatus = TaskStatus.Executing;
      this.availabilityStatus = await this.window?.ai.languageDetector.availability({
        expectedInputLanguages: this.expectedInputLanguagesFormControl.value,
      })

      this.availabilityTaskStatus = TaskStatus.Completed;
    } catch (e: any) {
      this.error = e;
      this.availabilityStatus = AvailabilityStatusEnum.No;
      this.availabilityTaskStatus = TaskStatus.Error;
    }
  }

  get detectCode(): string {
    return `const detector = await window.ai.languageDetector.create({
  expectedInputLanguages: ${JSON.stringify(this.expectedInputLanguagesFormControl.value)},
  monitor(m: any)  {
    m.addEventListener("downloadprogress", (e: any) => {
      console.log(\`Downloaded \${e.loaded * 100}%\`);
    });
  },
  signal: abortController.signal,
});

const results = await detector.detect("${this.inputFormControl.value}", {
  signal: abortController.signal,
});
`;
  }

  async detect() {
    try {
      const self = this;
      this.outputCollapsed = false;
      this.detectionStatus = TaskStatus.Executing;
      this.error = undefined;

      const detector = await window.ai.languageDetector.create({
        expectedInputLanguages: this.expectedInputLanguagesFormControl.value,
        monitor(m: any) {
          m.addEventListener("downloadprogress", (e: any) => {
            self.loaded = e.loaded;
          });
        },
        //signal: abortController.signal,
      });

      this.results = await detector.detect(this.inputFormControl.value, {
        //signal: abortController.signal,
      });

      this.detectionStatus = TaskStatus.Completed;
    } catch (e: any) {
      this.error = e;
      this.detectionStatus = TaskStatus.Error;
    }
  }

  protected readonly AvailabilityStatusEnum = AvailabilityStatusEnum;
  protected readonly LocaleEnum = LocaleEnum;
}
