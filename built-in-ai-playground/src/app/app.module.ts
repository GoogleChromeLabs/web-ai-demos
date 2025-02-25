/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {NgModule} from '@angular/core';
import {BrowserModule, provideClientHydration, withEventReplay} from '@angular/platform-browser';

import {AppRoutingModule} from './app-routing.module';
import {RootComponent} from './components/root/root.component';
import {TranslatorApiComponent} from './pages/translator-api/translator-api.component';
import {FormsModule, ReactiveFormsModule} from '@angular/forms';
import {StepStatusIconComponent} from "./components/step-status-icon/step-status-icon.component";
import {StepTitleComponent} from "./components/step-title/step-title.component";
import {StepContainerVisualStatusDirective} from "./directives/step-container-visual-status.directive";
import {SearchSelectDropdownComponent} from './components/search-select-dropdown/search-select-dropdown.component';
import {EnumToSearchSelectDropdownOptionsPipe} from './pipes/enum-to-search-select-dropdown-options.pipe';
import {WriterApiComponent} from './pages/writer-api/writer-api.component';
import {CodeEditorComponent} from './components/code-editor/code-editor.component';
import {
  SearchSelectMultipleDropdownComponent
} from './components/search-select-multiple-dropdown/search-select-multiple-dropdown.component';
import {ToastStore} from './stores/toast.store';
import {ToastComponent} from './components/toast/toast.component';
import {RewriterApiComponent} from './pages/rewriter-api/rewriter-api.component';
import {SummarizerApiComponent} from './pages/summarizer-api/summarizer-api.component';
import {PromptApiComponent} from './pages/prompt-api/prompt-api.component';
import {DragDropModule} from '@angular/cdk/drag-drop';
import {PromptComponent} from './components/prompt/prompt.component';
import {OutputComponent} from './components/output/output.component';
import {CardComponent} from './components/card/card.component';
import {LanguageDetectorComponent} from './pages/language-detector/language-detector.component';
import {RequirementComponent} from './components/requirement/requirement.component';
import {IndexComponent} from './pages/index/index.component';
import {SidebarComponent} from './components/sidebar/sidebar.component';
import {LayoutComponent} from './components/layout/layout.component';
import {PageTitleComponent} from './components/page-title/page-title.component';
import {PageAccordionComponent} from './components/page-accordion/page-accordion.component';

import {MagienoDragAndDropComponent} from '@magieno/angular-drag-and-drop';
import {Environment} from './environments/environment';

@NgModule({
  declarations: [
    // Global components
    RootComponent,
    LayoutComponent,
    SidebarComponent,

    // Layout components
    CardComponent,
    CodeEditorComponent,
    OutputComponent,
    PageTitleComponent,
    PageAccordionComponent,
    PromptComponent,
    RequirementComponent,
    SearchSelectDropdownComponent,
    SearchSelectMultipleDropdownComponent,
    StepStatusIconComponent,
    StepTitleComponent,
    StepContainerVisualStatusDirective,
    ToastComponent,

    // Pages
    IndexComponent,
    LanguageDetectorComponent,
    PromptApiComponent,
    RewriterApiComponent,
    SummarizerApiComponent,
    TranslatorApiComponent,
    WriterApiComponent,



    // Pipes
    EnumToSearchSelectDropdownOptionsPipe,

    // Directives
    StepContainerVisualStatusDirective,
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    ReactiveFormsModule,
    FormsModule,
    DragDropModule,
    MagienoDragAndDropComponent,
  ],
  providers: [
    provideClientHydration(withEventReplay()),

    // Stores
    ToastStore,
  ],
  bootstrap: [RootComponent]
})
export class AppModule {
}
