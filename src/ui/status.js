/** The status "receipt" card: identity of the position and its lock state. */

import { formatUnits, shorten } from "../abi/codec.js";
import { PositionStatus } from "../chain/backing.js";
import {
  explorerAddress,
  formatCountdown,
  formatDate,
  isSentinelTimestamp,
} from "../util/format.js";
import { byId, el, externalLink, render } from "./dom.js";

let countdownTimer = null;

export function stopCountdown() {
  if (countdownTimer === null) return;
  clearInterval(countdownTimer);
  countdownTimer = null;
}

const STAMPS = {
  [PositionStatus.LOCKED]: { text: "Locked", tone: "locked" },
  [PositionStatus.READY]: { text: "Ready", tone: "ready" },
  [PositionStatus.HOLDING]: { text: "Ready", tone: "ready" },
  [PositionStatus.RELEASED]: { text: "Released", tone: "released" },
};

function fact(term, valueNode) {
  return el("div", {}, [el("dt", { text: term }), el("dd", { class: "mono" }, [valueNode])]);
}

function plainFact(term, value) {
  return el("div", {}, [el("dt", { text: term }), el("dd", { text: value })]);
}

export function renderStatus(position) {
  stopCountdown();

  const stamp = STAMPS[position.status] ?? { text: "Unknown", tone: "" };
  const badge = byId("statusStamp");
  badge.className = `stamp ${stamp.tone}`;
  badge.textContent = stamp.text;

  const facts = [
    fact("Backer", externalLink(explorerAddress(position.backer), shorten(position.backer))),
    fact(
      "Backing instance",
      externalLink(explorerAddress(position.instance), shorten(position.instance)),
    ),
    plainFact(
      "Backing asset",
      `${position.assetMetadata.symbol} (${shorten(position.backingAsset)})`,
    ),
    el("div", {}, [
      el("dt", { text: "Stable CRC locked" }),
      el("dd", { class: "mono", text: `${formatUnits(position.crcAmount, 18, 4)} CRC` }),
    ]),
    el("div", {}, [
      el("dt", { text: "Unlocks" }),
      el("dd", {
        class: "mono",
        text: position.unlockTimestamp ? formatDate(position.unlockTimestamp) : "—",
      }),
    ]),
  ];

  // Only worth showing when the admin switch is actually armed; it ships at
  // max-uint32, which means "global early release is off", not a date in 2106.
  if (!isSentinelTimestamp(position.factoryReleaseTimestamp)) {
    facts.push(
      el("div", {}, [
        el("dt", { text: "Global release" }),
        el("dd", { class: "mono", text: formatDate(position.factoryReleaseTimestamp) }),
      ]),
    );
  }

  render(byId("statusFacts"), facts);

  const label = byId("countdownLabel");
  const value = byId("countdownValue");
  value.className = "countdown-value";

  if (position.status === PositionStatus.RELEASED) {
    label.textContent = "Status";
    value.textContent = "Pool tokens already released";
    return;
  }

  if (position.status === PositionStatus.HOLDING) {
    label.textContent = "Status";
    value.textContent = "Released to the backer — finish steps 2 and 3";
    value.className = "countdown-value ready-text";
    return;
  }

  if (position.status === PositionStatus.READY) {
    label.textContent = "Status";
    value.textContent = "Unlocked — ready to withdraw";
    value.className = "countdown-value ready-text";
    return;
  }

  label.textContent = "Time remaining";
  const tick = () => {
    value.textContent = formatCountdown(position.effectiveUnlock);
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}
