/**
 * Minimal hand-rolled ABI codec.
 *
 * Only the subset this page needs is implemented: static words (address,
 * uint256, bytes32), dynamic `bytes`, dynamic `string`, and flat arrays. All
 * numeric work is BigInt so 18-decimal amounts never touch a float.
 */

import { ZERO_ADDRESS } from "../config.js";

const WORD_HEX = 64;

export function strip0x(hex) {
  const s = String(hex ?? "");
  return s.startsWith("0x") || s.startsWith("0X") ? s.slice(2) : s;
}

/** Left-pad an address into a 32-byte word. */
export function padAddress(address) {
  const clean = strip0x(address).toLowerCase();
  if (clean.length !== 40) throw new Error(`Not a 20-byte address: ${address}`);
  return clean.padStart(WORD_HEX, "0");
}

/** Left-pad an unsigned integer into a 32-byte word. */
export function padUint(value) {
  const n = typeof value === "bigint" ? value : BigInt(value);
  if (n < 0n) throw new Error("Cannot encode a negative uint");
  const hex = n.toString(16);
  if (hex.length > WORD_HEX) throw new Error("uint256 overflow");
  return hex.padStart(WORD_HEX, "0");
}

/** Normalise a bytes32 value (e.g. a pool id or tx hash) to a bare word. */
export function padBytes32(value) {
  const clean = strip0x(value);
  if (clean.length !== WORD_HEX) throw new Error(`Not a 32-byte value: ${value}`);
  return clean;
}

/** Split return data into 32-byte words. */
export function toWords(hex) {
  const data = strip0x(hex);
  const out = [];
  for (let i = 0; i < data.length; i += WORD_HEX) out.push(data.slice(i, i + WORD_HEX));
  return out;
}

export function decodeAddress(word) {
  if (!word) return ZERO_ADDRESS;
  return `0x${word.slice(24)}`;
}

export function decodeUint(word) {
  if (!word) return 0n;
  return BigInt(`0x${word}`);
}

/** Decode the first word of a call's return data as an address. */
export function firstAddress(returnData) {
  return decodeAddress(toWords(returnData)[0]);
}

/** Decode the first word of a call's return data as a uint256. */
export function firstUint(returnData) {
  return decodeUint(toWords(returnData)[0]);
}

/**
 * Encode a dynamic `bytes` tail block: a length word followed by the payload
 * right-padded to a 32-byte boundary.
 */
export function encodeBytes(hexData) {
  const clean = strip0x(hexData);
  if (clean.length % 2 !== 0) throw new Error("bytes payload must be whole octets");
  const lengthWord = padUint(clean.length / 2);
  const paddedLength = Math.ceil(clean.length / WORD_HEX) * WORD_HEX;
  return lengthWord + clean.padEnd(paddedLength, "0");
}

const utf8Decoder = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8", { fatal: false }) : null;

function hexToText(hexChars) {
  const bytes = new Uint8Array(hexChars.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hexChars.substr(i * 2, 2), 16);
  }
  if (utf8Decoder) return utf8Decoder.decode(bytes);
  let out = "";
  bytes.forEach((b) => {
    out += String.fromCharCode(b);
  });
  return out;
}

/**
 * Decode an ABI string return value.
 *
 * Handles both the standard dynamic encoding and the older `bytes32` style
 * some tokens still use for `symbol()`, where the whole return value is a
 * single zero-padded word rather than offset + length + data.
 */
export function decodeString(returnData) {
  const data = strip0x(returnData);
  if (!data) return null;

  try {
    // Raw bytes32: exactly one word, not a valid (offset, length, data) triple.
    if (data.length === WORD_HEX) {
      const text = hexToText(data).replace(/\0+$/, "").trim();
      return text || null;
    }

    const words = toWords(data);
    const length = Number(decodeUint(words[1]));
    if (!Number.isFinite(length) || length <= 0) return null;
    const payload = words.slice(2).join("").slice(0, length * 2);
    const text = hexToText(payload).replace(/\0+$/, "").trim();
    return text || null;
  } catch {
    return null;
  }
}

/**
 * Decode `Vault.getPoolTokens(bytes32)` →
 * `(IERC20[] tokens, uint256[] balances, uint256 lastChangeBlock)`.
 *
 * The array offsets in the head are followed rather than assumed, so a
 * differently-packed response decodes correctly instead of silently producing
 * garbage balances.
 */
export function decodePoolTokens(returnData) {
  const words = toWords(returnData);
  if (words.length < 4) throw new Error("Malformed getPoolTokens response");

  const readArray = (offsetWordIndex, decode) => {
    const byteOffset = Number(decodeUint(words[offsetWordIndex]));
    const head = byteOffset / 32;
    if (!Number.isInteger(head) || head < 0 || head >= words.length) {
      throw new Error("Malformed getPoolTokens offset");
    }
    const length = Number(decodeUint(words[head]));
    // The final element sits at words[head + length], so that index must exist.
    if (!Number.isInteger(length) || length < 0 || head + length >= words.length) {
      throw new Error("Malformed getPoolTokens array");
    }
    return Array.from({ length }, (_, i) => decode(words[head + 1 + i]));
  };

  return {
    tokens: readArray(0, decodeAddress),
    balances: readArray(1, decodeUint),
    lastChangeBlock: decodeUint(words[2]),
  };
}

/** Decode a Safe `getOwners()` response. */
export function decodeAddressArray(returnData) {
  const words = toWords(returnData);
  const byteOffset = Number(decodeUint(words[0]));
  const head = byteOffset / 32;
  const length = Number(decodeUint(words[head]));
  return Array.from({ length }, (_, i) => decodeAddress(words[head + 1 + i]));
}

// ---------------------------------------------------------------------------
// Address helpers
// ---------------------------------------------------------------------------

export function isAddress(value) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(value ?? "").trim());
}

export function isZeroAddress(value) {
  return Boolean(value) && String(value).toLowerCase() === ZERO_ADDRESS;
}

export function sameAddress(a, b) {
  return Boolean(a) && Boolean(b) && String(a).toLowerCase() === String(b).toLowerCase();
}

export function shorten(value, lead = 6, tail = 4) {
  if (!value) return "—";
  const s = String(value);
  return s.length <= lead + tail + 1 ? s : `${s.slice(0, lead)}…${s.slice(-tail)}`;
}

// ---------------------------------------------------------------------------
// Amount formatting — pure BigInt string maths, no floating point
// ---------------------------------------------------------------------------

export function formatUnits(value, decimals, maxDecimals = 6) {
  let amount = typeof value === "bigint" ? value : BigInt(value ?? 0);
  const negative = amount < 0n;
  if (negative) amount = -amount;

  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const fractionRaw = (amount % base).toString().padStart(decimals, "0");
  const fraction = fractionRaw.slice(0, maxDecimals).replace(/0+$/, "");
  const wholeGrouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return `${negative ? "-" : ""}${wholeGrouped}${fraction ? `.${fraction}` : ""}`;
}
