/** Date, duration and explorer-link formatting. */

import { EXPLORER, RELEASE_DISABLED_SENTINEL } from "../config.js";

export function explorerAddress(address) {
  return `${EXPLORER}/address/${address}`;
}

export function explorerTx(hash) {
  return `${EXPLORER}/tx/${hash}`;
}

export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

/** True for a timestamp that encodes "never" rather than a real date. */
export function isSentinelTimestamp(timestamp) {
  return !timestamp || timestamp >= RELEASE_DISABLED_SENTINEL;
}

export function formatDate(timestamp) {
  if (!timestamp) return "—";
  return new Date(timestamp * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** Coarse countdown: drops to finer units only as the deadline approaches. */
export function formatCountdown(timestamp) {
  const remaining = timestamp - nowSeconds();
  if (remaining <= 0) return "Unlocked";

  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export function formatPercent(numerator, denominator, fractionDigits = 2) {
  if (!denominator || denominator === 0n) return "0.00";
  const scaled = Number((numerator * 10000n) / denominator) / 100;
  return scaled.toFixed(fractionDigits);
}
