import { HighIntentElement, SemanticToolSchema } from "./types.js";

/**
 * SemanticToolGenerator creates semantic webmcp tool definitions from high-intent elements.
 * Each high-intent element becomes a reusable tool with a domain-specific name and action.
 */
export class SemanticToolGenerator {
  /**
   * Generate semantic tool schemas from high-intent elements
   * @param elements Array of high-intent elements (filtered to critical only)
   * @returns Array of semantic tool schemas
   */
  static generate(elements: HighIntentElement[]): SemanticToolSchema[] {
    const critical = this.selectCritical(elements);
    const names = this.generateUniqueToolNames(critical);
    return critical.map((el, i) => this.generateToolSchema(el, names[i]));
  }

  /**
   * The elements that become tools. Shared with SemanticHandlerGenerator so
   * schemas and handlers always describe the same set in the same order.
   */
  static selectCritical(elements: HighIntentElement[]): HighIntentElement[] {
    return elements.filter((el) => el.intentScore >= 50);
  }

  /**
   * Derive tool names for a list of elements, disambiguating collisions.
   *
   * Two elements can easily reduce to the same name (two "Login" buttons, say).
   * Without a suffix the second handler silently overwrites the first and the
   * page ends up with fewer tools than elements.
   */
  static generateUniqueToolNames(elements: HighIntentElement[]): string[] {
    const used = new Map<string, number>();
    return elements.map((el) => {
      const base = this.generateToolName(el);
      const seen = used.get(base) ?? 0;
      used.set(base, seen + 1);
      return seen === 0 ? base : `${base}${seen + 1}`;
    });
  }

  /**
   * Generate a single semantic tool schema from an element
   */
  private static generateToolSchema(
    element: HighIntentElement,
    toolName: string = this.generateToolName(element)
  ): SemanticToolSchema {
    const description = this.generateToolDescription(element);
    const inputSchema = this.generateInputSchema(element);

    return {
      name: toolName,
      description,
      actionType: this.inferActionType(element),
      inputSchema,
      returnType: "{ success: boolean; message: string; payload?: any }",
    };
  }

  /**
   * Generate a semantic tool name from element properties
   * E.g., "Search button" → "search", "Subscribe to Newsletter" → "subscribeToNewsletter"
   */
  static generateToolName(element: HighIntentElement): string {
    // Prefer aria-label, then text content, then id
    let baseName = element.ariaLabel || element.text || element.id || element.tag;

    // Remove common suffix words and clean up
    baseName = baseName
      .toLowerCase()
      .replace(/\s*button\s*/i, "") // Remove "button"
      .replace(/\s*link\s*/i, "") // Remove "link"
      .replace(/\s*field\s*/i, "") // Remove "field"
      .trim()
      .replace(/\s+/g, " ") // Normalize whitespace
      .split(" ")
      .filter((word) => word.length > 0)
      .join(" ");

    // Convert to camelCase
    const camel = baseName
      .split(/\s+/)
      .map((word, idx) =>
        idx === 0
          ? word.toLowerCase()
          : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      )
      .join("")
      .replace(/[^a-zA-Z0-9]/g, ""); // Remove any special characters

    // Stripping non-alphanumerics can empty the name entirely (an icon-only
    // button labelled "→", for example). An empty name would emit
    // `navigator.webmcp.tools. = ...`, a syntax error that breaks every tool
    // in the injected script, so fall back to something always usable.
    if (camel.length > 0) return camel;
    const tagFallback = (element.tag || "").replace(/[^a-zA-Z0-9]/g, "");
    return tagFallback.length > 0 ? tagFallback.toLowerCase() : "element";
  }

  /**
   * Generate a human-readable description of what the tool does
   */
  private static generateToolDescription(element: HighIntentElement): string {
    const action = this.inferActionDescription(element);
    const element_desc = element.ariaLabel || element.text || `the ${element.tag}`;
    return `Execute the ${action} action on ${element_desc}`;
  }

  /**
   * Generate input schema for the tool based on action type
   */
  private static generateInputSchema(element: HighIntentElement): Record<string, unknown> {
    const actionType = this.inferActionType(element);

    const baseSchema: Record<string, unknown> = {
      type: "object",
      properties: {},
      required: [],
    };

    // Add action-specific parameters
    switch (actionType) {
      case "input":
        return {
          type: "object",
          properties: {
            value: {
              type: "string",
              description: "Value to input into the field",
            },
          },
          required: [],
        };
      case "select":
        return {
          type: "object",
          properties: {
            optionValue: {
              type: "string",
              description: "Value of the option to select",
            },
          },
          required: [],
        };
      case "navigate":
        return {
          type: "object",
          properties: {
            timeout: {
              type: "number",
              description: "Timeout in milliseconds for navigation",
              default: 5000,
            },
          },
          required: [],
        };
      default:
        return baseSchema;
    }
  }

  /**
   * Infer the action type from element properties
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
    if (tag === "form") return "submit";
    if (tag === "textarea") return "input";
    if (tag === "button" && type === "submit") return "submit";
    if (tag === "a" || element.navigationTarget) return "navigate";
    if (role === "checkbox" || role === "radio") return "click";
    if (ariaLabelLower.includes("hover") || role === "menuitem") return "hover";

    return "click";
  }

  /**
   * Generate a simple action description
   */
  private static inferActionDescription(element: HighIntentElement): string {
    const actionType = this.inferActionType(element);

    switch (actionType) {
      case "click":
        return "click";
      case "input":
        return "input text into";
      case "submit":
        return "submit";
      case "navigate":
        return `navigate using`;
      case "delete":
        return "delete/remove via";
      case "select":
        return "select an option in";
      case "hover":
        return "hover over";
      default:
        return "interact with";
    }
  }
}
