/** The two log surfaces: submitted transactions, and errors. */

import { shorten } from "../abi/codec.js";
import { explorerTx } from "../util/format.js";
import { byId, el, externalLink, setHidden } from "./dom.js";

export function reportError(message) {
  const card = byId("errorCard");
  const list = byId("errorList");
  list.append(el("li", { text: String(message) }));
  setHidden(card, false);
}

export function clearErrors() {
  const card = byId("errorCard");
  byId("errorList").replaceChildren();
  setHidden(card, true);
}

/** Record a submitted transaction, newest first. */
export function recordActivity(label, hash) {
  const card = byId("activityCard");
  const list = byId("activityList");

  list.prepend(
    el("li", {}, [
      el("span", { text: label }),
      externalLink(explorerTx(hash), shorten(hash, 10, 8), ""),
    ]),
  );

  setHidden(card, false);
}
