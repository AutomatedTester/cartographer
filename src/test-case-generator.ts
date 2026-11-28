import { HighIntentElement, GeneratedTestCase, TestPriority } from "./types.js";
import { SemanticToolGenerator } from "./webmcp-semantic-tools.js";

/**
 * TestCaseGenerator creates structured test cases from high-intent DOM elements.
 * Generates context-aware test steps based on element type and attributes.
 * Now includes semantic webmcp tool references for browser-side execution.
 */
export class TestCaseGenerator {
    /**
     * Generate test cases from high-intent elements
     * @param elements Array of high-intent elements
     * @param pageTitle Title of the page being tested
     * @returns Array of generated test cases
     */
    static generate(
        elements: HighIntentElement[],
        pageTitle: string
    ): GeneratedTestCase[] {
        // Resolve tool names through the same collision-aware path the handler
        // generator uses, so a critical test case never references a tool name
        // that was suffixed away during registration.
        const critical = SemanticToolGenerator.selectCritical(elements);
        const uniqueNames = SemanticToolGenerator.generateUniqueToolNames(critical);
        const toolNameByElement = new Map<HighIntentElement, string>();
        critical.forEach((el, i) => toolNameByElement.set(el, uniqueNames[i]));

        return elements.map((el, idx) =>
            this.generateFromElement(el, pageTitle, idx, toolNameByElement.get(el))
        );
    }

    /**
     * Build a stable test ID containing only [A-Z0-9_].
     *
     * Page titles are free text ("BenchmarkShop | BenchmarkShop"), so they are
     * reduced to upper-case alphanumeric words joined by single underscores,
     * with immediately repeated words dropped. That turns the title above into
     * BENCHMARKSHOP rather than BENCHMARKSHOP_|_BENCHMARKSHOP.
     */
    static buildTestId(pageTitle: string, tag: string, ordinal: number): string {
        const words = (text: string): string[] =>
            (text || "")
                .toUpperCase()
                .split(/[^A-Z0-9]+/)
                .filter((w) => w.length > 0);

        const titleWords = words(pageTitle).filter(
            (w, i, all) => i === 0 || w !== all[i - 1]
        );
        const parts = ["TC", ...titleWords, ...words(tag), String(ordinal)];
        return parts.join("_");
    }

    /**
     * Convert intent score (0-100) to priority level
     */
    private static getPriority(intentScore: number): TestPriority {
        if (intentScore >= 50) return "critical";
        if (intentScore >= 40) return "high";
        if (intentScore >= 30) return "medium";
        return "low";
    }

    /**
     * Determine action type from element properties
     */
    private static getActionType(
        el: HighIntentElement
    ): "click" | "input" | "submit" | "navigate" | "delete" | "select" | "hover" {
        const { tag, role, ariaLabel, attributes } = el;
        const type = attributes?.type || "";
        const ariaLabelLower = (ariaLabel || "").toLowerCase();

        if (ariaLabelLower.includes("delete")) return "delete";
        if (tag === "input" && ["email", "text", "password", "search"].includes(type))
            return "input";
        if (tag === "select") return "select";
        if (tag === "form") return "submit";
        if (tag === "textarea") return "input";
        if (
            tag === "button" &&
            type === "submit" &&
            el.path.includes("form")
        ) {
            return "submit";
        }
        if (tag === "a" || (el.navigationTarget && tag !== "button")) {
            return "navigate";
        }
        if (role === "checkbox" || role === "radio") return "click";
        if (ariaLabelLower.includes("hover") || role === "menuitem") return "hover";

        return "click"; // default
    }

    /**
     * Generate test case for a single element
     */
    private static generateFromElement(
        el: HighIntentElement,
        pageTitle: string,
        index: number,
        semanticToolName?: string
    ): GeneratedTestCase {
        const actionType = this.getActionType(el);
        const priority = this.getPriority(el.intentScore);
        const id = this.buildTestId(pageTitle, el.tag, index + 1);

        // Generate element-specific test content
        let name: string;
        let description: string;
        let steps: string[];
        let expectedResults: string[];
        let preconditions: string[];

        switch (actionType) {
            case "navigate":
                ({ name, description, steps, expectedResults, preconditions } =
                    this.generateNavigationTest(el));
                break;
            case "submit":
                ({ name, description, steps, expectedResults, preconditions } =
                    this.generateSubmitTest(el));
                break;
            case "input":
                ({ name, description, steps, expectedResults, preconditions } =
                    this.generateInputTest(el));
                break;
            case "select":
                ({ name, description, steps, expectedResults, preconditions } =
                    this.generateSelectTest(el));
                break;
            case "delete":
                ({ name, description, steps, expectedResults, preconditions } =
                    this.generateDeleteTest(el));
                break;
            case "hover":
                ({ name, description, steps, expectedResults, preconditions } =
                    this.generateHoverTest(el));
                break;
            default:
                ({ name, description, steps, expectedResults, preconditions } =
                    this.generateClickTest(el));
        }

        const tags = this.generateTags(el, actionType);

        // Generate semantic tool reference and test code for critical tests
        let semanticTool: string | undefined;
        let testCode: string | undefined;
        
        if (priority === "critical") {
            semanticTool =
                semanticToolName ?? SemanticToolGenerator.generateToolName(el);
            testCode = this.generateTestCode(semanticTool);
        }

        return {
            id,
            name,
            description,
            priority,
            actionType,
            locator: el.locator,
            preconditions,
            steps,
            expectedResults,
            intentScore: el.intentScore,
            tags,
            sourceElement: el,
            semanticTool,
            testCode,
        };
    }

    private static generateClickTest(
        el: HighIntentElement
    ): Omit<
        GeneratedTestCase,
        "id" | "priority" | "actionType" | "locator" | "intentScore" | "tags" | "sourceElement"
    > {
        const text = el.text || el.ariaLabel || el.id || "element";
        return {
            name: `Verify "${text}" button is clickable`,
            description: `Test that the "${text}" button can be interacted with and responds to clicks`,
            preconditions: ["Page has loaded", `"${text}" button is visible`],
            steps: [
                `Locate the "${text}" button using locator: ${el.locator}`,
                "Click the button",
                "Observe the page response",
            ],
            expectedResults: [
                `Button is found using locator: ${el.locator}`,
                "Button click is successful (no JavaScript errors)",
                "Page responds appropriately to the click",
            ],
        };
    }

    private static generateNavigationTest(
        el: HighIntentElement
    ): Omit<
        GeneratedTestCase,
        "id" | "priority" | "actionType" | "locator" | "intentScore" | "tags" | "sourceElement"
    > {
        const text = el.text || el.ariaLabel || el.id || "link";
        const target = el.navigationTarget || "target page";
        return {
            name: `Verify navigation via "${text}" link`,
            description: `Test that clicking "${text}" navigates to ${target}`,
            preconditions: ["Page has loaded", `"${text}" link is visible`],
            steps: [
                `Locate the "${text}" link using locator: ${el.locator}`,
                "Click the link",
                "Wait for navigation to complete",
                "Capture the new URL",
            ],
            expectedResults: [
                `Navigation link is found using locator: ${el.locator}`,
                `Navigation occurs to: ${target}`,
                `URL changes from current page to ${target}`,
                "Page content updates with new page data",
            ],
        };
    }

    private static generateSubmitTest(
        el: HighIntentElement
    ): Omit<
        GeneratedTestCase,
        "id" | "priority" | "actionType" | "locator" | "intentScore" | "tags" | "sourceElement"
    > {
        const text = el.text || "Submit";
        return {
            name: `Verify form submission via "${text}" button`,
            description: `Test that the form can be submitted using the "${text}" button`,
            preconditions: ["Page has loaded", "Form is visible", "Form fields are accessible"],
            steps: [
                "Verify all required form fields are present",
                "Fill required form fields with valid test data",
                `Locate the "${text}" button using locator: ${el.locator}`,
                `Click the "${text}" button to submit the form`,
                "Observe the form submission response",
            ],
            expectedResults: [
                `"${text}" button is found and is clickable`,
                "Form data is submitted successfully",
                "No validation errors appear",
                "Page redirects or shows success message",
            ],
        };
    }

    private static generateInputTest(
        el: HighIntentElement
    ): Omit<
        GeneratedTestCase,
        "id" | "priority" | "actionType" | "locator" | "intentScore" | "tags" | "sourceElement"
    > {
        const placeholder = el.attributes?.placeholder || "input field";
        const type = el.attributes?.type || "text";
        return {
            name: `Verify ${type} input field "${placeholder}" accepts user input`,
            description: `Test that the ${type} input field accepts and retains user input`,
            preconditions: ["Page has loaded", `Input field "${placeholder}" is visible`],
            steps: [
                `Locate the input field using locator: ${el.locator}`,
                `Click the input field to focus it`,
                `Enter test data appropriate for ${type} field`,
                "Verify the input retains the entered value",
            ],
            expectedResults: [
                `Input field is found using locator: ${el.locator}`,
                "Input field is focusable",
                `Test data is successfully entered into the field`,
                "Field does not clear unexpectedly",
                "Field shows the entered value correctly",
            ],
        };
    }

    private static generateSelectTest(
        el: HighIntentElement
    ): Omit<
        GeneratedTestCase,
        "id" | "priority" | "actionType" | "locator" | "intentScore" | "tags" | "sourceElement"
    > {
        const label = el.ariaLabel || el.text || "dropdown";
        return {
            name: `Verify select/dropdown "${label}" can be changed`,
            description: `Test that the "${label}" dropdown allows selection of options`,
            preconditions: ["Page has loaded", `Select element "${label}" is visible`],
            steps: [
                `Locate the select element using locator: ${el.locator}`,
                "Click to open the dropdown menu",
                "Select an available option",
                "Verify the selection is retained",
            ],
            expectedResults: [
                `Select element is found using locator: ${el.locator}`,
                "Dropdown opens and displays options",
                "Options are selectable",
                "Selection is retained and visible in the field",
                "Page updates appropriately after selection",
            ],
        };
    }

    private static generateDeleteTest(
        el: HighIntentElement
    ): Omit<
        GeneratedTestCase,
        "id" | "priority" | "actionType" | "locator" | "intentScore" | "tags" | "sourceElement"
    > {
        return {
            name: `Verify delete/remove action can be triggered`,
            description: `Test that the delete/remove button functions correctly`,
            preconditions: [
                "Page has loaded",
                "Item to be deleted is present",
                "Delete button is visible",
            ],
            steps: [
                `Locate the delete button using locator: ${el.locator}`,
                "Click the delete button",
                "Handle any confirmation dialogs if present",
                "Verify the item is removed",
            ],
            expectedResults: [
                `Delete button is found using locator: ${el.locator}`,
                "Delete action completes successfully",
                "Item is removed from the page",
                "No error messages appear",
                "Page updates appropriately after deletion",
            ],
        };
    }

    private static generateHoverTest(
        el: HighIntentElement
    ): Omit<
        GeneratedTestCase,
        "id" | "priority" | "actionType" | "locator" | "intentScore" | "tags" | "sourceElement"
    > {
        const text = el.text || el.ariaLabel || "element";
        return {
            name: `Verify hover action on "${text}"`,
            description: `Test that hovering over "${text}" triggers expected behavior`,
            preconditions: ["Page has loaded", `Element "${text}" is visible`],
            steps: [
                `Locate the element using locator: ${el.locator}`,
                "Move mouse to hover over the element",
                "Observe any tooltips, menus, or style changes",
                "Move mouse away to verify state change",
            ],
            expectedResults: [
                `Element is found using locator: ${el.locator}`,
                "Hover state is triggered",
                "Tooltip, submenu, or visual change appears",
                "Hover state is removed when mouse leaves",
            ],
        };
    }

    private static generateTags(
        el: HighIntentElement,
        actionType: string
    ): string[] {
        const tags: Set<string> = new Set([
            actionType,
            el.tag,
            el.navigates ? "navigation" : "interaction",
        ]);

        if (el.intentScore >= 50) tags.add("high-priority");
        if (el.role) tags.add(`aria:${el.role}`);

        const ariaLabel = (el.ariaLabel || "").toLowerCase();
        if (ariaLabel.includes("delete")) tags.add("destructive");
        if (ariaLabel.includes("search")) tags.add("search");
        if (ariaLabel.includes("submit")) tags.add("form");

        if (el.attributes?.type) tags.add(`input:${el.attributes.type}`);

        return Array.from(tags);
    }

    /**
     * Generate executable test code that calls a semantic webmcp tool
     */
    private static generateTestCode(toolName: string): string {
        // Bracket notation with a JSON-escaped key: tool names derive from page
        // content, so dot access could emit invalid syntax for a name that is
        // not a bare identifier.
        return `
async function test() {
  const result = await navigator.webmcp.tools[${JSON.stringify(toolName)}]();
  if (!result.success) throw new Error(result.message);
  return { success: true, message: "Test passed", duration: result.duration };
}
`.trim();
    }
}
