/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {Component, Inject, OnInit} from '@angular/core';
import {ActivatedRoute, NavigationEnd, Router} from "@angular/router";
import {BaseComponent} from '../../components/base/base.component';
import {DOCUMENT} from '@angular/common';
import {RouteEnum} from '../../enums/route.enum';
import {Title} from '@angular/platform-browser';
import {BasePageComponent} from '../../components/base/base-page.component';

@Component({
  selector: 'app-index',
  templateUrl: './index.component.html',
  standalone: false,
  styleUrl: './index.component.scss'
})
export class IndexComponent extends BasePageComponent implements OnInit {

  constructor(
    @Inject(DOCUMENT) document: Document,
    protected readonly route: ActivatedRoute,
    protected readonly router: Router,
    title: Title,
  ) {
    super(document, title);
  }

  override ngOnInit() {
    super.ngOnInit();

    this.setTitle("API Playground")
  }

}
