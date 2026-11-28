import type { DetectedWorkflow } from "./types.js";

export interface WorkflowLookup {
  /** The workflow to return: the ID match, or the highest-confidence name match. */
  workflow: DetectedWorkflow;
  /** Other workflows with the same name, best first. Empty for an ID match. */
  others: DetectedWorkflow[];
}

/**
 * Find a workflow by ID or by name.
 *
 * Workflow names come from a small fixed set ("form_submission_flow",
 * "navigation_menu_exploration", ...), so one crawl can hold several workflows
 * with the same name. IDs are unique and are tried first, which keeps every
 * workflow reachable; a name returns the highest-confidence match and the rest
 * so the caller can point at their IDs.
 */
export function lookupWorkflow(
  workflows: DetectedWorkflow[],
  nameOrId: string
): WorkflowLookup | null {
  const byId = workflows.find((w) => w.id === nameOrId);
  if (byId) return { workflow: byId, others: [] };

  const [workflow, ...others] = workflows
    .filter((w) => w.name === nameOrId)
    .sort((a, b) => b.confidence - a.confidence);

  return workflow ? { workflow, others } : null;
}
