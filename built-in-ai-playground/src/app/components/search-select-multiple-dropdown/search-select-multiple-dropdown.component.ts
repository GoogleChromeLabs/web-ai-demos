/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  AfterViewInit,
  Component,
  ElementRef,
  Inject,
  Input,
  OnInit,
  PLATFORM_ID,
  ViewChild,
  viewChild
} from '@angular/core';
import {RouterOutlet} from "@angular/router";
import {TaskStatus} from '../../enums/task-status.enum';
import {FormControl} from '@angular/forms';
import {Subscription} from 'rxjs';
import {isPlatformBrowser, isPlatformServer} from '@angular/common';
import {SearchSelectDropdownOptionsInterface} from '../../interfaces/search-select-dropdown-options.interface';

@Component({
  selector: 'app-search-select-multiple-dropdown',
  templateUrl: './search-select-multiple-dropdown.component.html',
  standalone: false,
  styleUrl: './search-select-multiple-dropdown.component.scss'
})
export class SearchSelectMultipleDropdownComponent implements OnInit, AfterViewInit {
  @Input()
  control = new FormControl<any[]>([]);

  searchControl = new FormControl<string>("");

  @Input()
  options: SearchSelectDropdownOptionsInterface[] = [];

  @Input()
  name: string = ""

  focused: boolean = false;

  @Input()
  placeholder: string = "Select...";

  @ViewChild("dropdownMenu")
  dropdownMenuElement!: ElementRef;

  filteredOptions: SearchSelectDropdownOptionsInterface[] = [];

  subscriptions: Subscription[] = [];

  dropdown: any;

  dropdownOpen = false;

  private _cursorPosition = -1;

  @ViewChild('inputElement') inputElement!: ElementRef;

  get cursorPosition(): number {
    return this._cursorPosition;
  }

  set cursorPosition(value: number) {
    console.log(value);
    this._cursorPosition = value;
  }

  constructor(
    @Inject(PLATFORM_ID) private readonly platformId: any,
  ) {
  }

  ngOnInit() {
    this.subscriptions.push(this.searchControl.valueChanges.subscribe((value) => {
      this.cursorPosition = -1;

      this.filterOptions();

      this.updateDropdown(true)
    }));

    this.filterOptions();
  }

  ngAfterViewInit() {
    if(isPlatformServer(this.platformId)) {
      return;
    }

    // @ts-ignore
    this.dropdown = new bootstrap.Dropdown(this.dropdownMenuElement.nativeElement);
  }

  getPlaceholder(): string {
    if(this.control && this.control.value && this.control.value.length > 0) {
      return "";
    }

    return this.placeholder;
  }

  keyUp(event: any) {
    if(event.key === "ArrowUp") {
      this.moveCursorUp();
    } else if(event.key === "ArrowDown") {
      this.moveCursorDown();
    } else if(event.key === "Enter") {
      this.selectOption(this.filteredOptions[this.cursorPosition].value);
    }
  }

  moveCursorUp() {
    if(this.cursorPosition <= 0) {
      this.cursorPosition = -1;
      return;
    }

    this.cursorPosition--;
  }

  moveCursorDown() {
    if(this.cursorPosition >= this.filteredOptions.length) {
      this.cursorPosition = 0;
      return;
    }

    this.cursorPosition++;
  }

  selectOption(option: string) {
    let selectedOptions = this.control.value;

    if(selectedOptions === null) {
      selectedOptions = [];
    }

    selectedOptions.push(option);

    this.control.setValue(selectedOptions);
    this.searchControl.setValue("")
  }

  unselectOption(option: string) {
    let selectedOptions = this.control.value;

    if(selectedOptions === null) {
      return
    }

    const index = selectedOptions.indexOf(option);

    if(index > -1) {
      selectedOptions.splice(index, 1);
    }

    this.control.setValue(selectedOptions);
  }

  filterOptions() {
    this.filteredOptions = this.options.filter(option => {
      if(this.control.value === null || this.control.value.find(element => element === option.value) !== undefined) {
        return false;
      }

      return !this.searchControl.value || option.label.toLowerCase().includes(this.searchControl.value.toLowerCase()) || option.value.toLowerCase().includes(this.searchControl.value.toLowerCase());
    });

    // this.filteredOptions = this.options.filter(option => {
    //   return !this.control.value ||
    //     (this.control.value.find( (element: SearchSelectDropdownOptionsInterface) => {
    //       return option.label.toLowerCase().includes(element.label) || option.label.toLowerCase().includes(element.value);
    //     }) !== undefined);
    // });
  }

  getOptionLabel(key: string) {
    const option = this.options.find(option => option.value === key);

    return option ? option.label : key;
  }

  updateDropdown(show?: boolean) {
    if(this.dropdownOpen && !show) {
      this.dropdown.hide();
      this.dropdownOpen = false;
    } else {
      this.dropdown.show();
      this.dropdownOpen = true;
    }
  }

  dropdownClicked() {
    this.filterOptions()

    this.inputElement.nativeElement.focus();

    this.updateDropdown()
  }
}
