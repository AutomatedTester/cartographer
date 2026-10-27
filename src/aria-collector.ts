/**
 * In-page half of the ARIA advisory.
 *
 * collectAriaSnapshot() is sent to the browser with driver.executeScript(fn),
 * which serialises the function's source. It must therefore be completely
 * self-contained: no imports, no module-level helpers, no closures. Everything
 * it needs is declared inside the function body, and the list of valid roles is
 * passed in as an argument so the role table has a single home
 * (aria-auditor.ts).
 *
 * It resolves only what needs the live DOM — rendering, focusability, id
 * references, the roles around an element — and leaves every judgement to the
 * rules in aria-auditor.ts, which run in Node and are unit tested there.
 */
import type { AriaNodeSnapshot, AriaSnapshot } from "./types.js";

export function collectAriaSnapshot(validRoles: string[], maxElements = 2000): AriaSnapshot {
  const VALID = new Set(validRoles);
  const PRESENTATIONAL = new Set(["generic", "none", "presentation"]);
  const LANDMARKS = new Set([
    "banner", "complementary", "contentinfo", "form", "main", "navigation", "region", "search",
  ]);
  // Roles whose accessible name may come from their content.
  const NAME_FROM_CONTENT = new Set([
    "button", "cell", "checkbox", "columnheader", "gridcell", "heading", "link", "menuitem",
    "menuitemcheckbox", "menuitemradio", "option", "radio", "row", "rowheader", "switch",
    "tab", "tooltip", "treeitem",
  ]);
  const IDREF_ATTRS = [
    "aria-activedescendant", "aria-controls", "aria-describedby", "aria-details",
    "aria-errormessage", "aria-flowto", "aria-labelledby", "aria-owns",
  ];
  const SECTIONING = new Set(["ARTICLE", "ASIDE", "MAIN", "NAV", "SECTION"]);
  const GENERIC_TAGS = new Set(["B", "BDI", "BDO", "DATA", "DIV", "I", "SMALL", "SPAN", "U"]);

  const renderedCache = new Map<Element, boolean>();
  const roleCache = new Map<Element, string | null>();

  const attr = (el: Element, name: string): string | null => el.getAttribute(name);
  const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

  function isRendered(el: Element): boolean {
    const cached = renderedCache.get(el);
    if (cached !== undefined) return cached;
    let result = true;
    if (el.hasAttribute("hidden")) {
      result = false;
    } else {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") {
        result = false;
      } else if (el.parentElement) {
        result = isRendered(el.parentElement);
      }
    }
    renderedCache.set(el, result);
    return result;
  }

  function implicitRole(el: Element): string | null {
    const tag = el.tagName;
    switch (tag) {
      case "A":
      case "AREA":
        return el.hasAttribute("href") ? "link" : "generic";
      case "BUTTON":
        return "button";
      case "INPUT": {
        const type = (attr(el, "type") || "text").toLowerCase();
        if (type === "hidden") return null;
        if (["button", "image", "reset", "submit"].includes(type)) return "button";
        if (type === "checkbox") return "checkbox";
        if (type === "radio") return "radio";
        if (type === "range") return "slider";
        if (type === "number") return "spinbutton";
        if (type === "search") return "searchbox";
        return "textbox";
      }
      case "SELECT":
        return el.hasAttribute("multiple") || Number(attr(el, "size")) > 1 ? "listbox" : "combobox";
      case "TEXTAREA":
        return "textbox";
      case "NAV":
        return "navigation";
      case "MAIN":
        return "main";
      case "ASIDE":
        return "complementary";
      case "HEADER":
      case "FOOTER": {
        for (let p = el.parentElement; p; p = p.parentElement) {
          if (SECTIONING.has(p.tagName)) return "generic";
        }
        return tag === "HEADER" ? "banner" : "contentinfo";
      }
      case "SEARCH":
        return "search";
      // A form or section is only a landmark once it has a name (HTML-AAM).
      case "FORM":
        return el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby") ? "form" : "generic";
      case "SECTION":
        return el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby") ? "region" : "generic";
      case "ARTICLE":
        return "article";
      case "H1": case "H2": case "H3": case "H4": case "H5": case "H6":
        return "heading";
      case "UL":
      case "OL":
      case "MENU":
        return "list";
      case "LI":
        return "listitem";
      case "TABLE":
        return "table";
      case "THEAD":
      case "TBODY":
      case "TFOOT":
        return "rowgroup";
      case "TR":
        return "row";
      case "TD":
        return "cell";
      case "TH":
        return "columnheader";
      case "IMG":
        return attr(el, "alt") === "" ? "presentation" : "img";
      case "DIALOG":
        return "dialog";
      case "OPTION":
        return "option";
      case "PROGRESS":
        return "progressbar";
      case "METER":
        return "meter";
      case "HR":
        return "separator";
      case "FIELDSET":
      case "DETAILS":
        return "group";
      case "OUTPUT":
        return "status";
      case "P":
        return "paragraph";
      default:
        return GENERIC_TAGS.has(tag) || tag.includes("-") ? "generic" : null;
    }
  }

  function effectiveRole(el: Element): string | null {
    if (roleCache.has(el)) return roleCache.get(el) ?? null;
    let role: string | null = null;
    const raw = attr(el, "role");
    if (raw) {
      role = raw.toLowerCase().split(/\s+/).find((t) => VALID.has(t)) ?? null;
    }
    if (role === null) role = implicitRole(el);
    roleCache.set(el, role);
    return role;
  }

  function isNativelyInteractive(el: Element): boolean {
    switch (el.tagName) {
      case "A":
      case "AREA":
        return el.hasAttribute("href");
      case "INPUT":
        return (attr(el, "type") || "").toLowerCase() !== "hidden";
      case "BUTTON":
      case "SELECT":
      case "TEXTAREA":
      case "SUMMARY":
        return true;
      default:
        return false;
    }
  }

  function isDisabled(el: Element): boolean {
    if (["BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(el.tagName) && el.hasAttribute("disabled")) {
      return true;
    }
    return (attr(el, "aria-disabled") || "").toLowerCase() === "true";
  }

  function tabIndexOf(el: Element): number | null {
    const raw = attr(el, "tabindex");
    if (raw === null || !/^\s*-?\d+\s*$/.test(raw)) return null;
    return parseInt(raw, 10);
  }

  function isFocusable(el: Element): boolean {
    if (["BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(el.tagName) && el.hasAttribute("disabled")) {
      return false;
    }
    if (tabIndexOf(el) !== null) return true;
    if (isNativelyInteractive(el)) return true;
    if (el.tagName === "IFRAME") return true;
    if ((el.tagName === "AUDIO" || el.tagName === "VIDEO") && el.hasAttribute("controls")) return true;
    const editable = attr(el, "contenteditable");
    return editable === "" || editable === "true";
  }

  /** Text a user would perceive, skipping aria-hidden subtrees and using img alt. */
  function textOf(node: Node): string {
    let out = "";
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        out += child.textContent ?? "";
      } else if (child.nodeType === 1) {
        const el = child as Element;
        if ((attr(el, "aria-hidden") || "").toLowerCase() === "true" || !isRendered(el)) return;
        if (el.tagName === "IMG") {
          out += " " + (attr(el, "alt") ?? "") + " ";
        } else {
          out += " " + textOf(el) + " ";
        }
      }
    });
    return norm(out);
  }

  function labelText(el: Element, labelsByFor: Map<string, Element[]>): string {
    const parts: string[] = [];
    if (el.id && labelsByFor.has(el.id)) {
      for (const label of labelsByFor.get(el.id)!) parts.push(textOf(label));
    }
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (p.tagName === "LABEL") {
        parts.push(textOf(p));
        break;
      }
    }
    return norm(parts.join(" "));
  }

  function accessibleName(
    el: Element,
    role: string | null,
    labelsByFor: Map<string, Element[]>
  ): { name: string; source: AriaNodeSnapshot["nameSource"] } {
    const labelledby = attr(el, "aria-labelledby");
    if (labelledby) {
      const text = norm(
        labelledby
          .split(/\s+/)
          .map((id) => document.getElementById(id))
          .filter((ref): ref is HTMLElement => ref !== null)
          .map((ref) => textOf(ref))
          .join(" ")
      );
      if (text) return { name: text, source: "aria-labelledby" };
    }
    const label = norm(attr(el, "aria-label") ?? "");
    if (label) return { name: label, source: "aria-label" };

    if (["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) {
      const type = (attr(el, "type") || "").toLowerCase();
      if (el.tagName === "INPUT" && ["button", "submit", "reset"].includes(type)) {
        const value = norm(attr(el, "value") ?? "");
        if (value) return { name: value, source: "native" };
        if (type !== "button") return { name: type === "submit" ? "Submit" : "Reset", source: "native" };
      } else if (el.tagName === "INPUT" && type === "image") {
        const alt = norm(attr(el, "alt") ?? "");
        if (alt) return { name: alt, source: "native" };
      } else {
        const text = labelText(el, labelsByFor);
        if (text) return { name: text, source: "native" };
      }
    } else if (el.tagName === "IMG") {
      const alt = norm(attr(el, "alt") ?? "");
      if (alt) return { name: alt, source: "native" };
    }

    if (role !== null && NAME_FROM_CONTENT.has(role)) {
      const text = textOf(el);
      if (text) return { name: text, source: "content" };
    }

    const title = norm(attr(el, "title") ?? "");
    if (title) return { name: title, source: "title" };
    const placeholder = norm(attr(el, "placeholder") ?? "");
    if (placeholder) return { name: placeholder, source: "native" };
    return { name: "", source: "none" };
  }

  function locatorFor(el: Element): string {
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return "#" + el.id;
    const segments: string[] = [];
    for (let node: Element | null = el; node && node.tagName !== "BODY" && node.tagName !== "HTML"; node = node.parentElement) {
      if (node !== el && node.id && /^[A-Za-z][\w-]*$/.test(node.id)) {
        segments.unshift("#" + node.id);
        return segments.join(" > ");
      }
      const tag = node.tagName.toLowerCase();
      const parent: Element | null = node.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
        segments.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${sameTag.indexOf(node) + 1})` : tag);
      } else {
        segments.unshift(tag);
      }
    }
    return segments.length > 0 ? "body > " + segments.join(" > ") : "body";
  }

  function snippetOf(el: Element): string {
    const attrs = Array.from(el.attributes)
      .map((a) => (a.value === "" ? a.name : `${a.name}="${a.value}"`))
      .join(" ");
    const open = `<${el.tagName.toLowerCase()}${attrs ? " " + attrs : ""}>`;
    return open.length > 200 ? open.slice(0, 197) + "...>" : open;
  }

  /** Nearest ancestor with a meaningful role. */
  function parentRoleOf(el: Element): string | null {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const role = effectiveRole(p);
      if (role !== null && !PRESENTATIONAL.has(role)) return role;
    }
    return null;
  }

  /** Roles of owned elements, looking through wrappers that carry no role. */
  function ownedRolesOf(el: Element): string[] {
    const roles: string[] = [];
    const visit = (parent: Element): void => {
      for (const child of Array.from(parent.children)) {
        if (roles.length >= 50) return;
        if (!isRendered(child)) continue;
        const role = effectiveRole(child);
        if (role === null || PRESENTATIONAL.has(role)) {
          visit(child);
        } else {
          roles.push(role);
        }
      }
    };
    visit(el);
    for (const id of (attr(el, "aria-owns") || "").split(/\s+/).filter(Boolean)) {
      const owned = document.getElementById(id);
      const role = owned ? effectiveRole(owned) : null;
      if (role !== null) roles.push(role);
    }
    return roles;
  }

  function countFocusableDescendants(el: Element): number {
    let count = 0;
    const visit = (parent: Element): void => {
      for (const child of Array.from(parent.children)) {
        if (!isRendered(child)) continue;
        if (isFocusable(child)) count += 1;
        visit(child);
      }
    };
    visit(el);
    return count;
  }

  // Walk the document once: gather labels for name computation and the
  // candidates worth reporting on.
  const all: Element[] = [];
  const labelsByFor = new Map<string, Element[]>();
  const walk = (parent: Element): void => {
    for (const child of Array.from(parent.children)) {
      all.push(child);
      if (child.tagName === "LABEL") {
        const target = attr(child, "for");
        if (target) labelsByFor.set(target, [...(labelsByFor.get(target) ?? []), child]);
      }
      walk(child);
    }
  };
  if (document.body) walk(document.body);

  const elements: AriaNodeSnapshot[] = [];
  let truncated = false;
  for (const el of all) {
    const ariaAttributes: Record<string, string> = {};
    for (const a of Array.from(el.attributes)) {
      if (a.name.startsWith("aria-")) ariaAttributes[a.name] = a.value;
    }
    const roleAttr = attr(el, "role") ?? undefined;
    const implicit = implicitRole(el);
    const hasAria = roleAttr !== undefined || Object.keys(ariaAttributes).length > 0;
    const isLandmark = implicit !== null && LANDMARKS.has(implicit);
    const customFocus = tabIndexOf(el) !== null && !isNativelyInteractive(el);
    if (!hasAria && !isLandmark && !customFocus) continue;
    if (!isRendered(el)) continue;
    if (elements.length >= maxElements) {
      truncated = true;
      break;
    }

    const role = effectiveRole(el);
    const focusable = isFocusable(el);
    const tabIndex = tabIndexOf(el);
    const { name, source } = accessibleName(el, role, labelsByFor);

    const missingIdrefs: Record<string, string[]> = {};
    for (const idrefAttr of IDREF_ATTRS) {
      const value = attr(el, idrefAttr);
      if (value === null) continue;
      const missing = value.split(/\s+/).filter((id) => id && !document.getElementById(id));
      if (missing.length > 0) missingIdrefs[idrefAttr] = missing;
    }

    let inAriaHiddenSubtree = false;
    for (let p: Element | null = el; p; p = p.parentElement) {
      if ((attr(p, "aria-hidden") || "").toLowerCase() === "true") {
        inAriaHiddenSubtree = true;
        break;
      }
    }

    elements.push({
      tag: el.tagName.toLowerCase(),
      locator: locatorFor(el),
      snippet: snippetOf(el),
      roleAttr,
      effectiveRole: role,
      implicitRole: implicit,
      ariaAttributes,
      focusable,
      tabbable: focusable && (tabIndex === null || tabIndex >= 0),
      nativelyInteractive: isNativelyInteractive(el),
      disabled: isDisabled(el),
      accessibleName: name,
      nameSource: source,
      visibleText: textOf(el),
      missingIdrefs,
      parentRole: parentRoleOf(el),
      ownedRoles: ownedRolesOf(el),
      inAriaHiddenSubtree,
      focusableDescendants: "aria-hidden" in ariaAttributes ? countFocusableDescendants(el) : 0,
    });
  }

  return {
    url: window.location.href,
    title: document.title || "Untitled",
    elements,
    elementsScanned: all.length,
    truncated,
  };
}
