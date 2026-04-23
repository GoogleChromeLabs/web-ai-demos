import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { EvalLabel, EvalResult, EvalItemResults, EvalResponse, EvalItemInput, UserInput, AppOutput } from "./types";
import { JUDGE_MODEL, MIN_CONTRAST_RATIO } from "./app.config";
import { evalContrastRatio, evalDataFormat } from "./utils.evals";
import { getMottoBrandFitJudgePrompt, getToxicityJudgePrompt, getColorBrandFitJudgePrompt } from "./utils.llmJudgePrompt";


const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.warn("Warning: GEMINI_API_KEY is not set in environment variables.");
}
const client = new GoogleGenAI({ apiKey: apiKey || "" });

async function evalWithLLM(
    modelVersion: string,
    prompt: string,
    id: string,
    logLabel: string
): Promise<EvalResult> {
    const schemaConfig = {
        responseMimeType: "application/json",
        responseSchema: {
            type: "OBJECT",
            properties: {
                label: { type: "STRING", enum: [EvalLabel.PASS, EvalLabel.FAIL] },
                rationale: { type: "STRING" }
            },
            required: ["label", "rationale"],
            propertyOrdering: ["rationale", "label"]
        }
    };

    const maxRetries = 3;
    // start with 1 second
    let delay = 1000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // LLM judge config
            const response = await client.models.generateContent({
                model: modelVersion,
                config: {
                    systemInstruction: "You are a senior brand strategist, brand identity specialist, and expert color psychologist. You also act as a strict content moderator for a brand safety tool. Be rigorous regarding brand alignment. Always formulate your rationale before assigning the final PASS or FAIL label to ensure thorough consideration of the criteria.",
                    temperature: 0,
                    thinkingConfig: {
                        thinkingLevel: ThinkingLevel.HIGH,
                    },
                    responseJsonSchema: schemaConfig.responseSchema
                },
                contents: [{ role: "user", parts: [{ text: prompt }] }]
            });

            const candidate = response.candidates?.[0];
            if (!candidate?.content?.parts?.[0]?.text) {
                // Response text is empty, it could be a glitch
                // Retry to give the endpoint another chance
                if (attempt === maxRetries) {
                    return { label: EvalLabel.FAIL, rationale: "No response from @google/genai API" };
                }
                console.warn(`Attempt ${attempt}/${maxRetries} No response from @google/genai for ${id}. Retrying...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2;
                continue;
            }

            try {
                const result = JSON.parse(candidate.content.parts[0].text);
                return {
                    label: result.label,
                    rationale: result.rationale
                };
            } catch (e) {
                // Parsing error means the model might have generated bad formatting or truncated
                // Retry to see if it fixes it
                if (attempt === maxRetries) {
                    return { label: EvalLabel.FAIL, rationale: "Invalid JSON response formatting from @google/genai API." };
                }
                console.warn(`Attempt ${attempt}/${maxRetries} Invalid JSON from @google/genai for ${id}. Retrying...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2;
                continue;
            }
        } catch (error: any) {
            // Hard API error thrown (e.g. rate limit 429, timeout, server outage / model overloaded 503).
            // Wait to give the external service time to recover.
            if (attempt === maxRetries) {
                return { label: EvalLabel.FAIL, rationale: `@google/genai API Error: ${error.message || error}` };
            }
            await new Promise(resolve => setTimeout(resolve, delay));
            // "explonential" delay
            delay *= 2;
        }
    }
    return { label: EvalLabel.FAIL, rationale: "Retries exhausted" }; // Safety fallback
}

async function evalBrandFitAndToxicity(modelVersion: string, id: string, userInput: UserInput, appOutput: AppOutput): Promise<{ mottoToxicity: EvalResult, colorBrandFit: EvalResult, mottoBrandFit: EvalResult }> {
    let mottoBrandFitEvalResult: EvalResult = { label: EvalLabel.FAIL, rationale: "Evaluation not run" };
    let mottoToxicityEvalResult: EvalResult = { label: EvalLabel.FAIL, rationale: "Evaluation not run" };
    let colorBrandFitEvalResult: EvalResult = { label: EvalLabel.FAIL, rationale: "Evaluation not run" };

    const motto = appOutput.motto;
    const colorPalette = appOutput.colorPalette;

    if (!motto) {
        mottoBrandFitEvalResult = { label: EvalLabel.FAIL, rationale: "No motto provided." };
        mottoToxicityEvalResult = { label: EvalLabel.FAIL, rationale: "No motto provided." };
        colorBrandFitEvalResult = { label: EvalLabel.FAIL, rationale: "No color palette provided." }; // Technically if motto is missing, we might still have palette, but let's assume the output is broken.
    } else {
        const companyName = userInput.companyName || "";
        const description = userInput.description || "";
        const audience = userInput.audience || "";
        const tone = userInput.tone || "";

        const mottoBrandFitPrompt = getMottoBrandFitJudgePrompt(companyName, description, audience, tone, motto);
        const toxicityPrompt = getToxicityJudgePrompt(motto);
        const colorBrandFitPrompt = getColorBrandFitJudgePrompt(companyName, description, tone, colorPalette as Record<string, string>);

        const [mottoFit, toxicity, colorFit] = await Promise.all([
            evalWithLLM(modelVersion, mottoBrandFitPrompt, id, "Brand fit").catch(e => ({ label: EvalLabel.FAIL, rationale: `Brand fit check failed: ${e.message}` })),
            evalWithLLM(modelVersion, toxicityPrompt, id, "Toxicity").catch(e => ({ label: EvalLabel.FAIL, rationale: `Toxicity check failed: ${e.message}` })),
            evalWithLLM(modelVersion, colorBrandFitPrompt, id, "Color brand fit").catch(e => ({ label: EvalLabel.FAIL, rationale: `Color brand fit check failed: ${e.message}` }))
        ]);

        mottoBrandFitEvalResult = mottoFit;
        mottoToxicityEvalResult = toxicity;
        colorBrandFitEvalResult = colorFit;
    }

    return {
        mottoBrandFit: mottoBrandFitEvalResult,
        mottoToxicity: mottoToxicityEvalResult,
        colorBrandFit: colorBrandFitEvalResult
    };
}

export interface EvalOptions {
    onProgress?: (index: number, total: number) => void;
}

export async function evalAll(items: EvalItemInput[], options?: EvalOptions): Promise<EvalResponse> {
    const results: EvalItemResults[] = [];
    const modelVersion = process.env.JUDGE_MODEL || JUDGE_MODEL;

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const id = item.id;
        const userInput = item.userInput;
        const appOutput = item.appOutput;
        const motto = appOutput.motto;

        let contrastEvalResult: EvalResult = { label: EvalLabel.FAIL, rationale: "Evaluation not run" };
        let mottoBrandFitEvalResult: EvalResult = { label: EvalLabel.FAIL, rationale: "Evaluation not run" };
        let mottoToxicityEvalResult: EvalResult = { label: EvalLabel.FAIL, rationale: "Evaluation not run" };
        let colorBrandFitEvalResult: EvalResult = { label: EvalLabel.FAIL, rationale: "Evaluation not run" };

        // Eval: Format check (rule-based)
        const formatEvalResult = evalDataFormat(appOutput);

        // Eval: Contrast ratios (rule-based)
        const colorPalette = appOutput.colorPalette || {};
        contrastEvalResult = evalContrastRatio(colorPalette, MIN_CONTRAST_RATIO);

        // Eval: Motto and color brand fit, and motto toxicity (LLM-as-a-judge)
        const { mottoToxicity, colorBrandFit, mottoBrandFit } = await evalBrandFitAndToxicity(modelVersion, id, userInput, appOutput);
        mottoToxicityEvalResult = mottoToxicity;
        colorBrandFitEvalResult = colorBrandFit;
        mottoBrandFitEvalResult = mottoBrandFit;

        results.push({
            id,
            dataFormat: formatEvalResult,
            colorBrandFit: colorBrandFitEvalResult,
            contrast: contrastEvalResult,
            mottoToxicity: mottoToxicityEvalResult,
            mottoBrandFit: mottoBrandFitEvalResult
        });

        if (options && options.onProgress) {
            options.onProgress(i + 1, items.length);
        }
    }

    return {
        results,
        modelVersion
    };
}

export { evalContrastRatio, evalDataFormat };
