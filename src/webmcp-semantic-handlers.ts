import { HighIntentElement } from "./types.js";
import { SemanticToolGenerator } from "./webmcp-semantic-tools.js";

/**
 * SemanticHandlerGenerator creates executable handler code for semantic tools.
 * The generated code runs in the browser and uses native DOM APIs.
 */
export class SemanticHandlerGenerator {
  /**
   * Generate handler code that registers semantic tools to navigator.webmcp.tools
   * This code is meant to be injected into the browser context.
   *
   * @param elements Array of high-intent elements
   * @returns JavaScript code as a string that registers all handlers
   */
  static generateHandlerCode(elements: HighIntentElement[]): string {
    const criticalElements = elements.filter((el) => el.intentScore >= 50);
    const toolSchemas = SemanticToolGenerator.generate(elements);

    // Generate individual handler functions
    const handlerFunctions = criticalElements
      .map((el) => this.generateHandlerFunction(el))
      .join("\n\n");

    // Generate the tool registration code
    const registrationCode = `
// Initialize navigator.webmcp if not already present
if (!navigator.webmcp) {
  navigator.webmcp = {};
}
if (!navigator.webmcp.tools) {
  navigator.webmcp.tools = {};
}

// Register semantic tool handlers
${handlerFunctions}

// Export tool names for verification
navigator.webmcp.registeredTools = [
  ${toolSchemas
    .map((schema) => `"${schema.name}"`)
    .join(",\n  ")}
];

console.log('[webmcp] Registered tools:', navigator.webmcp.registeredTools);
`;

    return registrationCode;
  }

  /**
   * Generate an individual handler function for a semantic tool
   */
  private static generateHandlerFunction(element: HighIntentElement): string {
    const toolName = SemanticToolGenerator.generateToolName(element);
    const actionType = this.inferActionType(element);

    // Generate the handler body based on action type
    let handlerBody: string;

    switch (actionType) {
      case "input":
        handlerBody = this.generateInputHandler(element);
        break;
      case "navigate":
        handlerBody = this.generateNavigateHandler(element);
        break;
      case "submit":
        handlerBody = this.generateSubmitHandler(element);
        break;
      case "select":
        handlerBody = this.generateSelectHandler(element);
        break;
      case "delete":
        handlerBody = this.generateDeleteHandler(element);
        break;
      case "click":
      default:
        handlerBody = this.generateClickHandler(element);
    }

    return `
navigator.webmcp.tools.${toolName} = async function(params = {}) {
  const startTime = performance.now();
  try {
    ${handlerBody}
    return {
      success: true,
      message: "Tool executed successfully",
      duration: Math.round(performance.now() - startTime)
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
      duration: Math.round(performance.now() - startTime)
    };
  }
};`;
  }

  /**
   * Generate handler code for click actions
   */
  private static generateClickHandler(element: HighIntentElement): string {
    return `
    const el = document.querySelector('${element.locator}');
    if (!el) throw new Error('Element not found: ${element.locator}');
    if (!(el instanceof Element)) throw new Error('Not a valid DOM element');
    el.click();
    await new Promise(resolve => setTimeout(resolve, 100));`;
  }

  /**
   * Generate handler code for input actions
   */
  private static generateInputHandler(element: HighIntentElement): string {
    return `
    const el = document.querySelector('${element.locator}');
    if (!el) throw new Error('Element not found: ${element.locator}');
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      throw new Error('Element is not an input or textarea');
    }
    if (params.value) {
      el.value = params.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    el.focus();
    await new Promise(resolve => setTimeout(resolve, 100));`;
  }

  /**
   * Generate handler code for navigate actions
   */
  private static generateNavigateHandler(element: HighIntentElement): string {
    const timeout = "params.timeout || 5000";
    return `
    const el = document.querySelector('${element.locator}');
    if (!el) throw new Error('Element not found: ${element.locator}');
    const initialUrl = window.location.href;
    el.click();
    
    // Wait for navigation or timeout
    const startTime = Date.now();
    while (window.location.href === initialUrl && Date.now() - startTime < ${timeout}) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    if (window.location.href === initialUrl) {
      throw new Error('Navigation did not occur within timeout');
    }`;
  }

  /**
   * Generate handler code for submit actions
   */
  private static generateSubmitHandler(element: HighIntentElement): string {
    return `
    const el = document.querySelector('${element.locator}');
    if (!el) throw new Error('Element not found: ${element.locator}');
    
    // Find the closest form if element is inside one
    let form = el.closest('form');
    if (!form && el instanceof HTMLFormElement) {
      form = el;
    }
    
    if (form) {
      form.submit();
    } else {
      el.click();
    }
    
    // Wait for potential page load or response
    await new Promise(resolve => setTimeout(resolve, 500));`;
  }

  /**
   * Generate handler code for select actions
   */
  private static generateSelectHandler(element: HighIntentElement): string {
    return `
    const el = document.querySelector('${element.locator}');
    if (!el) throw new Error('Element not found: ${element.locator}');
    if (!(el instanceof HTMLSelectElement)) {
      throw new Error('Element is not a select element');
    }
    
    if (params.optionValue) {
      el.value = params.optionValue;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // Select first available option if no value specified
      const options = el.querySelectorAll('option');
      if (options.length > 1) {
        el.value = options[1].value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    await new Promise(resolve => setTimeout(resolve, 100));`;
  }

  /**
   * Generate handler code for delete actions
   */
  private static generateDeleteHandler(element: HighIntentElement): string {
    return `
    const el = document.querySelector('${element.locator}');
    if (!el) throw new Error('Element not found: ${element.locator}');
    
    // Check if element is disabled or hidden
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') {
      throw new Error('Delete button is hidden or not visible');
    }
    if (el instanceof HTMLElement && el.hasAttribute('disabled')) {
      throw new Error('Delete button is disabled');
    }
    
    el.click();
    
    // Wait for any potential confirmation or state change
    await new Promise(resolve => setTimeout(resolve, 200));`;
  }

  /**
   * Infer action type from element
   */
  private static inferActionType(
    element: HighIntentElement
  ): "click" | "input" | "submit" | "navigate" | "delete" | "select" | "hover" {
    const { tag, role, ariaLabel, attributes } = element;
    const type = attributes?.type || "";
    const ariaLabelLower = (ariaLabel || "").toLowerCase();

    if (ariaLabelLower.includes("delete")) return "delete";
    if (tag === "input" && ["email", "text", "password", "search"].includes(type))
      return "input";
    if (tag === "select") return "select";
    if (tag === "textarea") return "input";
    if (tag === "button" && type === "submit") return "submit";
    if (tag === "a" || element.navigationTarget) return "navigate";
    if (role === "checkbox" || role === "radio") return "click";
    if (ariaLabelLower.includes("hover") || role === "menuitem") return "hover";

    return "click";
  }
}
