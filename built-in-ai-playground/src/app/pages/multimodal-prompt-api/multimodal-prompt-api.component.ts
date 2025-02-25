/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {Component, EventEmitter, Inject, Input, OnInit, Output, PLATFORM_ID} from '@angular/core';
import {ActivatedRoute, Router, RouterOutlet} from "@angular/router";
import {TaskStatus} from '../../enums/task-status.enum';
import {RequirementInterface} from '../../interfaces/requirement.interface';
import {DOCUMENT, isPlatformBrowser} from '@angular/common';
import {Title} from '@angular/platform-browser';
import {BaseComponent} from '../../components/base/base.component';
import {RequirementStatus} from '../../enums/requirement-status.enum';
import {MediaInformationInterface} from '../prompt-api/media-information.interface';
import {CdkDragDrop, moveItemInArray} from '@angular/cdk/drag-drop';
import {FormControl} from '@angular/forms';
import {AvailabilityStatusEnum} from '../../enums/availability-status.enum';
import {BasePageComponent} from '../../components/base/base-page.component';

@Component({
  selector: 'app-multimodal-prompt-api',
  templateUrl: './multimodal-prompt-api.component.html',
  standalone: false,
  styleUrl: './multimodal-prompt-api.component.scss'
})
export class MultimodalPromptApiComponent extends BasePageComponent implements OnInit {
  medias: MediaInformationInterface[] = [];

  media?: MediaInformationInterface;

  error?: Error;

  public availabilityError?: Error;

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

  // <editor-fold desc="Prompt">
  private _prompt: string | null = "Describe this image";
  public promptFormControl: FormControl<string | null> = new FormControl<string | null>("Describe this image");

  get prompt(): string | null {
    return this._prompt;
  }

  set prompt(value: string | null) {
    this.setPrompt(value);
  }

  setPrompt(value: string | null, options?: {emitFormControlEvent?: boolean, emitChangeEvent?: boolean}) {
    this._prompt = value;
    this.promptFormControl.setValue(value, {emitEvent: options?.emitFormControlEvent ?? true});
    if(options?.emitChangeEvent ?? true) {
      this.promptChange.emit(value);
    }
    this.router.navigate(['.'], { relativeTo: this.route, queryParams: { prompt: value}, queryParamsHandling: 'merge' });
  }

  @Output()
  public promptChange = new EventEmitter<string | null>();
  // </editor-fold>

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

  public outputCollapsed = true;


  constructor(
    @Inject(PLATFORM_ID) private platformId: Object,
    @Inject(DOCUMENT) document: Document,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    title: Title,
  ) {
    super(document, title);
  }

  public apiFlag: RequirementInterface = {
    status: RequirementStatus.Pending,
    message: 'Pending',
    contentHtml: 'Activate <span class="code">chrome://flags/#prompt-api-for-gemini-nano-multimodal-input</span>'
  }

  override ngOnInit() {
    super.ngOnInit();

    this.setTitle("Multimodal Prompt API (Experimental) | AI Playground")

    this.subscriptions.push(this.route.queryParams.subscribe((params) => {
      if (params['prompt']) {
        this.promptFormControl.setValue(params['prompt']);
      }
    }));

    this.subscriptions.push(this.promptFormControl.valueChanges.subscribe((value) => {
      this.setPrompt(value, {emitChangeEvent: true, emitFormControlEvent: false});

    }));

    this.checkRequirements()
  }

  checkRequirements() {
    if (isPlatformBrowser(this.platformId) && this.window && !("ai" in this.window)) {
      this.apiFlag.status = RequirementStatus.Fail;
      this.apiFlag.message = "'window.ai' is not defined. Activate the flag.";
    } else if (isPlatformBrowser(this.platformId) && this.window && !("languageModel" in this.window.ai)) {
      this.apiFlag.status = RequirementStatus.Fail;
      this.apiFlag.message = "'window.ai.languageModel' is not defined. Activate the flag.";
    } else if(isPlatformBrowser(this.platformId)) {
      this.apiFlag.status = RequirementStatus.Pass;
      this.apiFlag.message = "Passed";
    }
  }

  drop(event: CdkDragDrop<any[]>) {
    // Update your data based on the drop event
    moveItemInArray(this.medias, event.previousIndex, event.currentIndex);
  }

  deleteMedia(index: number) {
    this.medias.splice(index, 1);
  }

  getImageSrc(media: MediaInformationInterface) {
    return URL.createObjectURL(media.content);
  }

  getAudioSrc(media: MediaInformationInterface) {
    return URL.createObjectURL(media.content);
  }

  onFileSystemHandlesDropped(fileSystemHandles: FileSystemHandle[]) {
    fileSystemHandles.forEach(async (fileSystemHandle) => {
      if (fileSystemHandle.kind === "directory") {
        return;
      }

      const fileSystemFileHandle = fileSystemHandle as FileSystemFileHandle;
      const file = await fileSystemFileHandle.getFile()

      if (file.type.startsWith("image")) {
        const media: MediaInformationInterface = {
          type: 'image',
          content: file,
          filename: file.name,
          includeInPrompt: true,
          fileSystemFileHandle,
        };

        this.media = media;
        this.medias.push(media);
      } else if (file.type.startsWith("audio")) {
        const media: MediaInformationInterface = {
          type: 'audio',
          content: file,
          filename: file.name,
          includeInPrompt: true,
          fileSystemFileHandle,
        };

        this.media = media;
        this.medias.push(media);
      } else {
        this.error = new Error(`Unsupported file type '${file.type}' for '${file.name}'.`);
      }
    })
  }

  availabilityStatus: AvailabilityStatusEnum = AvailabilityStatusEnum.Unknown;

  get checkAvailabilityCode(): string {
    return `window.ai.languageModel.availability({
})`
  }

  async checkAvailability() {
    try {
      this.availabilityStatus = await window.ai.languageModel.availability({})
    } catch (e: any) {
      this.availabilityStatus = AvailabilityStatusEnum.Unknown
      this.error = e;
    }
  }

  get executeCode(): string {
    return `const languageModel = await window.ai.languageModel.create();

const output = await languageModel.prompt([
  "${this.promptFormControl.value ?? ""}",
  {
    type: "${this.media?.type}",
    content: createImageBitmap(fileSystemFileHandle.getFile()),
  }
]);`;
  }

  async getMedia(): Promise<HTMLImageElement | HTMLAudioElement | ImageBitmap> {
    if(!this.media) {
      throw new Error("No media provided.")
    }

    switch (this.media.type) {
      case 'image':
        return createImageBitmap(this.media.content);

      case 'audio':
        const audio = new Audio();
        audio.src = URL.createObjectURL(this.media.content);
        return audio;
    }

    throw new Error(`Unsupported media type: '${this.media.type}'.`);
  }


  async execute() {
    try {
      this.status = TaskStatus.Executing;
      this.outputCollapsed = false;
      this.output = "";
      this.loaded = 0;

      if(!this.media) {
        throw new Error("No media provided.")
      }

      const languageModel = await this.window?.ai.languageModel.create();

      const media = await this.getMedia();

      this.output = await languageModel.prompt([
        this.promptFormControl.value,
        {
          type: this.media.type,
          content: media,
        }
      ]);
    } catch (e: any) {
      this.status = TaskStatus.Error;
      this.error = e;
    }
  }

  protected readonly AvailabilityStatusEnum = AvailabilityStatusEnum;
}
