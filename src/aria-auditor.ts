/**
 * ARIA advisory rules.
 *
 * The first rule of ARIA is that no ARIA is better than bad ARIA: a wrong role
 * or a broken reference makes a page worse for screen reader, voice control
 * and keyboard users than plain HTML would have been. These rules look for the
 * patterns that cause that, and for each one say how it comes across to a
 * user, what to do instead, and — because the usual fix is to delete the
 * ARIA — what, if anything, would be lost by deleting it.
 *
 * Everything here is advice. Nothing is a pass/fail verdict, and the rules are
 * heuristics over a DOM snapshot, not a full accessibility tree: they are
 * tuned to stay quiet when unsure rather than to catch everything.
 *
 * The rules are pure functions over an AriaSnapshot (see aria-collector.ts),
 * so they run and are tested in Node without a browser.
 */
import type {
  AriaAdvisorySeverity,
  AriaAuditReport,
  AriaFinding,
  AriaNodeSnapshot,
  AriaSnapshot,
} from "./types.js";

const SPEC = "https://www.w3.org/TR/wai-aria-1.2/";
const ARIA_IN_HTML = "https://www.w3.org/TR/html-aria/";
const APG_NO_ARIA = "https://www.w3.org/WAI/ARIA/apg/practices/read-me-first/";

/** Concrete WAI-ARIA 1.2 roles an author may use. */
export const ARIA_ROLES: readonly string[] = [
  "alert", "alertdialog", "application", "article", "banner", "blockquote", "button",
  "caption", "cell", "checkbox", "code", "columnheader", "combobox", "complementary",
  "contentinfo", "definition", "deletion", "dialog", "directory", "document", "emphasis",
  "feed", "figure", "form", "generic", "grid", "gridcell", "group", "heading", "img",
  "insertion", "link", "list", "listbox", "listitem", "log", "main", "marquee", "math",
  "menu", "menubar", "menuitem", "menuitemcheckbox", "menuitemradio", "meter", "navigation",
  "none", "note", "option", "paragraph", "presentation", "progressbar", "radio",
  "radiogroup", "region", "row", "rowgroup", "rowheader", "scrollbar", "search",
  "searchbox", "separator", "slider", "spinbutton", "status", "strong", "subscript",
  "superscript", "switch", "tab", "table", "tablist", "tabpanel", "term", "textbox",
  "time", "timer", "toolbar", "tooltip", "tree", "treegrid", "treeitem",
];

/** Abstract roles exist for the spec's own taxonomy; authors must not use them. */
const ABSTRACT_ROLES = new Set([
  "command", "composite", "input", "landmark", "range", "roletype", "section",
  "sectionhead", "select", "structure", "widget", "window",
]);

const ARIA_ATTRIBUTES = new Set([
  "aria-activedescendant", "aria-atomic", "aria-autocomplete", "aria-braillelabel",
  "aria-brailleroledescription", "aria-busy", "aria-checked", "aria-colcount",
  "aria-colindex", "aria-colindextext", "aria-colspan", "aria-controls", "aria-current",
  "aria-describedby", "aria-description", "aria-details", "aria-disabled",
  "aria-dropeffect", "aria-errormessage", "aria-expanded", "aria-flowto", "aria-grabbed",
  "aria-haspopup", "aria-hidden", "aria-invalid", "aria-keyshortcuts", "aria-label",
  "aria-labelledby", "aria-level", "aria-live", "aria-modal", "aria-multiline",
  "aria-multiselectable", "aria-orientation", "aria-owns", "aria-placeholder",
  "aria-posinset", "aria-pressed", "aria-readonly", "aria-relevant", "aria-required",
  "aria-roledescription", "aria-rowcount", "aria-rowindex", "aria-rowindextext",
  "aria-rowspan", "aria-selected", "aria-setsize", "aria-sort", "aria-valuemax",
  "aria-valuemin", "aria-valuenow", "aria-valuetext",
]);

/** Widget roles a user expects to be able to reach and operate from the keyboard. */
const OPERABLE_ROLES = new Set([
  "button", "checkbox", "combobox", "link", "menuitem", "menuitemcheckbox",
  "menuitemradio", "radio", "searchbox", "slider", "spinbutton", "switch", "tab", "textbox",
]);

/** Every interactive role, including the ones focus is usually managed for. */
const WIDGET_ROLES = new Set([
  ...OPERABLE_ROLES, "gridcell", "listbox", "option", "scrollbar", "separator", "treeitem",
]);

/** Roles that are meaningless to a user without a name. */
const NAME_REQUIRED = new Set([
  "alertdialog", "button", "checkbox", "combobox", "dialog", "grid", "img", "link",
  "listbox", "menuitem", "menuitemcheckbox", "menuitemradio", "meter", "progressbar",
  "radio", "radiogroup", "searchbox", "slider", "spinbutton", "switch", "tab", "textbox",
  "tree", "treegrid", "treeitem",
]);

/** Roles on which aria-label and aria-labelledby are prohibited. */
const NAME_PROHIBITED = new Set([
  "caption", "code", "deletion", "emphasis", "generic", "insertion", "paragraph",
  "strong", "subscript", "superscript",
]);

const LANDMARK_ROLES = new Set([
  "banner", "complementary", "contentinfo", "form", "main", "navigation", "region", "search",
]);

/** Roles that only make sense inside a particular container. */
const REQUIRED_CONTEXT: Record<string, string[]> = {
  cell: ["row"],
  columnheader: ["row"],
  gridcell: ["row"],
  listitem: ["list", "directory"],
  menuitem: ["menu", "menubar", "group"],
  menuitemcheckbox: ["menu", "menubar", "group"],
  menuitemradio: ["menu", "menubar", "group"],
  option: ["listbox", "group"],
  row: ["table", "grid", "treegrid", "rowgroup"],
  rowgroup: ["table", "grid", "treegrid"],
  rowheader: ["row"],
  tab: ["tablist"],
  treeitem: ["tree", "group"],
};

/** Container roles that are empty promises without particular children. */
const REQUIRED_OWNED: Record<string, string[]> = {
  grid: ["row", "rowgroup"],
  list: ["listitem"],
  listbox: ["option", "group"],
  menu: ["menuitem", "menuitemcheckbox", "menuitemradio", "group"],
  menubar: ["menuitem", "menuitemcheckbox", "menuitemradio", "group"],
  radiogroup: ["radio"],
  table: ["row", "rowgroup"],
  tablist: ["tab"],
  tree: ["treeitem", "group"],
  treegrid: ["row", "rowgroup"],
};

/** Allowed values for token attributes. Matching is ASCII case-insensitive. */
const TOKEN_VALUES: Record<string, { values: string[]; fallback: string }> = {
  "aria-atomic": { values: ["true", "false"], fallback: "false" },
  "aria-autocomplete": { values: ["inline", "list", "both", "none"], fallback: "none" },
  "aria-busy": { values: ["true", "false"], fallback: "false" },
  "aria-checked": { values: ["true", "false", "mixed", "undefined"], fallback: "undefined (no checked state)" },
  "aria-current": { values: ["page", "step", "location", "date", "time", "true", "false"], fallback: "false" },
  "aria-disabled": { values: ["true", "false"], fallback: "false (enabled)" },
  "aria-expanded": { values: ["true", "false", "undefined"], fallback: "undefined (not expandable)" },
  "aria-haspopup": { values: ["false", "true", "menu", "listbox", "tree", "grid", "dialog"], fallback: "false" },
  "aria-hidden": { values: ["true", "false", "undefined"], fallback: "undefined (exposed)" },
  "aria-invalid": { values: ["grammar", "false", "spelling", "true"], fallback: "false" },
  "aria-live": { values: ["assertive", "off", "polite"], fallback: "off" },
  "aria-modal": { values: ["true", "false"], fallback: "false" },
  "aria-multiline": { values: ["true", "false"], fallback: "false" },
  "aria-multiselectable": { values: ["true", "false"], fallback: "false" },
  "aria-orientation": { values: ["horizontal", "vertical", "undefined"], fallback: "the role's default" },
  "aria-pressed": { values: ["true", "false", "mixed", "undefined"], fallback: "undefined (not a toggle)" },
  "aria-readonly": { values: ["true", "false"], fallback: "false" },
  "aria-required": { values: ["true", "false"], fallback: "false" },
  "aria-selected": { values: ["true", "false", "undefined"], fallback: "undefined (not selectable)" },
  "aria-sort": { values: ["ascending", "descending", "none", "other"], fallback: "none" },
};

/** State attributes users act on; a bad value here misreports what they hear. */
const USER_FACING_STATES = new Set([
  "aria-checked", "aria-disabled", "aria-expanded", "aria-hidden", "aria-pressed", "aria-selected",
]);

/** Roles that support each widget state; anywhere else the state is not announced. */
const STATE_SUPPORT: Record<string, { roles: string[]; suggestion: string }> = {
  "aria-checked": {
    roles: ["checkbox", "menuitemcheckbox", "menuitemradio", "option", "radio", "switch", "treeitem"],
    suggestion: 'For an on/off button use aria-pressed on role="button", or role="switch" / role="checkbox" with aria-checked.',
  },
  "aria-pressed": {
    roles: ["button"],
    suggestion: 'aria-pressed only works on buttons. For other roles use the state that role supports (aria-checked on a checkbox or switch, aria-selected on a tab or option).',
  },
  "aria-selected": {
    roles: ["columnheader", "gridcell", "option", "row", "rowheader", "tab", "treeitem"],
    suggestion: 'For a toggle button use aria-pressed; to mark the current item in a set of links use aria-current.',
  },
};

const SEVERITY_ORDER: Record<AriaAdvisorySeverity, number> = { high: 0, medium: 1, low: 2 };

type Rule = (node: AriaNodeSnapshot) => AriaFinding[];

/** Shared fields every finding about a node carries. */
function about(node: AriaNodeSnapshot) {
  return { locator: node.locator, snippet: node.snippet, role: node.effectiveRole };
}

function describeRole(role: string | null): string {
  return role === null || role === "generic" ? "plain content with no role" : `a ${role}`;
}

function quote(text: string, max = 60): string {
  const t = text.length > max ? text.slice(0, max - 1) + "…" : text;
  return `"${t}"`;
}

function normaliseForCompare(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function roleTokens(node: AriaNodeSnapshot): string[] {
  return (node.roleAttr ?? "").toLowerCase().split(/\s+/).filter(Boolean);
}

/** The explicit role the author asked for, if it is one the browser honours. */
function explicitRole(node: AriaNodeSnapshot): string | null {
  return roleTokens(node).find((t) => ARIA_ROLES.includes(t)) ?? null;
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length];
}

function closestAttribute(name: string): string | null {
  let best: string | null = null;
  let bestDistance = 3;
  for (const known of ARIA_ATTRIBUTES) {
    const d = levenshtein(name, known);
    if (d < bestDistance) {
      best = known;
      bestDistance = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Per-element rules
// ---------------------------------------------------------------------------

const invalidRole: Rule = (node) => {
  const tokens = roleTokens(node);
  if (tokens.length === 0 || explicitRole(node) !== null) return [];
  const abstract = tokens.filter((t) => ABSTRACT_ROLES.has(t));
  return [{
    ruleId: "invalid-role",
    title: "Role is not a WAI-ARIA role",
    severity: "medium",
    ...about(node),
    problem: abstract.length > 0
      ? `role="${node.roleAttr}" is an abstract role. Abstract roles only exist to organise the spec, and browsers ignore them on elements.`
      : `role="${node.roleAttr}" is not a role defined by WAI-ARIA.`,
    userExperience: `Assistive technology ignores roles it does not recognise, so this is announced as ${describeRole(node.implicitRole)}. Whatever the author meant the role to convey, users never hear it.`,
    advice: "Use a valid role, or better, a native HTML element that already has the semantics you want.",
    fix: "use-native-html",
    ifRemoved: "Nothing. Browsers already ignore an unrecognised role. Removing it changes nothing for users and stops it misleading the next developer.",
    safeToRemove: true,
    reference: `${SPEC}#role_definitions`,
  }];
};

const redundantRole: Rule = (node) => {
  const role = explicitRole(node);
  if (role === null || role !== node.implicitRole) return [];
  const isList = role === "list" && (node.tag === "ul" || node.tag === "ol");
  return [{
    ruleId: "redundant-role",
    title: "Role repeats the element's native semantics",
    severity: "low",
    ...about(node),
    problem: `<${node.tag}> is already exposed as role "${role}", so role="${node.roleAttr}" adds nothing.`,
    userExperience: "Users hear exactly the same thing with or without it. It is noise in the markup rather than a problem for users.",
    advice: isList
      ? 'Remove it, unless this list is styled with list-style: none. WebKit drops list semantics from such lists, and role="list" is the standard workaround.'
      : "Remove the role attribute and let the native element speak for itself.",
    fix: "remove-aria",
    ifRemoved: isList
      ? 'Possibly something: in Safari with VoiceOver, a list styled with list-style: none stops being announced as a list. role="list" restores that. If the list keeps its bullets, nothing is lost.'
      : `Nothing. The <${node.tag}> element already gives users the ${role} role.`,
    safeToRemove: !isList,
    reference: `${ARIA_IN_HTML}#docconformance`,
  }];
};

const nativeSemanticsOverridden: Rule = (node) => {
  const role = explicitRole(node);
  if (!node.nativelyInteractive || role === null || role === node.implicitRole) return [];
  if (WIDGET_ROLES.has(role) || role === "none" || role === "presentation") return [];
  return [{
    ruleId: "native-semantics-overridden",
    title: "Role hides that a native control is interactive",
    severity: "high",
    ...about(node),
    problem: `<${node.tag}> is a native ${node.implicitRole}, but role="${node.roleAttr}" replaces that with "${role}", which is not interactive.`,
    userExperience: `A keyboard user can still Tab to it and activate it, but a screen reader announces it as ${describeRole(role)}. The user is not told it can be operated, and it drops out of the screen reader's list of ${node.implicitRole}s.`,
    advice: `Remove the role. If the ${role} semantics matter (for example a heading), put the control inside an element that carries them, e.g. <h2><button>…</button></h2>.`,
    fix: "remove-aria",
    ifRemoved: `The "${role}" announcement. The element goes back to being announced as a ${node.implicitRole}, which matches how it behaves. If "${role}" was conveying structure, wrap the control rather than overriding it.`,
    safeToRemove: false,
    reference: `${ARIA_IN_HTML}#docconformance`,
  }];
};

const widgetNotFocusable: Rule = (node) => {
  const role = explicitRole(node);
  if (role === null || !OPERABLE_ROLES.has(role)) return [];
  if (node.focusable || node.nativelyInteractive || node.disabled || node.inAriaHiddenSubtree) return [];
  return [{
    ruleId: "widget-not-focusable",
    title: "Announced as a control but cannot be reached from the keyboard",
    severity: "high",
    ...about(node),
    problem: `role="${role}" is on a <${node.tag}> that is not focusable (no tabindex, not a native control).`,
    userExperience: `A screen reader announces "${role}", which promises a control. But Tab never reaches it, and nothing tells the user it only responds to a mouse. Keyboard, switch and screen reader users cannot operate it at all.`,
    advice: `Use the native element (<button>, <a href>, <input type="checkbox">…). It brings focus, Enter/Space activation and the role for free. If the custom element has to stay, add tabindex="0" and keyboard handlers that match the ${role} pattern.`,
    fix: "use-native-html",
    ifRemoved: `The "${role}" announcement. That announcement is currently a promise the element can't keep. Removing only the role leaves a mouse-only element that is just as unusable from the keyboard but no longer misleading. Replacing it with a native element is the real fix.`,
    safeToRemove: false,
    reference: "https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/",
  }];
};

const ariaHiddenFocusable: Rule = (node) => {
  if ((node.ariaAttributes["aria-hidden"] ?? "").toLowerCase() !== "true") return [];
  if (!node.tabbable && node.focusableDescendants === 0) return [];
  const where = node.tabbable
    ? "The element itself is focusable"
    : `It contains ${node.focusableDescendants} focusable element${node.focusableDescendants === 1 ? "" : "s"}`;
  return [{
    ruleId: "aria-hidden-focusable",
    title: "Hidden from screen readers but still reachable with Tab",
    severity: "high",
    ...about(node),
    problem: `aria-hidden="true" removes this from the accessibility tree. ${where}.`,
    userExperience: "Keyboard focus lands on something the screen reader has been told does not exist. Users hear nothing, or a meaningless \"blank\", and cannot tell what they are on or what it does.",
    advice: "If the content is meant to be used, remove aria-hidden. If it really should be hidden, make it inert: add the inert attribute, or take every focusable descendant out of the tab order.",
    fix: "remove-aria",
    ifRemoved: "Screen reader users would hear this content again. If it is a decorative duplicate you lose a little noise reduction. But because keyboard users can reach it, screen reader users need to be able to hear it too.",
    safeToRemove: false,
    reference: `${SPEC}#aria-hidden`,
  }];
};

const presentationConflict: Rule = (node) => {
  const role = explicitRole(node);
  if (role !== "none" && role !== "presentation") return [];
  const globals = Object.keys(node.ariaAttributes).filter((a) =>
    ["aria-describedby", "aria-label", "aria-labelledby", "aria-live", "aria-controls", "aria-owns"].includes(a)
  );
  if (!node.focusable && globals.length === 0) return [];
  const reason = node.focusable
    ? "the element is focusable"
    : `it also has ${globals.join(", ")}`;
  return [{
    ruleId: "presentation-conflict",
    title: `role="${role}" is ignored because ${reason}`,
    severity: "medium",
    ...about(node),
    problem: `role="${role}" asks the browser to strip this element's semantics, but ${reason}. The spec tells browsers to ignore the role in that case.`,
    userExperience: `Users get the native semantics (${describeRole(node.implicitRole)}) anyway, so the role does nothing. If it was meant to hide a layout element, it isn't hiding it.`,
    advice: node.focusable
      ? "Remove the role. An element people can focus needs its semantics."
      : `Remove the role or the ${globals.join("/")} attribute. They contradict each other.`,
    fix: "remove-aria",
    ifRemoved: `Nothing. Browsers already ignore role="${role}" here, so the element keeps its native semantics either way.`,
    safeToRemove: true,
    reference: `${SPEC}#conflict_resolution_presentation_none`,
  }];
};

const IDREF_IMPACT: Record<string, string> = {
  "aria-activedescendant": "Focus is meant to be reported on that element, so as the user arrows through the options the screen reader announces nothing.",
  "aria-controls": "The relationship to the controlled content is lost. JAWS, for example, can no longer offer to jump to it.",
  "aria-describedby": "Users never hear the description or help text this was meant to point to.",
  "aria-details": "Users are never told extra details exist.",
  "aria-errormessage": "Users are never told the error message when the field is invalid.",
  "aria-flowto": "The alternative reading order is lost.",
  "aria-labelledby": "The name was meant to come from that element. Without it the name falls back to whatever else is available, which may be nothing.",
  "aria-owns": "The intended parent/child relationship is lost, so the owned content is not presented where the author meant it to be.",
};

const brokenIdref: Rule = (node) =>
  Object.entries(node.missingIdrefs).map(([attribute, ids]) => {
    const unnamed = attribute === "aria-labelledby" && node.accessibleName === "";
    return {
      ruleId: "broken-idref",
      title: `${attribute} points at an id that does not exist`,
      severity: unnamed || attribute === "aria-activedescendant" ? "high" : "medium",
      ...about(node),
      problem: `${attribute} references ${ids.map((id) => `#${id}`).join(", ")}, which ${ids.length === 1 ? "is" : "are"} not in the page.`,
      userExperience: IDREF_IMPACT[attribute] +
        (attribute === "aria-labelledby"
          ? node.accessibleName
            ? ` Here it is announced as ${quote(node.accessibleName)}.`
            : " Here that leaves it with no name at all."
          : ""),
      advice: "Point the attribute at the right id, or remove the reference if the target is gone for good.",
      fix: "change-aria",
      ifRemoved: "Nothing. A reference to a missing id is already ignored. If the relationship is real, fix the id instead of deleting the attribute.",
      safeToRemove: true,
      reference: `${SPEC}#${attribute}`,
    } satisfies AriaFinding;
  });

const labelNotInName: Rule = (node) => {
  const role = node.effectiveRole;
  if (role === null || !WIDGET_ROLES.has(role) || node.inAriaHiddenSubtree) return [];
  if (node.nameSource !== "aria-label" && node.nameSource !== "aria-labelledby") return [];
  const visible = normaliseForCompare(node.visibleText);
  const name = normaliseForCompare(node.accessibleName);
  // Label-in-name is about text labels. An icon or a bare count ("🛒 3") is
  // not something anyone would speak to activate the control.
  if (!/\p{L}/u.test(visible) || name.includes(visible)) return [];
  return [{
    ruleId: "label-not-in-name",
    title: "Accessible name does not contain the visible text",
    severity: "medium",
    ...about(node),
    problem: `The control shows ${quote(node.visibleText)} but its ${node.nameSource} makes the accessible name ${quote(node.accessibleName)}.`,
    userExperience: `Someone using voice control says "click ${node.visibleText}" and nothing happens, because that is not the control's name. A sighted screen reader user hears ${quote(node.accessibleName)}, which doesn't match what's on screen.`,
    advice: `Start the accessible name with the visible text (e.g. aria-label="${node.visibleText} …"), or remove ${node.nameSource} so the visible text becomes the name. Move any extra context to aria-describedby.`,
    fix: "change-aria",
    ifRemoved: `The name becomes the visible text ${quote(node.visibleText)}, and the wording ${quote(node.accessibleName)} is lost. If that wording gave needed context, keep it as visible text or aria-describedby. Don't let it replace what's on screen.`,
    safeToRemove: false,
    reference: "https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html",
  }];
};

const missingName: Rule = (node) => {
  const role = explicitRole(node);
  if (role === null || !NAME_REQUIRED.has(role) || node.inAriaHiddenSubtree) return [];
  if (node.accessibleName !== "") return [];
  return [{
    ruleId: "missing-name",
    title: `${role} has no accessible name`,
    severity: "high",
    ...about(node),
    problem: `role="${role}" needs a name, but there is no text content, aria-label or resolvable aria-labelledby.`,
    userExperience: `A screen reader announces just "${role}". The user hears that something is there but not what it is or what it does. Voice control users have nothing to say to activate it.`,
    advice: role === "img"
      ? 'Give it a name with aria-label, or if it is decorative use role="presentation" or alt="".'
      : "Give it visible text, or aria-label / aria-labelledby that matches what a sighted user sees.",
    fix: "add-aria",
    ifRemoved: `Removing role="${role}" stops the empty "${role}" announcement, but the element is still meaningless. This is the one case where the fix is more ARIA (or visible text), not less.`,
    safeToRemove: false,
    reference: "https://www.w3.org/TR/accname-1.2/",
  }];
};

const requiredContext: Rule = (node) => {
  const role = explicitRole(node);
  if (role === null || !(role in REQUIRED_CONTEXT) || node.inAriaHiddenSubtree) return [];
  const allowed = REQUIRED_CONTEXT[role];
  if (node.parentRole !== null && allowed.includes(node.parentRole)) return [];
  const container = allowed[0];
  return [{
    ruleId: "required-context",
    title: `${role} is not inside a ${allowed.join(" or ")}`,
    severity: "medium",
    ...about(node),
    problem: `role="${role}" only has meaning inside ${allowed.map((r) => `role="${r}"`).join(" or ")}, but its nearest container is ${describeRole(node.parentRole)}.`,
    userExperience: `Out of context, a screen reader can't say "${role} 2 of 5" or let users move through the set, and some drop the role entirely. Users hear that something belongs to a group but can't find the group.`,
    advice: `If this really is one of a set, wrap the set in role="${container}". If it isn't, remove role="${role}".`,
    fix: "change-aria",
    ifRemoved: `If this element isn't really part of a ${container}, nothing: the "${role}" announcement was already incomplete. If it is, keep it and add the ${container} container.`,
    safeToRemove: false,
    reference: `${SPEC}#scope`,
  }];
};

const requiredOwned: Rule = (node) => {
  const role = explicitRole(node);
  if (role === null || !(role in REQUIRED_OWNED) || node.inAriaHiddenSubtree) return [];
  if ((node.ariaAttributes["aria-busy"] ?? "").toLowerCase() === "true") return [];
  const allowed = REQUIRED_OWNED[role];
  if (node.ownedRoles.some((r) => allowed.includes(r))) return [];
  return [{
    ruleId: "required-owned",
    title: `${role} contains no ${allowed[0]}`,
    severity: "medium",
    ...about(node),
    problem: `role="${role}" must contain ${allowed.map((r) => `role="${r}"`).join(" or ")}, but none of its children have one.`,
    userExperience: `Users are told a structure is there (for example "${role}, 0 items") and then find nothing in it. Arrow-key navigation the role promises doesn't work.`,
    advice: `Give the children role="${allowed[0]}", or remove role="${role}" if this isn't really a ${role}.`,
    fix: "change-aria",
    ifRemoved: `The misleading "${role}" announcement. The content is then read in plain document order, which is more honest than an empty ${role}.`,
    safeToRemove: false,
    reference: `${SPEC}#mustContain`,
  }];
};

const invalidAttributeValue: Rule = (node) =>
  Object.entries(node.ariaAttributes).flatMap(([attribute, value]) => {
    const spec = TOKEN_VALUES[attribute];
    if (!spec || spec.values.includes(value.trim().toLowerCase())) return [];
    const userFacing = USER_FACING_STATES.has(attribute);
    return [{
      ruleId: "invalid-attribute-value",
      title: `${attribute}="${value}" is not a valid value`,
      severity: userFacing ? "medium" : "low",
      ...about(node),
      problem: `${attribute} accepts ${spec.values.join(" | ")}. "${value}" is not one of them.`,
      userExperience: `Browsers treat an invalid value as ${spec.fallback}.` +
        (userFacing ? " The state users hear may be the opposite of what the page shows." : ""),
      advice: `Use one of: ${spec.values.join(", ")}.`,
      fix: "change-aria",
      ifRemoved: `Nothing users get today, because the invalid value is already treated as ${spec.fallback}. If the state matters, set a valid value instead.`,
      safeToRemove: true,
      reference: `${SPEC}#${attribute}`,
    } satisfies AriaFinding];
  });

const unknownAttribute: Rule = (node) =>
  Object.keys(node.ariaAttributes)
    .filter((a) => !ARIA_ATTRIBUTES.has(a))
    .map((attribute) => {
      const suggestion = closestAttribute(attribute);
      return {
        ruleId: "unknown-attribute",
        title: `${attribute} is not an ARIA attribute`,
        severity: "low",
        ...about(node),
        problem: `${attribute} is not defined by WAI-ARIA${suggestion ? `. Did you mean ${suggestion}?` : "."}`,
        userExperience: suggestion
          ? `Browsers ignore it, so whatever ${suggestion} was meant to tell users, they never hear it.`
          : "Browsers and assistive technology ignore it.",
        advice: suggestion ? `Rename it to ${suggestion}.` : "Remove it, or replace it with the ARIA attribute you meant.",
        fix: suggestion ? "change-aria" : "remove-aria",
        ifRemoved: "Nothing. Unknown attributes are already ignored.",
        safeToRemove: true,
        reference: `${SPEC}#state_prop_def`,
      } satisfies AriaFinding;
    });

const prohibitedName: Rule = (node) => {
  // A null role means the collector doesn't know the element (svg, math,
  // label…), not that it is generic, so stay quiet.
  const role = node.effectiveRole;
  if (role === null || !NAME_PROHIBITED.has(role)) return [];
  const attrs = ["aria-label", "aria-labelledby"].filter((a) => a in node.ariaAttributes);
  if (attrs.length === 0) return [];
  const label = node.ariaAttributes["aria-label"];
  return [{
    ruleId: "prohibited-name",
    title: `${attrs.join(" and ")} cannot name ${describeRole(role)}`,
    severity: "medium",
    ...about(node),
    problem: `Naming is prohibited on role "${role}" (a <${node.tag}> with no role is generic), so ${attrs.join(" and ")} has no defined meaning here.`,
    userExperience: `Most screen readers ignore it, so users never hear ${label ? quote(label) : "the label"}. Others read it inconsistently.`,
    advice: "If the text matters, make it visible content. Or use a role that can be named (region, group, img), or put aria-describedby on a nearby focusable control.",
    fix: "remove-aria",
    ifRemoved: "Nothing reliable. Most assistive technology already ignores the label here. If the text matters, make it visible.",
    safeToRemove: true,
    reference: `${SPEC}#prohibitedattributes`,
  }];
};

const unsupportedState: Rule = (node) => {
  const role = node.effectiveRole;
  if (role === null) return [];
  return Object.entries(STATE_SUPPORT).flatMap(([attribute, support]) => {
    if (!(attribute in node.ariaAttributes) || support.roles.includes(role)) return [];
    return [{
      ruleId: "unsupported-state",
      title: `${attribute} is not supported on a ${role}`,
      severity: "medium",
      ...about(node),
      problem: `${attribute} is only defined for ${support.roles.join(", ")}. This element is ${describeRole(role)}.`,
      userExperience: `Screen readers don't announce ${attribute} on ${describeRole(role)}, so users can't tell whether it is on, off or selected, even if it looks that way.`,
      advice: support.suggestion,
      fix: "change-aria",
      ifRemoved: "Nothing users currently hear, because the unsupported state isn't announced. Replace it with the state that matches the role.",
      safeToRemove: true,
      reference: `${SPEC}#${attribute}`,
    } satisfies AriaFinding];
  });
};

const ELEMENT_RULES: Rule[] = [
  invalidRole,
  redundantRole,
  nativeSemanticsOverridden,
  widgetNotFocusable,
  ariaHiddenFocusable,
  presentationConflict,
  brokenIdref,
  labelNotInName,
  missingName,
  requiredContext,
  requiredOwned,
  invalidAttributeValue,
  unknownAttribute,
  prohibitedName,
  unsupportedState,
];

// ---------------------------------------------------------------------------
// Page-level rules
// ---------------------------------------------------------------------------

function landmarkFindings(nodes: AriaNodeSnapshot[]): AriaFinding[] {
  const byRole = new Map<string, AriaNodeSnapshot[]>();
  for (const node of nodes) {
    const role = node.effectiveRole;
    if (role === null || !LANDMARK_ROLES.has(role) || node.inAriaHiddenSubtree) continue;
    byRole.set(role, [...(byRole.get(role) ?? []), node]);
  }

  const findings: AriaFinding[] = [];
  for (const [role, group] of byRole) {
    if (group.length < 2) continue;
    if (role === "main") {
      findings.push({
        ruleId: "duplicate-main",
        title: `${group.length} main landmarks`,
        severity: "medium",
        ...about(group[1]),
        problem: `The page exposes ${group.length} main landmarks (${group.map((n) => n.locator).join(", ")}). A page should have exactly one.`,
        userExperience: "A screen reader's \"skip to main content\" goes to one of them, and users can't tell which one holds the content they came for.",
        advice: "Keep one main and change the others to a region with a name, or plain content.",
        fix: "change-aria",
        ifRemoved: "If the extra mains came from role=\"main\", removing it loses nothing users rely on. One main is what they expect.",
        safeToRemove: group.some((n) => n.roleAttr !== undefined),
        reference: `${SPEC}#main`,
      });
      continue;
    }
    const unnamed = group.filter((n) => n.accessibleName === "");
    if (unnamed.length < 2) continue;
    findings.push({
      ruleId: "indistinguishable-landmarks",
      title: `${unnamed.length} ${role} landmarks with no name`,
      severity: "low",
      ...about(unnamed[0]),
      problem: `${unnamed.length} ${role} landmarks (${unnamed.map((n) => n.locator).join(", ")}) have no accessible name.`,
      userExperience: `The screen reader's landmark list shows "${role}" ${unnamed.length} times with nothing to tell them apart, so users have to visit each one to find the one they want.`,
      advice: `Give each a short, distinct name, e.g. aria-label="Primary" and aria-label="Footer".`,
      fix: "add-aria",
      ifRemoved: "This is not bad ARIA to remove. The landmarks help people navigate. Naming them is the improvement.",
      safeToRemove: false,
      reference: "https://www.w3.org/WAI/ARIA/apg/practices/landmark-regions/",
    });
  }
  return findings;
}

/**
 * Links given menu roles. Site navigation built as role="menubar" is one of the
 * most common ARIA misuses: menu roles promise desktop-application behaviour,
 * which a list of links neither has nor needs.
 */
function linksAsMenuFindings(nodes: AriaNodeSnapshot[]): AriaFinding[] {
  const links = nodes.filter(
    (n) => n.implicitRole === "link" && ["menuitem", "menuitemcheckbox", "menuitemradio"].includes(explicitRole(n) ?? "")
  );
  if (links.length === 0) return [];
  return [{
    ruleId: "links-as-menu",
    title: `${links.length} link${links.length === 1 ? " is" : "s are"} exposed as menu items`,
    severity: "medium",
    ...about(links[0]),
    problem: `${links.map((n) => n.locator).join(", ")} ${links.length === 1 ? "is a link" : "are links"} given role="menuitem". Menu roles are for application menus (like a word processor's File menu), not for site navigation.`,
    userExperience: 'Screen readers announce a menu and may switch into application mode. Users then expect arrow keys to move between items and Escape to close it. Tab still moves between the links, so the keys they were told to use don\'t work. They also lose link-specific features such as the links list and "visited".',
    advice: 'Remove role="menubar", role="menu" and role="menuitem", along with the role="none" on the list items. Keep the links in a <ul> inside <nav>. That is exactly what site navigation is.',
    fix: "remove-aria",
    ifRemoved: `The "menu bar" announcement and the item count it gives. Users get a navigation landmark with a list of links instead ("list, ${links.length} items"), which tells them the same thing in a form they already know how to use. Nothing is lost unless you have built full menu keyboard support, and even then users expect links to behave like links.`,
    safeToRemove: true,
    reference: "https://www.w3.org/WAI/ARIA/apg/patterns/menubar/",
  }];
}

/**
 * Turn a snapshot into an advisory report. The report never fails: an empty
 * findings list means none of these patterns were seen, not that the page is
 * accessible.
 */
export function auditAriaSnapshot(snapshot: AriaSnapshot): AriaAuditReport {
  const findings = [
    ...snapshot.elements.flatMap((node) => ELEMENT_RULES.flatMap((rule) => rule(node))),
    ...landmarkFindings(snapshot.elements),
    ...linksAsMenuFindings(snapshot.elements),
  ].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const count = (severity: AriaAdvisorySeverity) =>
    findings.filter((f) => f.severity === severity).length;

  return {
    url: snapshot.url,
    title: snapshot.title,
    advisory: true,
    elementsScanned: snapshot.elementsScanned,
    elementsWithAria: snapshot.elements.filter(
      (n) => n.roleAttr !== undefined || Object.keys(n.ariaAttributes).length > 0
    ).length,
    truncated: snapshot.truncated,
    findings,
    summary: {
      total: findings.length,
      high: count("high"),
      medium: count("medium"),
      low: count("low"),
      safeToRemove: findings.filter((f) => f.safeToRemove).length,
    },
  };
}

/** A report for when the audit itself could not run. Still advisory, still not a failure of the page. */
export function failedAriaAudit(url: string, error: unknown): AriaAuditReport {
  return {
    url,
    title: "",
    advisory: true,
    elementsScanned: 0,
    elementsWithAria: 0,
    truncated: false,
    findings: [],
    summary: { total: 0, high: 0, medium: 0, low: 0, safeToRemove: 0 },
    error: error instanceof Error ? error.message : String(error),
  };
}

export const ARIA_ADVISORY_PREAMBLE =
  "No ARIA is better than bad ARIA. " +
  "These notes describe how ARIA on the page is likely to come across to someone using a screen reader, " +
  "voice control or a keyboard, and what to do about it. They are advice from heuristics over the DOM, " +
  "not a WCAG conformance verdict, and nothing here fails a run.";

export const ARIA_ADVISORY_REFERENCE = APG_NO_ARIA;
