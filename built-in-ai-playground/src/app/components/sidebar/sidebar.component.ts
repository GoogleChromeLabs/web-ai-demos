/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {Component, Inject, Input, OnInit} from '@angular/core';
import {BaseComponent} from '../base/base.component';
import {DOCUMENT} from '@angular/common';
import {ActivatedRoute, NavigationEnd, Router} from '@angular/router';
import {RouteEnum} from '../../enums/route.enum';
import {Environment} from '../../environments/environment';

@Component({
  selector: 'app-sidebar',
  templateUrl: './sidebar.component.html',
  standalone: false,
  styleUrl: './sidebar.component.scss'
})
export class SidebarComponent extends BaseComponent implements OnInit {
  public currentRoute?: RouteEnum;

  public expanded = true;

  constructor(
    @Inject(DOCUMENT) document: Document,
    protected readonly route: ActivatedRoute,
    protected readonly router: Router,
  ) {
    super(document);
  }

  override ngOnInit() {
    super.ngOnInit();

    if(this.window) {
      this.setCurrentRoute(this.window.location.pathname);
    }

    this.subscriptions.push(this.router.events.subscribe((event) => {
      if(event instanceof NavigationEnd) {
        this.setCurrentRoute(event.url);
      }
    }))

    this.subscriptions.push(this.route.queryParams.subscribe(params => {
      if(params['sidebarExpanded'] === 'false') {
        this.expanded = false;
      } else if(params['sidebarExpanded'] === 'true') {
        this.expanded = true;
      }
    }))
  }

  setCurrentRoute(url: string) {
    if(url.endsWith('translator-api')) {
      this.currentRoute = RouteEnum.TranslatorApi;
    } else if(url.endsWith('language-detector-api')) {
      this.currentRoute = RouteEnum.LanguageDetectorApi;
    }
    
    else if(url.endsWith('prompt-api')) {
      this.currentRoute = RouteEnum.PromptApi;
    } else if(url.endsWith('rewriter-api')) {
      this.currentRoute = RouteEnum.RewriterApi;
    }else if(url.endsWith('writer-api')) {
      this.currentRoute = RouteEnum.WriterApi;
    } else if(url.endsWith('summarizer-api')) {
      this.currentRoute = RouteEnum.SummarizerApi;
    }else if(url.endsWith('/')) {
      this.currentRoute = RouteEnum.Home;
    }
  }

  toggleSidebar() {
    this.expanded = !this.expanded;

    const urlTree = this.router.parseUrl(this.router.url)
    urlTree.queryParams['sidebarExpanded'] = this.expanded;
    this.router.navigateByUrl(urlTree)
  }

  protected readonly RouteEnum = RouteEnum;
  protected readonly Environment = Environment;
}
