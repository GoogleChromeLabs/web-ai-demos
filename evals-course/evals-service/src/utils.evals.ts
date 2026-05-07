/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AppOutputSchema } from "./schemas";
import { EvalResult, EvalLabel, ColorPalette, TestCaseResult } from "./types";

export function evalDataFormat(appOutput: any): EvalResult {
  const result = AppOutputSchema.safeParse(appOutput);
  if (!result.success) {
    const errorMessages = result.error.issues.map(err => {
      const path = err.path.join('.');
      return path ? `${path}: ${err.message}` : err.message;
    }).join(", ");
    return { label: EvalLabel.FAIL, rationale: errorMessages };
  }
  return { label: EvalLabel.PASS, rationale: "Data format is correct." };
}

export function evalContrastRatio(colorPalette: ColorPalette, minContrastRatio: number): EvalResult {
  if (!colorPalette || !colorPalette.textColor || !colorPalette.backgroundColor) {
    return { label: EvalLabel.FAIL, rationale: "Missing textColor or backgroundColor." };
  }
  try {
    const ratio = getContrastRatio(colorPalette.textColor, colorPalette.backgroundColor);
    const rationale = `Contrast ratio is ${ratio.toFixed(2)}:1 (must be >= ${minContrastRatio}:1).`;
    if (ratio < minContrastRatio) {
      return { label: EvalLabel.FAIL, rationale };
    }
    return { label: EvalLabel.PASS, rationale };
  } catch (e) {
    return { label: EvalLabel.FAIL, rationale: "Could not calculate contrast ratio (invalid hex?)." };
  }
}

function getContrastRatio(hex1: string, hex2: string) {
  const l1 = getLuminance(hex1);
  const l2 = getLuminance(hex2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

function getLuminance(hex: string) {
  let hexContent = hex.slice(1);
  if (hexContent.length === 3) {
    hexContent = hexContent.split('').map(c => c + c).join('');
  }
  const rgb = parseInt(hexContent, 16);
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = (rgb >> 0) & 0xff;

  const [lr, lg, lb] = [r, g, b].map(c => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

export function getInvalidHexColors(colorPalette: Record<string, string>): string[] {
  const hexRegex = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
  const invalidColors: string[] = [];
  for (const [key, value] of Object.entries(colorPalette)) {
    if (typeof value !== 'string' || !hexRegex.test(value)) {
      invalidColors.push(`${key}: ${value}`);
    }
  }
  return invalidColors;
}
