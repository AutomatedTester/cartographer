import { AnalysisResult, GeneratedTestCase, TestPriority, DetectedWorkflow, CrawlSession } from "./types.js";

/**
 * MarkdownExporter formats analysis results and test cases into readable markdown
 */
export class MarkdownExporter {
    /**
     * Export full analysis result including test cases to markdown
     */
    static exportFull(result: AnalysisResult): string {
        const sections: string[] = [];

        // Header
        sections.push(this.formatHeader(result));

        // Executive Summary
        sections.push(this.formatExecutiveSummary(result));

        // Test Cases by Priority
        if (result.generatedTestCases && result.generatedTestCases.length > 0) {
            sections.push(this.formatTestCasesByPriority(result.generatedTestCases));
        }

        // High-Intent Elements Details
        sections.push(this.formatElementsDetail(result.highIntentElements));

        // Statistics
        sections.push(this.formatStatistics(result));

        return sections.join("\n\n");
    }

    /**
     * Export only test cases to markdown
     */
    static exportTestCases(testCases: GeneratedTestCase[]): string {
        const sections: string[] = [];

        sections.push("# Generated Test Cases\n");
        sections.push(`**Total Test Cases:** ${testCases.length}\n`);

        // Group by priority
        const byPriority = this.groupByPriority(testCases);
        const priorityOrder: TestPriority[] = ["critical", "high", "medium", "low"];

        for (const priority of priorityOrder) {
            if (byPriority[priority] && byPriority[priority].length > 0) {
                sections.push(this.formatTestCaseGroup(priority, byPriority[priority]));
            }
        }

        return sections.join("\n");
    }

    /**
     * Export test cases as a simple list for easy augmentation
     */
    static exportTestCasesList(testCases: GeneratedTestCase[]): string {
        const lines: string[] = ["# Test Cases Summary\n"];

        const byPriority = this.groupByPriority(testCases);
        const priorityOrder: TestPriority[] = ["critical", "high", "medium", "low"];

        for (const priority of priorityOrder) {
            if (byPriority[priority] && byPriority[priority].length > 0) {
                lines.push(`## ${priority.toUpperCase()} Priority (${byPriority[priority].length})\n`);
                for (const tc of byPriority[priority]) {
                    lines.push(`- **${tc.name}**`);
                    lines.push(`  - Locator: \`${tc.locator}\``);
                    lines.push(`  - Type: ${tc.actionType}`);
                    lines.push(`  - Score: ${tc.intentScore}`);
                    lines.push("");
                }
            }
        }

        return lines.join("\n");
    }

    private static formatHeader(result: AnalysisResult): string {
        return `# Test Analysis Report: ${result.title || "Unnamed Page"}

**URL:** ${result.url}
**Generated:** ${new Date().toISOString()}
`;
    }

    private static formatExecutiveSummary(result: AnalysisResult): string {
        const elementCount = result.highIntentElements.length;
        const testCount = result.generatedTestCases?.length || 0;
        const avgScore =
            elementCount > 0
                ? Math.round(
                    result.highIntentElements.reduce((sum, el) => sum + el.intentScore, 0) /
                    elementCount
                )
                : 0;

        return `## Executive Summary

- **Total Elements Analyzed:** ${elementCount}
- **Auto-Generated Test Cases:** ${testCount}
- **Average Intent Score:** ${avgScore}/100
- **Page Title:** ${result.title}

This report identifies high-intent user interaction points and generates starter test cases that can be customized and extended.
`;
    }

    private static formatTestCasesByPriority(testCases: GeneratedTestCase[]): string {
        const lines: string[] = ["## Generated Test Cases\n"];

        const byPriority = this.groupByPriority(testCases);
        const priorityOrder: TestPriority[] = ["critical", "high", "medium", "low"];

        const summary = priorityOrder
            .filter((p) => byPriority[p].length > 0)
            .map((p) => `**${p.toUpperCase()}:** ${byPriority[p].length}`)
            .join(" | ");

        lines.push(summary);
        lines.push("");

        for (const priority of priorityOrder) {
            if (byPriority[priority] && byPriority[priority].length > 0) {
                lines.push(this.formatTestCaseGroup(priority, byPriority[priority]));
            }
        }

        return lines.join("\n");
    }

    private static formatTestCaseGroup(
        priority: TestPriority,
        testCases: GeneratedTestCase[]
    ): string {
        const lines: string[] = [];
        const priorityLabel = priority.toUpperCase();
        const emoji = this.getPriorityEmoji(priority);

        lines.push(`### ${emoji} ${priorityLabel} Priority (${testCases.length})\n`);

        for (let i = 0; i < testCases.length; i++) {
            const tc = testCases[i];
            lines.push(`#### ${i + 1}. ${tc.name}`);
            lines.push("");
            lines.push(`**ID:** \`${tc.id}\``);
            lines.push(`**Type:** ${tc.actionType}`);
            lines.push(`**Intent Score:** ${tc.intentScore}/100`);
            lines.push(`**Locator:** \`${tc.locator}\``);
            lines.push("");

            lines.push("**Description:**");
            lines.push(tc.description);
            lines.push("");

            if (tc.preconditions.length > 0) {
                lines.push("**Preconditions:**");
                for (const pre of tc.preconditions) {
                    lines.push(`- ${pre}`);
                }
                lines.push("");
            }

            lines.push("**Test Steps:**");
            for (let j = 0; j < tc.steps.length; j++) {
                lines.push(`${j + 1}. ${tc.steps[j]}`);
            }
            lines.push("");

            lines.push("**Expected Results:**");
            for (const result of tc.expectedResults) {
                lines.push(`- ${result}`);
            }
            lines.push("");

            if (tc.tags.length > 0) {
                const tagStr = tc.tags.map((t) => `\`${t}\``).join(" ");
                lines.push(`**Tags:** ${tagStr}`);
                lines.push("");
            }
        }

        return lines.join("\n");
    }

    private static formatElementsDetail(elements: any[]): string {
        const lines: string[] = ["## Analyzed Elements\n"];

        const grouped: Record<string, any[]> = {};
        for (const el of elements) {
            if (!grouped[el.tag]) {
                grouped[el.tag] = [];
            }
            grouped[el.tag].push(el);
        }

        for (const [tag, elements] of Object.entries(grouped)) {
            lines.push(`### ${tag.toUpperCase()} Elements (${elements.length})\n`);

            for (const el of elements) {
                const label = el.text || el.ariaLabel || el.id || "[no label]";
                lines.push(`- **${label}**`);
                lines.push(`  - Locator: \`${el.locator}\``);
                lines.push(`  - Intent Score: ${el.intentScore}`);
                if (el.navigationTarget) {
                    lines.push(`  - Navigates to: \`${el.navigationTarget}\``);
                }
                if (el.intentReasons && el.intentReasons.length > 0) {
                    lines.push(`  - Reasons: ${el.intentReasons.join(", ")}`);
                }
            }
            lines.push("");
        }

        return lines.join("\n");
    }

    private static formatStatistics(result: AnalysisResult): string {
        const elements = result.highIntentElements;
        const testCases = result.generatedTestCases || [];

        const byTag: Record<string, number> = {};
        for (const el of elements) {
            byTag[el.tag] = (byTag[el.tag] || 0) + 1;
        }

        const byAction: Record<string, number> = {};
        for (const tc of testCases) {
            byAction[tc.actionType] = (byAction[tc.actionType] || 0) + 1;
        }

        const lines: string[] = ["## Statistics\n"];

        lines.push("### Elements by Tag");
        for (const [tag, count] of Object.entries(byTag).sort()) {
            lines.push(`- ${tag}: ${count}`);
        }
        lines.push("");

        if (Object.keys(byAction).length > 0) {
            lines.push("### Test Cases by Action Type");
            for (const [action, count] of Object.entries(byAction).sort()) {
                lines.push(`- ${action}: ${count}`);
            }
            lines.push("");
        }

        // Score distribution
        const scores = elements.map((e) => e.intentScore);
        lines.push("### Score Distribution");
        lines.push(`- Min: ${Math.min(...scores)}`);
        lines.push(`- Max: ${Math.max(...scores)}`);
        lines.push(
            `- Average: ${Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)}`
        );

        return lines.join("\n");
    }

    private static groupByPriority(
        testCases: GeneratedTestCase[]
    ): Record<TestPriority, GeneratedTestCase[]> {
        return {
            critical: testCases.filter((tc) => tc.priority === "critical"),
            high: testCases.filter((tc) => tc.priority === "high"),
            medium: testCases.filter((tc) => tc.priority === "medium"),
            low: testCases.filter((tc) => tc.priority === "low"),
        };
    }

    private static getPriorityEmoji(priority: TestPriority): string {
        const emojis: Record<TestPriority, string> = {
            critical: "🔴",
            high: "🟠",
            medium: "🟡",
            low: "🟢",
        };
        return emojis[priority];
    }

    /**
     * Export detected workflows from a crawl session
     */
    static exportDetectedWorkflows(workflows: DetectedWorkflow[]): string {
        const sections: string[] = [];

        sections.push("# Detected Workflows\n");
        sections.push(`**Total Workflows Found:** ${workflows.length}\n`);

        if (workflows.length === 0) {
            sections.push("No workflows detected in this crawl session.\n");
            return sections.join("\n");
        }

        // Group by workflow type
        const byType: Record<string, DetectedWorkflow[]> = {};
        for (const workflow of workflows) {
            const type = workflow.tags?.[0] || "unknown";
            if (!byType[type]) {
                byType[type] = [];
            }
            byType[type].push(workflow);
        }

        // Summary statistics
        sections.push("## Workflow Summary\n");
        for (const [type, workflowsOfType] of Object.entries(byType)) {
            const avgConfidence = Math.round(
                workflowsOfType.reduce((sum, w) => sum + w.confidence, 0) / workflowsOfType.length
            );
            sections.push(`- **${type}:** ${workflowsOfType.length} workflows (avg confidence: ${avgConfidence}%)`);
        }
        sections.push("");

        // Detailed workflow descriptions
        sections.push("## Detailed Workflows\n");
        for (const workflow of workflows) {
            sections.push(this.formatWorkflowDetail(workflow));
        }

        return sections.join("\n");
    }

    /**
     * Export workflow visualization as ASCII flow diagrams
     */
    static exportWorkflowSequence(workflow: DetectedWorkflow): string {
        const lines: string[] = [];

        lines.push(`# Workflow: ${workflow.name}\n`);
        lines.push(`**Confidence:** ${workflow.confidence}%`);
        lines.push(`**ID:** \`${workflow.id}\``);
        if (workflow.tags && workflow.tags.length > 0) {
            lines.push(`**Tags:** ${workflow.tags.map((t) => `\`${t}\``).join(" ")}`);
        }
        lines.push("");

        // Page sequence visualization
        if (workflow.pageSequence && workflow.pageSequence.length > 0) {
            lines.push("## Page Sequence\n");
            lines.push("```");
            const sequence = workflow.pageSequence
                .map((url, idx) => `${idx + 1}. ${this.extractPathFromUrl(url)}`)
                .join("\n     ↓\n");
            lines.push(sequence);
            lines.push("```");
            lines.push("");
        }

        // Action sequence
        if (workflow.actionSequence && workflow.actionSequence.length > 0) {
            lines.push("## Actions Performed\n");
            for (let i = 0; i < workflow.actionSequence.length; i++) {
                const action = workflow.actionSequence[i];
                lines.push(`${i + 1}. **${action.actionType}**: on ${this.extractPathFromUrl(action.pageUrl)}`);
                lines.push(`   - Locator: ${action.elementLocator}`);
                if (action.resultingNavigation) {
                    lines.push(`   - Navigates to: ${action.resultingNavigation}`);
                }
                if (action.actionData && Object.keys(action.actionData).length > 0) {
                    lines.push(`   - Data: ${JSON.stringify(action.actionData)}`);
                }
            }
            lines.push("");
        }

        // State transitions
        if (workflow.stateTransitions && workflow.stateTransitions.length > 0) {
            lines.push("## State Transitions\n");
            for (const transition of workflow.stateTransitions) {
                lines.push(`- **${this.extractPathFromUrl(transition.fromPage)}** → **${this.extractPathFromUrl(transition.toPage)}**`);
                lines.push(`  - Action: ${transition.action.actionType} on ${transition.action.elementLocator}`);
                if (transition.stateChanges && Object.keys(transition.stateChanges).length > 0) {
                    lines.push(`  - State Changes: ${JSON.stringify(transition.stateChanges)}`);
                }
            }
            lines.push("");
        }

        return lines.join("\n");
    }

    /**
     * Export workflow comparison for multiple workflows
     */
    static exportWorkflowComparison(workflows: DetectedWorkflow[]): string {
        const lines: string[] = [];

        lines.push("# Workflow Comparison\n");
        lines.push(`**Workflows Compared:** ${workflows.length}\n`);

        // Create comparison table
        lines.push("| Workflow | Type | Pages | Actions | Confidence |");
        lines.push("|----------|------|-------|---------|------------|");

        for (const workflow of workflows) {
            const type = workflow.tags?.[0] || "unknown";
            const pages = workflow.pageSequence?.length || 0;
            const actions = workflow.actionSequence?.length || 0;
            const confidence = `${workflow.confidence}%`;
            lines.push(
                `| ${workflow.name} | ${type} | ${pages} | ${actions} | ${confidence} |`
            );
        }
        lines.push("");

        // Find common patterns
        if (workflows.length > 1) {
            lines.push("## Common Patterns\n");

            // Check for same page sequences
            const pageSequences = workflows.map(w => w.pageSequence?.join(" → ") || "");
            const duplicatePageSequences = pageSequences.filter(
                (seq, idx) => pageSequences.indexOf(seq) !== idx
            );

            if (duplicatePageSequences.length > 0) {
                lines.push("- **Duplicate Page Sequences Detected:**");
                const unique = [...new Set(duplicatePageSequences)];
                for (const seq of unique) {
                    lines.push(`  - ${seq}`);
                }
                lines.push("");
            }

            // Check for similar action types
            const allActionTypes = new Set<string>();
            for (const workflow of workflows) {
                workflow.actionSequence?.forEach((action) => {
                    allActionTypes.add(action.actionType);
                });
            }

            if (allActionTypes.size > 0) {
                lines.push("- **Common Action Types:**");
                for (const actionType of allActionTypes) {
                    const count = workflows.filter(w =>
                        w.actionSequence?.some(a => a.actionType === actionType)
                    ).length;
                    lines.push(`  - ${actionType} (in ${count}/${workflows.length} workflows)`);
                }
                lines.push("");
            }
        }

        return lines.join("\n");
    }

    /**
     * Format individual workflow details
     */
    private static formatWorkflowDetail(workflow: DetectedWorkflow): string {
        const lines: string[] = [];

        lines.push(`### ${workflow.name}`);
        lines.push("");
        lines.push(`**ID:** \`${workflow.id}\``);
        lines.push(`**Confidence:** ${workflow.confidence}%`);

        if (workflow.tags && workflow.tags.length > 0) {
            lines.push(`**Tags:** ${workflow.tags.map((t) => `\`${t}\``).join(" ")}`);
        }

        if (workflow.pageSequence && workflow.pageSequence.length > 0) {
            lines.push("");
            lines.push("**Pages:**");
            for (let i = 0; i < workflow.pageSequence.length; i++) {
                const url = workflow.pageSequence[i];
                lines.push(`${i + 1}. ${url}`);
            }
        }

        if (workflow.actionSequence && workflow.actionSequence.length > 0) {
            lines.push("");
            lines.push("**Actions:**");
            for (let i = 0; i < workflow.actionSequence.length; i++) {
                const action = workflow.actionSequence[i];
                lines.push(`${i + 1}. ${action.actionType} on ${this.extractPathFromUrl(action.pageUrl)}`);
            }
        }

        lines.push("");
        return lines.join("\n");
    }

    /**
     * Extract path from full URL
     */
    private static extractPathFromUrl(url: string): string {
        try {
            const urlObj = new URL(url);
            return urlObj.pathname || "/";
        } catch {
            return url;
        }
    }
}
