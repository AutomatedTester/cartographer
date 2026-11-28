/**
 * lookupWorkflow: the matching behind get_workflow_by_name.
 *
 * Workflow names come from a fixed set, so a crawl can produce several
 * workflows with the same name. These cases pin down that every one of them
 * stays reachable, which a real crawl of the benchmark fixture does not
 * reliably produce (see test/integration/workflow-lookup.test.js).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { lookupWorkflow } from "../../build/workflow-lookup.js";

function wf(id, name, confidence) {
  return { id, name, confidence, pageSequence: [], actionSequence: [], stateTransitions: [], tags: [] };
}

const workflows = [
  wf("wf_form_a", "form_submission_flow", 65),
  wf("wf_nav_1", "navigation_menu_exploration", 70),
  wf("wf_form_b", "form_submission_flow", 85),
  wf("wf_form_c", "form_submission_flow", 75),
];

describe("lookupWorkflow", () => {
  it("returns the only workflow with a name and no others", () => {
    const match = lookupWorkflow(workflows, "navigation_menu_exploration");
    assert.equal(match.workflow.id, "wf_nav_1");
    assert.deepEqual(match.others, []);
  });

  it("returns the highest-confidence of several same-named workflows, then the rest best first", () => {
    const match = lookupWorkflow(workflows, "form_submission_flow");
    assert.equal(match.workflow.id, "wf_form_b");
    assert.deepEqual(match.others.map((w) => w.id), ["wf_form_c", "wf_form_a"]);
  });

  it("reaches every same-named workflow by its ID", () => {
    for (const expected of workflows) {
      const match = lookupWorkflow(workflows, expected.id);
      assert.equal(match.workflow, expected);
      assert.deepEqual(match.others, []);
    }
  });

  it("returns null when neither a name nor an ID matches", () => {
    assert.equal(lookupWorkflow(workflows, "checkout_flow"), null);
    assert.equal(lookupWorkflow([], "form_submission_flow"), null);
  });

  it("matches names exactly", () => {
    assert.equal(lookupWorkflow(workflows, "Form_Submission_Flow"), null);
  });

  it("does not reorder the caller's array", () => {
    const before = workflows.map((w) => w.id);
    lookupWorkflow(workflows, "form_submission_flow");
    assert.deepEqual(workflows.map((w) => w.id), before);
  });
});
