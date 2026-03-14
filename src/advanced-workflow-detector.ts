/**
 * Phase 3 Enhancement: Advanced Workflow Detection
 * 
 * Improves workflow detection beyond basic heuristics by:
 * - Pattern-based workflow signatures
 * - Multi-page navigation chain detection
 * - State transition analysis
 * - Form flow recognition
 */

import { HighIntentElement } from "./types.js";

/**
 * Common workflow patterns for web applications
 * Used for heuristic-based workflow detection without ML
 */
export const WORKFLOW_PATTERNS = {
  LOGIN: {
    name: "Authentication Flow",
    signature: ["email|username", "password", "login|signin|sign|authenticate"],
    confidence: 0.95,
  },
  SIGNUP: {
    name: "Registration Flow",
    signature: ["email|username", "password", "confirm|password confirmation", "register|signup|sign up"],
    confidence: 0.9,
  },
  CHECKOUT: {
    name: "Purchase Flow",
    signature: ["email|shipping|address|payment|order|cart|checkout", "place|confirm|pay|charge|purchase|buy"],
    confidence: 0.85,
  },
  PRODUCT_BROWSING: {
    name: "Product Browsing & Shopping",
    signature: ["product|item|color|size|storage|quantity|price", "add to cart|buy now|wishlist"],
    confidence: 0.82,
  },
  SEARCH: {
    name: "Search Flow",
    signature: ["search|filter|sort", "product|item|results"],
    confidence: 0.8,
  },
  FORM_SUBMISSION: {
    name: "Form Submission",
    signature: ["input|text", "submit|send"],
    confidence: 0.75,
  },
  DELETE_CONFIRM: {
    name: "Delete Confirmation",
    signature: ["delete", "confirm|are you|yes|no", "cancel|ok"],
    confidence: 0.9,
  },
};

export interface WorkflowDetectionResult {
  workflowType: string;
  confidence: number;
  steps: HighIntentElement[];
  description: string;
  estimatedPages: number;
}

/**
 * Advanced Workflow Detector: Pattern-based without ML
 * 
 * Detects common workflows by matching element signatures
 * No external API calls, runs entirely in browser
 */
export class WorkflowDetector {
  /**
   * Detect workflows from a sequence of high-intent elements
   * @param elements High-intent elements in page order
   * @returns Detected workflows with confidence scores
   */
  detectWorkflows(elements: HighIntentElement[]): WorkflowDetectionResult[] {
    const results: WorkflowDetectionResult[] = [];

    // Convert elements to searchable text
    const elementTexts = elements.map((el) => `${el.text || ""} ${el.ariaLabel || ""}`.toLowerCase());
    const allText = elementTexts.join(" ");

    // Check each pattern
    Object.entries(WORKFLOW_PATTERNS).forEach(([key, pattern]) => {
      if (this.matchesPattern(allText, pattern.signature)) {
        // Find the elements that match this pattern
        const matchingElements = elements.filter((el) =>
          this.elementMatchesSignature(el, pattern.signature)
        );

        if (matchingElements.length > 0) {
          results.push({
            workflowType: key,
            confidence: pattern.confidence,
            steps: matchingElements,
            description: pattern.name,
            estimatedPages: this.estimatePageCount(matchingElements),
          });
        }
      }
    });

    return results.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Detect navigation patterns between pages
   * Used for multi-page workflow analysis
   */
  detectNavigationChains(elements: HighIntentElement[]): NavigationChain[] {
    const chains: NavigationChain[] = [];
    const navigableElements = elements.filter((el) => el.navigates);

    for (const el of navigableElements) {
      const chain: NavigationChain = {
        source: el,
        target: el.navigationTarget,
        type: this.classifyNavigation(el),
        confidence: this.estimateNavigationConfidence(el),
      };
      chains.push(chain);
    }

    return chains;
  }

  /**
   * Analyze state transitions in forms
   * Returns sequence of form states during workflow execution
   */
  analyzeFormStateTransitions(elements: HighIntentElement[]): FormStateTransition[] {
    const transitions: FormStateTransition[] = [];
    const formElements = elements.filter((el) => el.tag === "input" || el.tag === "form");

    let currentState: FormStateTransition | null = null;

    for (const el of formElements) {
      if (!currentState) {
        currentState = {
          fieldType: this.classifyFormField(el),
          required: el.ariaLabel?.includes("required") ?? false,
          validation: this.detectValidation(el),
          sequence: 1,
        };
      } else {
        // Detect state changes (e.g., error states, multi-step forms)
        if (el.text?.toLowerCase().includes("next") || el.text?.toLowerCase().includes("continue")) {
          transitions.push(currentState);
          currentState = {
            fieldType: this.classifyFormField(el),
            required: el.ariaLabel?.includes("required") ?? false,
            validation: this.detectValidation(el),
            sequence: (currentState.sequence || 0) + 1,
          };
        }
      }
    }

    if (currentState) {
      transitions.push(currentState);
    }

    return transitions;
  }

  /**
   * Score workflow match against pattern
   * Higher score = more likely to match
   */
  private matchesPattern(text: string, signature: string[]): boolean {
    if (!text) return false;

    // All keywords must be present in text
    return signature.every((keyword) => {
      // Support OR patterns like "email|username"
      if (keyword.includes("|")) {
        return keyword.split("|").some((part) => text.includes(part));
      }
      return text.includes(keyword);
    });
  }

  /**
   * Check if an element matches the pattern
   */
  private elementMatchesSignature(el: HighIntentElement, signature: string[]): boolean {
    const text = `${el.text || ""} ${el.ariaLabel || ""}`.toLowerCase();
    return signature.some((keyword) => {
      if (keyword.includes("|")) {
        return keyword.split("|").some((part) => text.includes(part));
      }
      return text.includes(keyword);
    });
  }

  /**
   * Estimate number of pages in a workflow
   * Based on navigation elements and form steps
   */
  private estimatePageCount(elements: HighIntentElement[]): number {
    const navElements = elements.filter((el) => el.navigates || el.tag === "a");
    const formElements = elements.filter((el) => el.tag === "input" || el.tag === "form");
    const submitButtons = elements.filter((el) => el.tag === "button" || el.tag === "input" && (el.attributes?.type === "submit"));

    // One page per navigation + one for initial + one for confirm/success
    return 1 + navElements.length + (submitButtons.length > 0 ? 1 : 0);
  }

  /**
   * Classify navigation type
   */
  private classifyNavigation(el: HighIntentElement): "internal" | "external" | "modal" {
    const target = el.navigationTarget || "";
    if (!target) return "modal";
    if (target.startsWith("http")) return "external";
    return "internal";
  }

  /**
   * Estimate navigation confidence based on element properties
   */
  private estimateNavigationConfidence(el: HighIntentElement): number {
    let confidence = 0.5;

    // Boost confidence for explicit navigation indicators
    if (el.navigationTarget) confidence += 0.2;
    if (el.ariaLabel?.toLowerCase().includes("next")) confidence += 0.1;
    if (el.text?.toLowerCase().includes("continue")) confidence += 0.1;
    if (el.classes?.some((c) => c.includes("next") || c.includes("continue"))) confidence += 0.05;

    return Math.min(confidence, 0.95);
  }

  /**
   * Classify form field type
   */
  private classifyFormField(
    el: HighIntentElement
  ): "email" | "password" | "text" | "select" | "checkbox" | "other" {
    const text = `${el.text || ""} ${el.ariaLabel || ""}`.toLowerCase();
    const type = el.attributes?.type?.toLowerCase() || "";

    if (type === "email" || text.includes("email")) return "email";
    if (type === "password" || text.includes("password")) return "password";
    if (type === "checkbox" || text.includes("agree")) return "checkbox";
    if (el.tag === "select") return "select";
    if (type === "text" || el.tag === "input") return "text";
    return "other";
  }

  /**
   * Detect validation rules on form field
   */
  private detectValidation(el: HighIntentElement): string[] {
    const validations: string[] = [];
    const attrs = el.attributes || {};

    if (attrs.required !== undefined) validations.push("required");
    if (attrs.pattern) validations.push("pattern");
    if (attrs.minlength) validations.push("minlength");
    if (attrs.maxlength) validations.push("maxlength");
    if (el.ariaLabel?.toLowerCase().includes("required")) validations.push("aria-required");

    return validations;
  }
}

export interface NavigationChain {
  source: HighIntentElement;
  target?: string;
  type: "internal" | "external" | "modal";
  confidence: number;
}

export interface FormStateTransition {
  fieldType: "email" | "password" | "text" | "select" | "checkbox" | "other";
  required: boolean;
  validation: string[];
  sequence: number;
}

export default WorkflowDetector;
