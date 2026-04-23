// Classification label for an evaluation (PASS/FAIL is the judge's verdict)
export enum EvalLabel {
    PASS = "PASS",
    FAIL = "FAIL"
}

export interface BasicAlignmentResults {
    mismatches: Mismatch[];
    totalSampleCount: number;
    alignedSampleCount: number;
    accuracy: number;
}

export const EVAL_CRITERIA: ('mottoBrandFit' | 'mottoToxicity' | 'colorBrandFit')[] = ['mottoBrandFit', 'mottoToxicity', 'colorBrandFit'];

export const METRIC_TO_RESULT_KEY: Record<'mottoBrandFit' | 'mottoToxicity' | 'colorBrandFit', keyof EvalItemResults> = {
    mottoBrandFit: 'mottoBrandFit',
    mottoToxicity: 'mottoToxicity',
    colorBrandFit: 'colorBrandFit',
};


export interface UserInput {
    companyName: string;
    description: string;
    audience: string;
    tone: string[] | string;
}

export interface ColorPalette {
    textColor: string;
    backgroundColor: string;
    primary: string;
    secondary: string;
    [key: string]: string;
}

export interface AppOutput {
    motto: string;
    colorPalette: ColorPalette;
}

export interface EvalItemInput {
    id: string;
    userInput: UserInput;
    appOutput: AppOutput;
}

export interface EvalResult {
    label: EvalLabel;
    rationale?: string;
}

export interface EvalItemResults {
    id: string;
    dataFormat: EvalResult;
    colorBrandFit: EvalResult;
    contrast: EvalResult;
    mottoToxicity: EvalResult;
    mottoBrandFit: EvalResult;
}

export interface EvalResponse {
    results: EvalItemResults[];
    modelVersion?: string;
}

export interface Mismatch {
    id: string;
    evalCriterion: string;
    humanLabel: EvalLabel;
    llmLabel: EvalLabel;
    humanRationale: string;
    llmRationale: string;
}

export interface RawStatsPerMetric {
    TP: number;
    FP: number;
    FN: number;
    TN: number;
    total: number;
    aligned: number;
    target: EvalLabel;
}

export interface RawAlignmentResults {
    // Object that has exactly these three string keys (mottoBrandFit, mottoToxicity, and colorBrandFit), and the value for each must be a RawStatsPerMetric
    rawStatsAllMetrics: Record<'mottoBrandFit' | 'mottoToxicity' | 'colorBrandFit', RawStatsPerMetric>;
    mismatches: Mismatch[];
    total: number;
    aligned: number;
}

export interface FinalStatsPerMetric {
    evalCriterion: string;
    accuracy: number;
    kappaScore: number;
    precision: number;
    recall: number;
    f1Score: number;
    total: number;
    aligned: number;
    target: EvalLabel;
}

/**
 * Mathematical artifact note: Precision, Recall, and Cohen's Kappa are intentionally 
 * omitted from global cross-metric aggregations. Because individual metrics hunt for 
 * inverted targets (e.g., Toxicity targets FAIL, BrandFit targets PASS) and represent 
 * fundamentally different cognitive tasks, sum-pooling them creates mathematically 
 * and diagnostically useless metrics.
 * Only overall accuracy (which simply means "Did the LLM agree on the task?") is valid.
 */
export interface FinalStatsAcrossMetrics {
    accuracy: number;
    total: number;
    aligned: number;
}

export interface FinalAlignmentResults {
    statsAcrossMetrics: FinalStatsAcrossMetrics;
    statsPerMetric: FinalStatsPerMetric[];
}

export interface BootstrapStat {
    min: number;
    max: number;
    avg: number;
    variance: number;
}

// See FinalStatsAcrossMetrics for why Precision, Recall, and Kappa are omitted here
export interface FinalBootstrapStatsAcrossMetrics {
    accuracy: BootstrapStat;
    avgAlignedEvals: number;
    avgTotalEvals: number;
}

export interface FinalBootstrapStatsPerMetric {
    evalCriterion: string;
    accuracy: BootstrapStat;
    kappaScore: BootstrapStat;
    precision: BootstrapStat;
    recall: BootstrapStat;
    f1Score: BootstrapStat;
    target: EvalLabel;
}

export interface FinalBootstrapAlignmentResults {
    statsAcrossMetrics: FinalBootstrapStatsAcrossMetrics;
    statsPerMetric: FinalBootstrapStatsPerMetric[];
}

export type ConsistencyVerdict = "STABLE" | "VARIABLE" | "UNSTABLE";

export interface RawConsistencyResults {
    id: string;
    mottoToxicity: EvalLabel[];
    mottoBrandFit: EvalLabel[];
    colorBrandFit: EvalLabel[];
}

export interface ConsistencyStatsPerItemMetric {
    id: string;
    evalCriterion: string;
    passProbability: number;
    variance: number;
    consistency: number;
    verdict: ConsistencyVerdict;
}

export interface ConsistencyStatsAcrossMetrics {
    overallConsistency: number;
}

export interface FinalConsistencyResults {
    statsAcrossMetrics: ConsistencyStatsAcrossMetrics;
    breakdownByItemMetric: ConsistencyStatsPerItemMetric[];
}
