/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {Component, EventEmitter, Inject, OnDestroy, OnInit, Output, PLATFORM_ID} from '@angular/core';
import {FormControl} from "@angular/forms";
import {TaskStatus} from "../../enums/task-status.enum";
import {RequirementStatus} from "../../enums/requirement-status.enum";
import {languages} from "../../constants/languages.constants";
import {TranslatorApiVersionEnum} from "../../enums/translator-api-version.enum";

import {RequirementInterface} from "./interfaces/requirement.interface";
import {Step1} from "./interfaces/step-1.interface";
import {Step0} from "./interfaces/step-0.interface";
import {ActivatedRoute, Router} from '@angular/router';
import {Step2} from './interfaces/step-2.interface';
import {SearchSelectDropdownOptionsInterface} from '../../interfaces/search-select-dropdown-options.interface';
import {Title} from '@angular/platform-browser';
import {BasePageComponent} from '../../components/base/base-page.component';
import {DOCUMENT, isPlatformBrowser} from '@angular/common';
import {AvailabilityStatusEnum} from '../../enums/availability-status.enum';

@Component({
  selector: 'app-translator-api',
  templateUrl: './translator-api.component.html',
  standalone: false,
  styleUrl: './translator-api.component.scss'
})
export class TranslatorApiComponent extends BasePageComponent implements OnInit, OnDestroy {
  languages = languages;
  languageOptions: SearchSelectDropdownOptionsInterface[] = this.languages.map((language) => {
    return {label: language.title, value: language.locale}
  })

  sourceLanguage= new FormControl("en");
  targetLanguage = new FormControl('fr');
  content = new FormControl('');

  public outputCollapsed = true;

  public availabilityStatus: AvailabilityStatusEnum = AvailabilityStatusEnum.Unknown;

  public error?: Error;

  public availabilityError?: Error;

  // <editor-fold desc="Output">
  private _output: string = "";
  get output(): string {
    return this._output;
  }

  set output(value: string) {
    this._output = value;
    this.outputChange.emit(value);
  }

  @Output()
  outputChange = new EventEmitter<string>();

  @Output()
  outputChunksChange = new EventEmitter<string[]>();
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

  // <editor-fold desc="Task Status">
  private _status: TaskStatus = TaskStatus.Idle;

  get status(): TaskStatus {
    return this._status;
  }

  set status(value: TaskStatus) {
    this._status = value;
    this.statusChange.emit(value);
  }

  @Output()
  public statusChange = new EventEmitter<TaskStatus>();
  // </editor-fold>

  requirements: RequirementInterface = {
    translationApiFlag: {
        status: RequirementStatus.Pending,
      message: "Checking",
      contentHtml: `Activate <span class="code">chrome://flags/#translation-api</span>`,
    }
  }

  allRequirementsStatus: RequirementStatus = RequirementStatus.Pending;

  steps!: {
    step0: Step0,
    step1: Step1,
    step2: Step2,
  };

  protected readonly StepStatus = TaskStatus;

  constructor(
      private readonly router: Router,
      private route: ActivatedRoute,
      @Inject(DOCUMENT) document: Document,
      @Inject(PLATFORM_ID) private platformId: Object,
      title: Title,
      ) {
    super(document, title)
  }


  override ngOnInit() {
    super.ngOnInit();

    this.setTitle('Translator API | AI Playground');

    this.subscriptions.push(this.route.queryParams.subscribe((params) => {
      if(params['sourceLanguage']) {
        this.sourceLanguage.setValue(params['sourceLanguage']);
      }
      if(params['targetLanguage']) {
        this.targetLanguage.setValue(params['targetLanguage']);
      }
      if(params['content']) {
        this.content.setValue(params['content']);
      }
    }));

    this.subscriptions.push(this.sourceLanguage.valueChanges.subscribe((value) => {
      this.router.navigate(['.'], { relativeTo: this.route, queryParams: { sourceLanguage: value}, queryParamsHandling: 'merge' });
    }));

    this.subscriptions.push(this.targetLanguage.valueChanges.subscribe((value) => {
      this.router.navigate(['.'], { relativeTo: this.route, queryParams: { targetLanguage: value}, queryParamsHandling: 'merge' });
    }));

    this.subscriptions.push(this.content.valueChanges.subscribe((value) => {
      this.router.navigate(['.'], { relativeTo: this.route, queryParams: { content: value}, queryParamsHandling: 'merge' });
    }));

    this.reset();
  }

  getAllRequirements() {
    return [this.requirements.translationApiFlag];
  }

  reset() {
    this.steps = {
      step0: {
        status: TaskStatus.Idle,
        available: "",
        outputCollapsed: true,
        log: "",
      },
      step1: {
        status: TaskStatus.Idle,
        totalBytes: 0,
        bytesDownloaded: 0,
        outputCollapsed: true,
        log: "",
      },
      step2: {
        status: TaskStatus.Idle,
        translatedContent: "",
        outputCollapsed: true,
        log: "",
        sourceLanguage: "",
        targetLanguage: "",
        content: "",
      }
    }

    this.checkRequirements()
  }

  checkRequirements() {
    // Check if the translation API flag is enabled
    if (isPlatformBrowser(this.platformId) && !("ai" in window)) {
      this.requirements.translationApiFlag.status = RequirementStatus.Fail;
      this.requirements.translationApiFlag.message = "'window.ai' is not defined. Activate the flag.";
    }
    // @ts-ignore
    else if (isPlatformBrowser(this.platformId) && !("translator" in window.ai)) {
      this.requirements.translationApiFlag.status = RequirementStatus.Fail;
      this.requirements.translationApiFlag.message = "'window.ai.translator' is not defined. Activate the flag.";
    } else if(isPlatformBrowser(this.platformId)) {
      this.requirements.translationApiFlag.status = RequirementStatus.Pass;
      this.requirements.translationApiFlag.message = "Passed";
    } else {
      this.requirements.translationApiFlag.status = RequirementStatus.Pending;
      this.requirements.translationApiFlag.message = "Checking";
    }

    this.allRequirementsStatus = this.requirements.translationApiFlag.status;
  }

  get checkAvailabilityCode(){
    return `const translatorCapabilities = await window.ai.translator.capabilities();
const availability = translatorCapabilities.languagePairAvailable("${this.sourceLanguage.value}", "${this.targetLanguage.value}");
console.log(Result of availability: '\${availability}'.);`;
  }

  async checkAvailability() {
    const translatorCapabilities = await window.ai.translator.capabilities();

    this.availabilityStatus = await translatorCapabilities.languagePairAvailable(this.sourceLanguage.value, this.targetLanguage.value);
  }

  get translateCode() {
    return `const translator = await ai.translator.create({
    sourceLanguage: "${this.sourceLanguage.value}",
    targetLanguage: "${this.targetLanguage.value}",
    monitor(m) {
        m.addEventListener("downloadprogress", e => {
            console.log(\`Downloaded \${e.loaded} of \${e.total} bytes.\`);
        });
    },
});
await translator.translate("${this.content.value}")
`;
  }

  async translate() {
    try {
      this.status = TaskStatus.Executing;
      this.outputCollapsed = false;
      this.error = undefined;
      this.output = "";
      this.loaded = 0;

      const translator = await window.ai.translator.create({
        sourceLanguage: this.sourceLanguage.value,
        targetLanguage: this.targetLanguage.value,
        monitor(m: any) {
          m.addEventListener("downloadprogress", (e: any) => {
            this.loaded = e.loaded;
          });
        },
      });

      this.output = await translator.translate(this.content.value);

      this.status = TaskStatus.Completed;
    } catch (e: any) {
      this.status = TaskStatus.Error;
      this.error = e;
    }
  }

  protected readonly RequirementStatus = RequirementStatus;
  protected readonly TranslatorApiVersionEnum = TranslatorApiVersionEnum;
  protected readonly AvailabilityStatusEnum = AvailabilityStatusEnum;
}
