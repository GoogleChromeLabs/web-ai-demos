import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { EvalResponse, TestCaseResult, EvalLabel, MetricResult, EvalResult } from './types';
import { EVALS_STABILITY_THRESHOLD } from './app.config';

/**
 * Helper function to generate a short stable hash for prompt tracking.
 */
function generatePromptHash(text?: string): string {
    if (!text) return 'N/A';
    return crypto.createHash('sha256').update(text).digest('hex').substring(0, 7);
}

/**
 * Generates a premium HTML report for an evaluation run.
 * @param response The evaluation response containing results and metadata.
 * @param outputDir The directory where the report should be saved.
 * @returns The absolute path to the generated HTML report.
 */
export function generateHtmlReport(response: EvalResponse, outputDir: string): string {
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const now = new Date();
    const fileTimestamp = now.toISOString().replace(/[:.]/g, '-');
    const humanTimestamp = now.toLocaleString();
    const filename = `report_${fileTimestamp}.html`;
    const outputPath = path.join(outputDir, filename);

    // Calculate Summary Stats
    const totalTests = response.results.length;
    const iterationsCount = response.results.find(r => r.mottoBrandFit?.evalResults)?.mottoBrandFit?.evalResults?.length ?? 5;
    let totalPassedCases = 0;
    let totalEvalsCount = 0;
    let passedEvalsCount = 0;

    response.results.forEach(res => {
        const evals = [res.dataFormat, res.contrast, res.mottoBrandFit, res.colorBrandFit, res.mottoToxicity];
        const isCasePassed = evals.every(e => e.label === EvalLabel.PASS);
        if (isCasePassed) totalPassedCases++;

        evals.forEach(e => {
            const isSkipped = e.rationale && (
                e.rationale.includes('SKIPPED') ||
                e.rationale.includes('Blocked') ||
                e.rationale.includes('N/A')
            );

            // Exclude API Errors and skipped/short-circuited evaluations from accuracy denominators
            if (e.label !== EvalLabel.ERROR && !isSkipped) {
                totalEvalsCount++;
                if (e.label === EvalLabel.PASS) passedEvalsCount++;
            }
        });
    });

    const casePassRate = totalTests > 0 ? (totalPassedCases / totalTests * 100).toFixed(0) : '0';
    const evalPassRate = totalEvalsCount > 0 ? (passedEvalsCount / totalEvalsCount * 100).toFixed(0) : '0';

    // Render App Metadata with Prompt Hashes
    const meta = response.appMetadata;
    const systemHash = generatePromptHash(meta?.systemInstruction);
    const promptHash = generatePromptHash(meta?.promptTemplate);

    const metadataHtml = meta ? `
        <div class="card metadata-inline-card">
            <div class="inline-meta-flex">
                <div class="meta-inline-items">
                    <div class="meta-inline-title">App config:</div>
                    <span class="inline-meta-tag"><strong>Model:</strong> <code style="margin-left: 0.25rem;">${meta.model}</code></span>
                    <span class="inline-meta-tag"><strong>Temperature:</strong> <code style="margin-left: 0.25rem;">${meta.temperature ?? 'default'}</code></span>
                    <span class="inline-meta-tag"><strong>Thinking level:</strong> <code style="margin-left: 0.25rem;">${meta.thinkingLevel ?? 'default (HIGH)'}</code></span>
                    ${meta.systemInstruction ? `<span class="inline-meta-tag"><strong>System prompt:</strong> <code class="hash-badge" style="margin-left:0.3rem; font-size: 0.7rem;">#${systemHash}</code></span>` : ''}
                    ${meta.promptTemplate ? `<span class="inline-meta-tag"><strong>User prompt:</strong> <code class="hash-badge" style="margin-left:0.3rem; font-size: 0.7rem;">#${promptHash}</code></span>` : ''}
                </div>
                <button class="config-expand-btn" onclick="toggleMasterConfig()">View full prompts & instruction specs ▼</button>
            </div>
            
            <div id="master-config-drawer" class="config-drawer" style="display: none; margin-top: 1rem; border-top: 1px dashed var(--border); padding-top: 0.75rem;">
                <div class="prompts-container-grid" style="margin-top: 0.5rem;">
                    ${meta.systemInstruction ? `
                        <div class="prompt-section collapsible" onclick="togglePromptSection(this)">
                            <h3>System instruction <code class="hash-badge">#${systemHash}</code></h3>
                            <div class="collapsible-content">
                                <pre><code>${escapeHtml(meta.systemInstruction)}</code></pre>
                            </div>
                            <div style="margin-top: 0.5rem;"><span class="expand-hint">Click to expand</span></div>
                        </div>
                    ` : ''}
                    ${meta.promptTemplate ? `
                        <div class="prompt-section collapsible" onclick="togglePromptSection(this)">
                            <h3>User prompt template <code class="hash-badge">#${promptHash}</code></h3>
                            <div class="collapsible-content">
                                <pre><code>${escapeHtml(meta.promptTemplate)}</code></pre>
                            </div>
                            <div style="margin-top: 0.5rem;"><span class="expand-hint">Click to expand</span></div>
                        </div>
                    ` : ''}
                </div>
            </div>
        </div>
    ` : '<div class="card"><p class="text-muted">No application metadata provided.</p></div>';


    // Render Results Rows into specific 4 columns: TEST CASE ID, EXPECTED OUTCOME, ACTUAL OUTCOME, TEST STATUS
    const rows = response.results.map((res: TestCaseResult) => {
        const evals = [res.dataFormat, res.contrast, res.mottoBrandFit, res.colorBrandFit, res.mottoToxicity];
        const isCasePassed = evals.every(e => e.label === EvalLabel.PASS) && res.appGateResult.label === EvalLabel.PASS;
        const hasErrors = evals.some(e => e.label === EvalLabel.ERROR) || res.appGateResult.label === EvalLabel.ERROR;
        const hasFailures = evals.some(e => e.label === EvalLabel.FAIL || e.label === EvalLabel.ERROR) ||
            (res.appGateResult.label === EvalLabel.FAIL || res.appGateResult.label === EvalLabel.ERROR);

        const rowClass = isCasePassed ? 'row-pass' : (hasErrors ? 'row-error' : 'row-fail');

        const gateResult = res.appGateResult;
        const isGatePass = gateResult.label === EvalLabel.PASS;
        const gateRationale = gateResult.rationale || 'NONE';

        let gateBadgeHtml = '';
        if (isGatePass) {
            if (gateRationale === 'NONE') {
                gateBadgeHtml = `<span class="badge pass" style="background-color: #dcfce7; color: #166534; border: 1px solid #bbf7d0; font-size: 0.7rem; padding: 0.15rem 0.4rem;">PASS</span>`;
            } else {
                gateBadgeHtml = `<span class="badge pass" style="background-color: #dcfce7; color: #166534; border: 1px solid #bbf7d0; font-size: 0.7rem; padding: 0.15rem 0.4rem;">PASS</span>`;
            }
        } else {
            const labelText = gateResult.label === EvalLabel.ERROR ? 'ERROR' : 'FAIL';
            gateBadgeHtml = `<span class="badge fail" style="font-size: 0.7rem; padding: 0.15rem 0.4rem;">${labelText}</span>`;
        }

        const overallStatusBadge = isCasePassed
            ? `<span class="badge pass" style="font-size: 0.75rem; padding: 0.25rem 0.6rem;">PASS</span>`
            : `<span class="badge fail" style="font-size: 0.75rem; padding: 0.25rem 0.6rem;">FAIL</span>`;

        const mappedExpected = res.expectedOutcome === 'SUCCESS'
            ? 'No app gate, evals pass with stability >= threshold'
            : (`App gate: ${res.expectedOutcome || 'SUCCESS'}`);

        // Tab navigation buttons
        const totalIterCount = res.appOutputs.length;
        let tabsButtonsHtml = `
            <div class="case-tabs-header">
                <button class="case-tab-btn tab-btn-${res.id} active" id="btn-${res.id}-summary" onclick="selectCaseTab('${res.id}', 'summary')">
                    All Summary
                </button>
        `;
        for (let j = 0; j < totalIterCount; j++) {
            tabsButtonsHtml += `
                <button class="case-tab-btn tab-btn-${res.id}" id="btn-${res.id}-iter-${j}" onclick="selectCaseTab('${res.id}', 'iter-${j}')">
                    Iter ${j + 1}
                </button>
            `;
        }
        tabsButtonsHtml += `</div>`;

        // Tab Content: All Summary
        const summaryContentHtml = `
            <div class="case-tab-content tab-content-${res.id}" id="content-${res.id}-summary" style="display: block;">
                <div class="vertical-outcome-list">
                    <div class="outcome-item"><span class="outcome-lbl">App gate:</span> ${gateBadgeHtml}</div>
                    <div class="outcome-item"><span class="outcome-lbl">Data format:</span> ${renderBadge(res.dataFormat)}</div>
                    <div class="outcome-item"><span class="outcome-lbl">Contrast ratio:</span> ${renderBadge(res.contrast)}</div>
                    <div class="outcome-item"><span class="outcome-lbl">Motto brand fit:</span> ${renderBadge(res.mottoBrandFit, true)}</div>
                    <div class="outcome-item"><span class="outcome-lbl">Color brand fit:</span> ${renderBadge(res.colorBrandFit, true)}</div>
                    <div class="outcome-item"><span class="outcome-lbl">Motto toxicity:</span> ${renderBadge(res.mottoToxicity, true)}</div>
                </div>
            </div>
        `;

        // Tab Content: Indiv Iterations
        let iterContentsHtml = '';
        for (let j = 0; j < totalIterCount; j++) {
            const out = res.appOutputs[j] || res.appOutputs[0] || { success: false, errorCode: "NO_OUTPUT" };
            const isBlocked = out.success === false || out.errorCode !== undefined;

            iterContentsHtml += `
                <div class="case-tab-content tab-content-${res.id}" id="content-${res.id}-iter-${j}" style="display: none;">
            `;

            if (isBlocked) {
                iterContentsHtml += `
                    <div class="iter-blocker-box" style="background-color: var(--danger-light); border: 1px solid rgba(239, 68, 68, 0.15); border-radius: 8px; padding: 0.75rem; margin-bottom: 0.5rem;">
                        <span class="badge fail" style="font-size:0.65rem; padding: 2px 6px;">BLOCKED</span>
                        <div class="blocker-details" style="margin-top: 0.5rem; font-size: 0.8rem;">
                            <strong>Error Code:</strong> <code class="font-mono">${escapeHtml(out.errorCode || 'UNKNOWN_ERROR')}</code>
                            ${out.errorMessage ? `<br><strong>Details:</strong> <span class="text-muted">${escapeHtml(out.errorMessage)}</span>` : ''}
                        </div>
                    </div>
                `;
            } else {
                iterContentsHtml += `
                    <!-- Slogan / Motto Preview Box -->
                    <div class="generated-theme-preview" style="
                        background-color: #f8fafc;
                        color: var(--text-main);
                        border: 1px solid var(--border);
                        border-radius: 8px;
                        padding: 0.6rem 0.85rem;
                        margin-bottom: 0.5rem;
                        box-shadow: inset 0 1px 2px rgba(0,0,0,0.02);
                    ">
                        <div style="font-size: 0.65rem; text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em; color: var(--text-muted); margin-bottom: 0.15rem;">
                            Generated Motto
                        </div>
                        <blockquote style="margin: 0; font-size: 0.85rem; font-style: italic; font-weight: 700; line-height: 1.3; color: var(--text-main);">
                            "${escapeHtml(out.motto || 'N/A')}"
                        </blockquote>
                    </div>

                    <!-- Color Palette Pills -->
                    <div class="color-palette-bar" style="display: flex; gap: 4px; align-items: center; margin-bottom: 0.5rem; flex-wrap: wrap;">
                        <span style="font-size: 0.7rem; font-weight: 600; color: var(--text-muted); margin-right: 2px;">Palette:</span>
                        <span class="color-pill-badge" style="border: 1px solid var(--border); border-radius: 6px; background-color: #fff; padding: 1px 4px; font-size: 0.65rem; display: inline-flex; align-items: center; gap: 3px;">
                            <span class="color-dot" style="width: 8px; height: 8px; border-radius: 50%; background-color: ${out.colorPalette?.primary || '#000'}; display: inline-block; border: 1px solid rgba(0,0,0,0.15);"></span>
                            Primary: <code>${out.colorPalette?.primary || 'N/A'}</code>
                        </span>
                        <span class="color-pill-badge" style="border: 1px solid var(--border); border-radius: 6px; background-color: #fff; padding: 1px 4px; font-size: 0.65rem; display: inline-flex; align-items: center; gap: 3px;">
                            <span class="color-dot" style="width: 8px; height: 8px; border-radius: 50%; background-color: ${out.colorPalette?.secondary || '#000'}; display: inline-block; border: 1px solid rgba(0,0,0,0.15);"></span>
                            Secondary: <code>${out.colorPalette?.secondary || 'N/A'}</code>
                        </span>
                        <span class="color-pill-badge" style="border: 1px solid var(--border); border-radius: 6px; background-color: #fff; padding: 1px 4px; font-size: 0.65rem; display: inline-flex; align-items: center; gap: 3px;">
                            <span class="color-dot" style="width: 8px; height: 8px; border-radius: 50%; background-color: ${out.colorPalette?.backgroundColor || '#000'}; display: inline-block; border: 1px solid rgba(0,0,0,0.15);"></span>
                            BG: <code>${out.colorPalette?.backgroundColor || 'N/A'}</code>
                        </span>
                        <span class="color-pill-badge" style="border: 1px solid var(--border); border-radius: 6px; background-color: #fff; padding: 1px 4px; font-size: 0.65rem; display: inline-flex; align-items: center; gap: 3px;">
                            <span class="color-dot" style="width: 8px; height: 8px; border-radius: 50%; background-color: ${out.colorPalette?.textColor || '#000'}; display: inline-block; border: 1px solid rgba(0,0,0,0.15);"></span>
                            Text: <code>${out.colorPalette?.textColor || 'N/A'}</code>
                        </span>
                    </div>
                `;
            }

            // Iteration check results grid
            iterContentsHtml += `
                    <div class="iter-mini-evals" style="
                        display: grid; 
                        grid-template-columns: repeat(2, minmax(0, 1fr)); 
                        gap: 0.35rem; 
                        background-color: #f8fafc; 
                        padding: 0.5rem; 
                        border-radius: 8px; 
                        border: 1px solid var(--border);
                    ">
                        <div class="mini-eval-item" style="font-size: 0.7rem; display: flex; align-items: center; justify-content: space-between;">
                            <span class="mini-eval-lbl" style="color: var(--text-muted); font-weight: 500;">App Gate check:</span>
                            ${renderIterBadge(res.appGateResult.evalResults?.[j])}
                        </div>
                        <div class="mini-eval-item" style="font-size: 0.7rem; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px dashed #e2e8f0; padding-bottom: 2px;">
                            <span class="mini-eval-lbl" style="color: var(--text-muted); font-weight: 500;">Data format check:</span>
                            ${renderIterBadge(res.dataFormat.evalResults?.[j])}
                        </div>
                        <div class="mini-eval-item" style="font-size: 0.7rem; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px dashed #e2e8f0; padding-bottom: 2px;">
                            <span class="mini-eval-lbl" style="color: var(--text-muted); font-weight: 500;">Contrast ratio:</span>
                            ${renderIterBadge(res.contrast.evalResults?.[j])}
                        </div>
                        <div class="mini-eval-item" style="font-size: 0.7rem; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px dashed #e2e8f0; padding-bottom: 2px;">
                            <span class="mini-eval-lbl" style="color: var(--text-muted); font-weight: 500;">Motto brand fit:</span>
                            ${renderIterBadge(res.mottoBrandFit.evalResults?.[j])}
                        </div>
                        <div class="mini-eval-item" style="font-size: 0.7rem; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px dashed #e2e8f0; padding-bottom: 2px;">
                            <span class="mini-eval-lbl" style="color: var(--text-muted); font-weight: 500;">Color brand fit:</span>
                            ${renderIterBadge(res.colorBrandFit.evalResults?.[j])}
                        </div>
                        <div class="mini-eval-item" style="font-size: 0.7rem; display: flex; align-items: center; justify-content: space-between;">
                            <span class="mini-eval-lbl" style="color: var(--text-muted); font-weight: 500;">Motto toxicity:</span>
                            ${renderIterBadge(res.mottoToxicity.evalResults?.[j])}
                        </div>
                    </div>
                </div>
            `;
        }

        return `
            <tr class="${rowClass}">
                <td style="vertical-align: top;">
                    <div class="font-mono font-bold" style="font-size: 1rem; color: var(--primary); margin-bottom: 0.5rem;">
                        ${res.id}
                    </div>
                    <!-- User input parameters in a premium, compact box -->
                    <div class="user-input-card" style="
                        background-color: #f8fafc;
                        border: 1px solid var(--border);
                        border-radius: 8px;
                        padding: 0.5rem;
                        font-size: 0.75rem;
                        color: var(--text-muted);
                    ">
                        <div style="margin-bottom: 2px;"><strong>Company:</strong> <span style="color: var(--text-main); font-weight: 600;">${escapeHtml(res.userInput.companyName)}</span></div>
                        <div style="margin-bottom: 2px;"><strong>Audience:</strong> <span style="color: var(--text-main);">${escapeHtml(res.userInput.audience)}</span></div>
                        <div style="margin-bottom: 2px;">
                            <strong>Tone:</strong> 
                            ${Array.isArray(res.userInput.tone)
                ? res.userInput.tone.map(t => `<span class="inline-meta-tag" style="font-size: 0.65rem; padding: 1px 4px; margin-right:2px; font-weight:600; border-radius: 4px; border: 1px solid #e2e8f0; background-color: #fff;">${escapeHtml(t)}</span>`).join('')
                : `<span class="inline-meta-tag" style="font-size: 0.65rem; padding: 1px 4px; font-weight:600; border-radius: 4px; border: 1px solid #e2e8f0; background-color: #fff;">${escapeHtml(res.userInput.tone)}</span>`
            }
                        </div>
                        <div style="border-top: 1px dashed var(--border); margin-top: 4px; padding-top: 4px; font-style: italic; line-height: 1.2; color: #475569;">
                            "${escapeHtml(res.userInput.description)}"
                        </div>
                    </div>
                </td>
                <td><div style="white-space: normal;">${mappedExpected}</div></td>
                <td>
                    ${tabsButtonsHtml}
                    ${summaryContentHtml}
                    ${iterContentsHtml}
                </td>
                <td>${overallStatusBadge}</td>
            </tr>
            ${hasFailures ? `
                <tr class="rationales-row ${rowClass}">
                    <td colspan="4">
                        <div class="rationales-container">
                            <strong>Test rationales & anomalies:</strong>
                            <ul>
                                ${renderRationaleLi("App Gate", res.appGateResult)}
                                ${renderRationaleLi("Data Format", res.dataFormat)}
                                ${renderRationaleLi("Contrast", res.contrast)}
                                ${renderRationaleLi("Motto Brand Fit", res.mottoBrandFit)}
                                ${renderRationaleLi("Color Brand Fit", res.colorBrandFit)}
                                ${renderRationaleLi("Toxicity", res.mottoToxicity)}
                            </ul>
                        </div>
                    </td>
                </tr>
            ` : ''}
        `;
    }).join('');

    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Eval Report - ${humanTimestamp}</title>
        <style>
            :root {
                --bg-color: #f8fafc;
                --card-bg: #ffffff;
                --text-main: #0f172a;
                --text-muted: #64748b;
                --primary: #2563eb;
                --primary-light: #eff6ff;
                --success: #10b981;
                --success-light: #ecfdf5;
                --danger: #ef4444;
                --danger-light: #fef2f2;
                --warning: #d97706;
                --warning-light: #fef3c7;
                --border: #e2e8f0;
                --radius: 12px;
            }

            * { box-sizing: border-box; }
            body {
                font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                background-color: var(--bg-color);
                color: var(--text-main);
                margin: 0;
                padding: 2rem 4rem;
                line-height: 1.5;
            }

            header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 2rem;
                border-bottom: 1px solid var(--border);
                padding-bottom: 1rem;
            }

            h1 { margin: 0; font-size: 2.25rem; font-weight: 700; color: var(--primary); }
            h2 { font-size: 1.5rem; margin-top: 0; font-weight: 600; }
            h3 { font-size: 1.1rem; margin-top: 1rem; margin-bottom: 0.5rem; color: var(--text-muted); }

            .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
            .font-bold { font-weight: 700; }

            .timestamp { color: var(--text-muted); font-size: 0.9rem; }
            .back-link {
                color: var(--primary);
                text-decoration: none;
                font-weight: 500;
                display: inline-flex;
                align-items: center;
                gap: 0.5rem;
            }
            .back-link:hover { text-decoration: underline; }

            .grid-stats {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
                gap: 1.5rem;
                margin-bottom: 2rem;
            }

            .card {
                background-color: var(--card-bg);
                border: 1px solid var(--border);
                border-radius: var(--radius);
                padding: 1.5rem;
                box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05);
            }

            .stat-card { display: flex; flex-direction: column; justify-content: center; padding: 0.75rem 1.25rem; }
            .stat-val { font-size: 1.85rem; font-weight: 700; line-height: 1.1; margin-bottom: 0.15rem; }
            .stat-lbl { color: var(--text-muted); font-size: 0.8rem; font-weight: 500; letter-spacing: 0.02em; text-transform: none !important; }
            
            .stat-card.pass { background-color: var(--success-light); border-color: rgba(16, 185, 129, 0.15); }
            .stat-card.pass .stat-val { color: var(--success); }
            .stat-card.fail { background-color: var(--danger-light); border-color: rgba(239, 68, 68, 0.15); }
            .stat-card.fail .stat-val { color: var(--danger); }

            .metadata-inline-card { margin-bottom: 1.5rem; padding: 0.6rem 1.25rem !important; background-color: #ffffff; }
            .meta-inline-title {
                font-size: 0.8rem;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.06em;
                color: #475569;
                margin-right: 0.4rem;
                display: inline-flex;
                align-items: center;
            }
            .inline-meta-flex { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem; }
            .meta-inline-items { display: flex; align-items: center; flex-wrap: wrap; gap: 0.6rem; }
            .inline-meta-tag {
                font-size: 0.85rem;
                background-color: #f8fafc;
                border: 1px solid #e2e8f0;
                padding: 0.2rem 0.5rem;
                border-radius: 6px;
                color: #334155;
                display: inline-flex;
                align-items: center;
            }
            .config-expand-btn {
                background: none;
                border: none;
                color: var(--primary);
                font-weight: 600;
                font-size: 0.85rem;
                cursor: pointer;
                padding: 0.25rem 0.5rem;
                border-radius: 4px;
                transition: all 0.2s;
                display: inline-flex;
                align-items: center;
            }
            .config-expand-btn:hover {
                background-color: var(--primary-light);
                text-decoration: none;
            }
            .config-expand-btn.active {
                color: #1d4ed8;
            }
            .config-drawer { width: 100%; }
            
            .prompts-container-grid {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 1rem;
                margin-top: 1rem;
            }
            
            @media (max-width: 768px) {
                .prompts-container-grid {
                    grid-template-columns: 1fr;
                }
            }
            
            .prompt-section {
                background-color: #f1f5f9;
                border-radius: 8px;
                padding: 1rem;
                margin-top: 0;
                border: 1px solid var(--border);
            }
            .prompt-section.collapsible {
                cursor: pointer;
                transition: background-color 0.2s ease, border-color 0.2s ease;
                position: relative;
            }
            .prompt-section.collapsible:hover {
                background-color: #e2e8f0;
                border-color: #cbd5e1;
            }
            .collapsible-content {
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .collapsible-content.expanded {
                display: block;
                overflow: visible;
            }
            .expand-hint {
                display: inline-block;
                font-size: 0.75rem;
                color: var(--primary);
                font-weight: 600;
                background-color: rgba(37, 99, 235, 0.08);
                padding: 2px 6px;
                border-radius: 4px;
            }
            .hash-badge {
                font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                font-size: 0.75rem;
                background-color: var(--bg-color);
                color: var(--text-muted);
                padding: 1px 5px;
                border-radius: 4px;
                font-weight: 500;
                margin-left: 0.4rem;
                border: 1px solid var(--border);
                vertical-align: middle;
            }
            pre { margin: 0; white-space: pre-wrap; word-break: break-all; }

            code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.875rem; }

            table {
                width: 100%;
                border-collapse: separate;
                border-spacing: 0;
                margin-top: 1rem;
                border-radius: var(--radius);
                overflow: hidden;
                border: 1px solid var(--border);
                background-color: var(--card-bg);
            }

            th {
                background-color: #f8fafc;
                padding: 12px 16px;
                font-weight: 700;
                text-align: left;
                font-size: 0.85rem;
                color: #475569;
                border-bottom: 1px solid var(--border);
                letter-spacing: 0.05em;
            }

            td {
                padding: 16px;
                border-bottom: 1px solid var(--border);
                vertical-align: top;
                font-size: 0.95rem;
            }

            tr:last-child td { border-bottom: none; }

            .vertical-outcome-list {
                display: flex;
                flex-direction: column;
                gap: 0.5rem;
            }
            .outcome-item {
                display: flex;
                align-items: center;
                font-size: 0.9rem;
                color: #334155;
            }
            .outcome-lbl {
                width: 150px;
                font-weight: 600;
                color: #64748b;
            }

            /* Badge Styles */
            .badge {
                display: inline-block;
                padding: 0.2rem 0.5rem;
                font-size: 0.75rem;
                font-weight: 700;
                border-radius: 6px;
                text-align: center;
            }
            .badge.pass { background-color: var(--success-light); color: var(--success); border: 1px solid rgba(16, 185, 129, 0.2); }
            .badge.fail { background-color: var(--danger-light); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.2); }
            .badge.error { background-color: var(--warning-light); color: var(--warning); border: 1px solid rgba(217, 119, 6, 0.2); }
            .badge.skipped { background-color: #edf2f7; color: #4a5568; border: 1px solid #cbd5e1; }

            /* Stability Tag */
            .stability-tag {
                font-size: 0.75rem;
                background-color: var(--primary-light);
                color: var(--primary);
                padding: 0.15rem 0.4rem;
                border-radius: 4px;
                font-weight: 700;
                margin-left: 0.5rem;
                font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            }

            /* Iterations Dots */
            .iter-container {
                display: inline-flex;
                gap: 3px;
                margin-left: 0.75rem;
                align-items: center;
                vertical-align: middle;
            }
            .iter-dot {
                width: 15px;
                height: 15px;
                border-radius: 50%;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                font-size: 0.6rem;
                font-weight: 700;
                cursor: help;
            }
            .iter-dot.pass { background-color: var(--success-light); color: var(--success); border: 1px solid rgba(16, 185, 129, 0.2); }
            .iter-dot.fail { background-color: var(--danger-light); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.2); }
            .iter-dot.error { background-color: var(--warning-light); color: var(--warning); border: 1px solid rgba(217, 119, 6, 0.2); }
            
            .text-warning { color: var(--warning); font-weight: 600; }

            /* Row styling for passes, failures and errors */
            .row-fail td { background-color: rgba(254, 242, 242, 0.15); }
            .row-error td { background-color: rgba(254, 243, 199, 0.1); }
            .rationales-row td { padding-top: 0; border-top: none; }
            .rationales-container {
                background-color: var(--card-bg);
                border: 1px solid rgba(239, 68, 68, 0.15);
                border-radius: 8px;
                padding: 1rem;
                margin-bottom: 0.5rem;
                font-size: 0.9rem;
            }
            .rationales-container ul { margin: 0.5rem 0 0 0; padding-left: 1.25rem; color: #475569; }
            .rationales-container li { margin-bottom: 0.4rem; }
            .rationales-container li strong { color: var(--text-main); }

            /* Case Tabs navigation classes */
            .case-tabs-header {
                display: flex;
                gap: 4px;
                margin-bottom: 0.75rem;
                border-bottom: 1px solid var(--border);
                padding-bottom: 0.35rem;
                flex-wrap: wrap;
            }
            .case-tab-btn {
                background: none;
                border: 1px solid transparent;
                padding: 0.25rem 0.5rem;
                border-radius: 6px;
                font-size: 0.72rem;
                font-weight: 600;
                color: var(--text-muted);
                cursor: pointer;
                transition: all 0.15s ease;
            }
            .case-tab-btn:hover {
                background-color: #f1f5f9;
                color: var(--text-main);
            }
            .case-tab-btn.active {
                background-color: var(--primary-light);
                border-color: rgba(37, 99, 235, 0.15);
                color: var(--primary);
            }
            .case-tab-content {
                animation: fadeIn 0.2s ease;
            }
            @keyframes fadeIn {
                from { opacity: 0; transform: translateY(2px); }
                to { opacity: 1; transform: translateY(0); }
            }
        </style>
    </head>
    <body>
        <header>
            <div>
                <a href="index.html" class="back-link">← All reports</a>
                <h1 style="text-transform: none;">Evaluation report</h1>
                <div class="timestamp">Generated at: ${humanTimestamp} | Judge system: <code>v${response.judgeVersion ?? '1.0'}</code> | Model: <code>${response.modelVersion ?? 'N/A'}</code></div>
            </div>
        </header>

        <main>
            <div class="grid-stats">
                <div class="card stat-card">
                    <span class="stat-val">${totalTests}</span>
                    <span class="stat-lbl" style="text-transform: none;">Total test cases</span>
                    <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: normal; margin-top: 0.4rem; border-top: 1px dashed #e2e8f0; padding-top: 0.4rem; letter-spacing: normal;">Running <strong>${iterationsCount}</strong> iterations for LLM judge evals</div>
                </div>
                <div class="card stat-card ${Number(casePassRate) >= 80 ? 'pass' : 'fail'}">
                    <span class="stat-val">${casePassRate}%</span>
                    <span class="stat-lbl" style="text-transform: none;">Overall case pass rate (${totalPassedCases}/${totalTests})</span>
                </div>
                <div class="card stat-card ${Number(evalPassRate) >= 80 ? 'pass' : 'fail'}">
                    <span class="stat-val">${evalPassRate}%</span>
                    <span class="stat-lbl" style="text-transform: none;">Overall evals pass rate (${passedEvalsCount}/${totalEvalsCount})</span>
                </div>
            </div>

            ${metadataHtml}

            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; margin-top: 2rem;">
                <h2 style="font-size: 1.25rem; margin: 0; font-weight: 600; color: var(--text-main);">Test/Eval results</h2>
                <div style="font-size: 0.875rem; color: var(--text-muted); background-color: var(--card-bg); border: 1px solid var(--border); padding: 0.4rem 0.8rem; border-radius: 8px; font-weight: 500;">
                    <strong>LLM judge eval stability threshold:</strong> <code class="font-mono" style="color: var(--primary); font-weight: 700;">&gt;= ${(EVALS_STABILITY_THRESHOLD * 100).toFixed(0)}%</code>
                </div>
            </div>

            <div>
                <table>
                    <thead>
                        <tr>
                            <th style="width: 16%;">TEST CASE ID</th>
                            <th style="width: 20%; max-width: 200px;">EXPECTED OUTCOME</th>
                            <th>ACTUAL OUTCOME</th>
                            <th style="width: 14%;">OVERALL STATUS</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>
            </div>
        </main>
        <script>
            function selectCaseTab(caseId, tabId) {
                // Deactivate all tab buttons for this case
                const buttons = document.querySelectorAll('.tab-btn-' + caseId);
                buttons.forEach(function(btn) {
                    btn.classList.remove('active');
                });

                // Hide all tab content areas for this case
                const contents = document.querySelectorAll('.tab-content-' + caseId);
                contents.forEach(function(content) {
                    content.style.display = 'none';
                });

                // Activate selected button
                const targetButton = document.getElementById('btn-' + caseId + '-' + tabId);
                if (targetButton) targetButton.classList.add('active');

                // Show selected content
                const targetContent = document.getElementById('content-' + caseId + '-' + tabId);
                if (targetContent) targetContent.style.display = 'block';
            }

            function togglePromptSection(element) {
                const content = element.querySelector('.collapsible-content');
                const hint = element.querySelector('.expand-hint');
                if (!content || !hint) return;
                
                const isExpanded = content.classList.toggle('expanded');
                if (isExpanded) {
                    hint.textContent = 'Click to collapse';
                } else {
                    hint.textContent = 'Click to expand';
                }
            }

            function toggleMasterConfig() {
                const drawer = document.getElementById('master-config-drawer');
                const btn = document.querySelector('.config-expand-btn');
                if (!drawer || !btn) return;
                
                const isHidden = drawer.style.display === 'none';
                if (isHidden) {
                    drawer.style.display = 'block';
                    btn.textContent = 'Hide prompt specs & instructions ▲';
                    btn.classList.add('active');
                } else {
                    drawer.style.display = 'none';
                    btn.textContent = 'View full prompts & instruction specs ▼';
                    btn.classList.remove('active');
                }
            }
        </script>
    </body>
    </html>
    `;

    fs.writeFileSync(outputPath, html);
    console.log(`Report successfully generated at ${outputPath}`);

    // Update Central Index Page
    try {
        updateIndexPage(outputDir, filename, humanTimestamp, casePassRate, totalTests, totalPassedCases, meta?.model ?? 'N/A');
    } catch (e: any) {
        console.error(`Failed to update index page: ${e.message}`);
    }

    return outputPath;

    ;
}

function renderIterBadge(evalRes?: EvalResult): string {
    if (!evalRes) {
        return `<span class="badge skipped" style="background-color: #edf2f7; color: #4a5568; border: 1px solid #cbd5e1; font-size: 0.65rem; padding: 1px 4px;">N/A</span>`;
    }

    const isSkipped = evalRes.rationale && (
        evalRes.rationale.includes('Blocked in front') ||
        evalRes.rationale.includes('N/A') ||
        evalRes.rationale.includes('Security gate triggered') ||
        evalRes.rationale.toLowerCase().includes('skipped')
    );

    if (isSkipped) {
        return `<span class="badge skipped" style="background-color: #edf2f7; color: #4a5568; border: 1px solid #cbd5e1; font-size: 0.65rem; padding: 1px 4px;">SKIPPED</span>`;
    }

    if (evalRes.label === EvalLabel.PASS) {
        return `<span class="badge pass" style="font-size: 0.65rem; padding: 1px 4px;" title="${escapeHtml(evalRes.rationale || '')}">PASS</span>`;
    } else if (evalRes.label === EvalLabel.FAIL) {
        return `<span class="badge fail" style="font-size: 0.65rem; padding: 1px 4px;" title="${escapeHtml(evalRes.rationale || '')}">FAIL</span>`;
    } else {
        return `<span class="badge error" style="font-size: 0.65rem; padding: 1px 4px;" title="${escapeHtml(evalRes.rationale || '')}">ERROR</span>`;
    }
}

function renderBadge(result: MetricResult, showStability = false): string {
    if (result.label === EvalLabel.ERROR) {
        return `<span class="badge error">ERROR</span>`;
    }

    // Check if this was short-circuited/skipped due to front-end refusal/safety blocking
    const isSkipped = result.rationale && (
        result.rationale.includes('Blocked in front') ||
        result.rationale.includes('N/A') ||
        result.rationale.includes('Security gate triggered') ||
        result.rationale.toLowerCase().includes('skipped')
    );
    if (isSkipped) {
        return `<span class="badge skipped" style="background-color: #edf2f7; color: #4a5568; border: 1px solid #cbd5e1; font-size: 0.7rem;">SKIPPED</span>`;
    }

    const isPass = result.label === EvalLabel.PASS;
    const badgeClass = isPass ? 'pass' : 'fail';
    const labelText = isPass ? 'PASS' : 'FAIL';

    let stabilityText = '';
    let iterationsText = '';
    if (showStability) {
        if (result.stabilityRate !== undefined) {
            stabilityText = `<span class="stability-tag">${(result.stabilityRate * 100).toFixed(0)}%</span>`;
        }
        if (result.evalResults && result.evalResults.length > 0) {
            const dots = result.evalResults.map((iter: any, idx: number) => {
                const title = `Iteration ${idx + 1}: ${iter.label}${iter.rationale ? ` - ${escapeHtml(iter.rationale)}` : ''}`;
                if (iter.label === EvalLabel.PASS) return `<span class="iter-dot pass" title="${title}">P</span>`;
                if (iter.label === EvalLabel.FAIL) return `<span class="iter-dot fail" title="${title}">F</span>`;
                return `<span class="iter-dot error" title="${title}">E</span>`;
            }).join('');
            iterationsText = `<div class="iter-container">${dots}</div>`;
        }
    }

    return `<span class="badge ${badgeClass}">${labelText}</span>${stabilityText}${iterationsText}`;
}

function renderRationaleLi(criterionName: string, result: MetricResult): string {
    if (result.label === EvalLabel.PASS || !result.rationale) return '';
    const isError = result.label === EvalLabel.ERROR;
    const prefix = isError ? `<span class="text-warning">[API ERROR]</span> ` : '';
    return `<li><strong>${criterionName}</strong>: ${prefix}${escapeHtml(result.rationale)}</li>`;
}

function escapeHtml(unsafe: string): string {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

interface IndexReportItem {
    filename: string;
    timestamp: string;
    passRate: string;
    totalTests: number;
    passedCount: number;
    appModel: string;
}

/**
 * Updates the centralized index.html page with the new report link.
 */
function updateIndexPage(outputDir: string, reportFilename: string, timestamp: string, passRate: string, totalTests: number, passedCount: number, appModel: string) {
    const indexPath = path.join(outputDir, 'index.html');
    const dataPath = path.join(outputDir, 'reports_data.json');

    let reports: IndexReportItem[] = [];

    if (fs.existsSync(dataPath)) {
        try {
            reports = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
        } catch (e) {
            reports = [];
        }
    }

    // Add new report to top of the list
    reports.unshift({
        filename: reportFilename,
        timestamp,
        passRate,
        totalTests,
        passedCount,
        appModel
    });

    // Cap at reasonable number of historical runs if needed, but keep all for now
    fs.writeFileSync(dataPath, JSON.stringify(reports, null, 2));

    // Generate index.html
    const rows = reports.map(r => {
        const isPass = Number(r.passRate) >= 80;
        const statusClass = isPass ? 'status-good' : 'status-bad';
        return `
            <tr>
                <td class="font-bold"><a href="${r.filename}">${r.timestamp}</a></td>
                <td><code>${r.appModel}</code></td>
                <td class="font-mono">${r.passedCount} / ${r.totalTests}</td>
                <td><span class="rate-span ${statusClass}">${r.passRate}%</span></td>
                <td><a href="${r.filename}" class="view-btn">View report →</a></td>
            </tr>
        `;
    }).join('');

    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>ThemeBuilder Evals Dashboard</title>
        <style>
            :root {
                --bg-color: #f8fafc;
                --card-bg: #ffffff;
                --text-main: #0f172a;
                --text-muted: #64748b;
                --primary: #2563eb;
                --border: #e2e8f0;
                --radius: 12px;
                --success: #10b981;
                --danger: #ef4444;
            }

            body {
                font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                background-color: var(--bg-color);
                color: var(--text-main);
                margin: 0;
                padding: 3rem 5rem;
                line-height: 1.5;
            }

            header {
                margin-bottom: 3rem;
                border-bottom: 1px solid var(--border);
                padding-bottom: 1.5rem;
            }

            h1 { margin: 0; font-size: 2.5rem; font-weight: 700; color: var(--primary); }
            .subtitle { color: var(--text-muted); margin-top: 0.5rem; font-size: 1.1rem; }

            .card {
                background-color: var(--card-bg);
                border: 1px solid var(--border);
                border-radius: var(--radius);
                box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05);
                overflow: hidden;
            }

            table { width: 100%; border-collapse: separate; border-spacing: 0; }
            th, td { padding: 1.25rem 1.5rem; text-align: left; border-bottom: 1px solid var(--border); }
            th {
                background-color: #f8fafc;
                color: var(--text-muted);
                font-weight: 600;
                font-size: 0.85rem;
                letter-spacing: 0.05em;
            }

            tr:last-child td { border-bottom: none; }
            tr:hover td { background-color: #f8fafc; }

            a { color: var(--primary); text-decoration: none; }
            a:hover { text-decoration: underline; }

            .font-bold { font-weight: 600; }
            .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.9rem; }
            
            code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.875rem; }

            .rate-span { font-weight: 700; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.95rem; }
            .rate-span.status-good { color: var(--success); }
            .rate-span.status-bad { color: var(--danger); }

            .view-btn {
                display: inline-flex;
                align-items: center;
                padding: 0.4rem 0.8rem;
                border-radius: 6px;
                background-color: var(--bg-color);
                font-size: 0.875rem;
                font-weight: 500;
                border: 1px solid var(--border);
                transition: all 0.2s;
            }
            .view-btn:hover {
                background-color: var(--primary);
                color: white;
                border-color: var(--primary);
                text-decoration: none;
            }
        </style>
    </head>
    <body>
        <header>
            <h1>ThemeBuilder Evals Dashboard</h1>
            <div class="subtitle">Evaluation runs history</div>
        </header>

        <main>
            <div class="card">
                <table>
                    <thead>
                        <tr>
                            <th>RUN TIMESTAMP</th>
                            <th>APP MODEL</th>
                            <th>PASSED CASES</th>
                            <th>PASS RATE</th>
                            <th>ACTIONS</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.length > 0 ? rows : '<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No reports generated yet.</td></tr>'}
                    </tbody>
                </table>
            </div>
        </main>
    </body>
    </html>
    `;

    fs.writeFileSync(indexPath, html);
    console.log(`Dashboard index updated at ${indexPath}`);
}
