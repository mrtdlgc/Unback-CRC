/**
 * DOM helpers.
 *
 * Everything builds nodes and assigns `textContent` rather than concatenating
 * `innerHTML`. Some of the strings rendered here come straight off-chain — a
 * token's `symbol()` is attacker-controlled for any pool token — so string
 * templating would be an injection sink.
 */

export function byId(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node;
}

/**
 * Create an element.
 *
 * `props.text` sets textContent, `props.class` the class name, `props.attrs`
 * arbitrary attributes, and any `on*` key binds an event listener.
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;

    if (key === "text") node.textContent = String(value);
    else if (key === "class") node.className = value;
    else if (key === "attrs") {
      for (const [name, attrValue] of Object.entries(value)) {
        if (attrValue === undefined || attrValue === null || attrValue === false) continue;
        node.setAttribute(name, attrValue === true ? "" : String(attrValue));
      }
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      node[key] = value;
    }
  }

  for (const child of [].concat(children)) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child);
  }

  return node;
}

/** An external link that cannot reach back through `window.opener`. */
export function externalLink(href, label, className = "addr-link") {
  return el("a", {
    class: className,
    href,
    text: label,
    target: "_blank",
    rel: "noopener noreferrer",
  });
}

/** Replace a node's contents with the given children. */
export function render(node, children) {
  node.replaceChildren(...[].concat(children).filter(Boolean));
}

export function setHidden(node, hidden) {
  node.hidden = Boolean(hidden);
}

/** A `<p class="hint">` line, optionally toned as a warning or success. */
export function hint(message, tone) {
  return el("p", { class: tone ? `hint ${tone}` : "hint", text: message });
}
