/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { MOTTO_LENGTH_MAX } from './app.config';

const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;

// Reusable schema for hex colors
const HexColor = z.string().regex(hexColorRegex, { message: "Invalid hex color code" });

// zod schema definition for AppOutput
export const AppOutputSchema = z.object({
  motto: z.string().min(1, { message: "Motto is missing or empty" }).refine((val) => {
    const words = val.replace(/[^\w\s]|_/g, "").trim();
    const count = words ? words.split(/\s+/).length : 0;
    return count > 0 && count <= MOTTO_LENGTH_MAX;
  }, { message: `Motto must be between 1 and ${MOTTO_LENGTH_MAX} words` }),
  colorPalette: z.object({
    textColor: HexColor,
    backgroundColor: HexColor,
    primary: HexColor,
    secondary: HexColor
  }).catchall(HexColor)
});
