/** ERC-20 reads and calldata builders. */

import { SELECTORS } from "../abi/selectors.js";
import {
  decodeString,
  firstUint,
  padAddress,
  padUint,
  shorten,
  toWords,
  decodeUint,
} from "../abi/codec.js";
import { callFunction } from "./rpc.js";
import { KNOWN_TOKENS } from "../config.js";

const metadataCache = new Map();

/**
 * Resolve a token's symbol and decimals, preferring the built-in table for the
 * four supported backing assets and falling back to live calls for anything
 * else (personal CRC ERC-20s, most importantly).
 */
export async function tokenMetadata(address) {
  const key = String(address).toLowerCase();
  const cached = metadataCache.get(key);
  if (cached) return cached;

  const known = KNOWN_TOKENS[key];
  let symbol = known?.symbol ?? null;
  let decimals = known?.decimals ?? null;

  if (symbol === null) {
    try {
      symbol = decodeString(await callFunction(address, SELECTORS.symbol));
    } catch {
      symbol = null;
    }
  }

  if (decimals === null) {
    try {
      decimals = Number(decodeUint(toWords(await callFunction(address, SELECTORS.decimals))[0]));
    } catch {
      decimals = null;
    }
  }

  const metadata = {
    address,
    symbol: symbol || shorten(address),
    decimals: Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 ? decimals : 18,
  };

  metadataCache.set(key, metadata);
  return metadata;
}

export async function balanceOf(token, owner) {
  return firstUint(await callFunction(token, SELECTORS.balanceOf, padAddress(owner)));
}

export async function totalSupply(token) {
  return firstUint(await callFunction(token, SELECTORS.totalSupply));
}

export async function allowance(token, owner, spender) {
  return firstUint(
    await callFunction(token, SELECTORS.allowance, padAddress(owner) + padAddress(spender)),
  );
}

export function encodeApprove(spender, amount) {
  return SELECTORS.approve + padAddress(spender) + padUint(amount);
}
