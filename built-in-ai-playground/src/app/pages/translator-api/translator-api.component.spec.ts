/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TranslatorApiComponent } from './translator-api.component';

describe('RootComponent', () => {
  let component: TranslatorApiComponent;
  let fixture: ComponentFixture<TranslatorApiComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TranslatorApiComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TranslatorApiComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
