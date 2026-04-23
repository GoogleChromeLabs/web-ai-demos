import { z } from 'zod';
import { MAX_WORD_COUNT } from './app.config';

const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;

// Reusable schema for hex colors
const HexColor = z.string().regex(hexColorRegex, { message: "Invalid hex color code" });

// zod schema definition for AppOutput
export const AppOutputSchema = z.object({
  motto: z.string().min(1, { message: "Motto is missing or empty" }).refine((val) => {
    const words = val.replace(/[^\w\s]|_/g, "").trim();
    const count = words ? words.split(/\s+/).length : 0;
    return count > 0 && count <= MAX_WORD_COUNT;
  }, { message: `Motto must be between 1 and ${MAX_WORD_COUNT} words` }),
  colorPalette: z.object({
    textColor: HexColor,
    backgroundColor: HexColor,
    primary: HexColor,
    secondary: HexColor
  }).catchall(HexColor)
});
