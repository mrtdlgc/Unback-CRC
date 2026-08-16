/**
 * Read-only JSON-RPC client with endpoint failover.
 *
 * Every lookup on this page is a plain `eth_call` against public nodes — no
 * wallet, no API key, no indexer. Public endpoints rate-limit and go down, so
 * requests rotate through the configured list and stick to whichever endpoint
 * last answered.
 */

import { RPC_ENDPOINTS, RPC_REQUEST_TIMEOUT_MS } from "../config.js";

let preferredIndex = 0;
let requestId = 0;

async function postOnce(endpoint, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`${endpoint} returned HTTP ${response.status}`);

    const json = await response.json();
    if (json.error) {
      // A revert or bad request is the node answering correctly; retrying it on
      // another endpoint would just produce the same error more slowly.
      const error = new Error(json.error.message || "RPC error");
      error.rpcRejected = true;
      throw error;
    }
    return json.result;
  } finally {
    clearTimeout(timer);
  }
}

/** Issue a JSON-RPC call, failing over across endpoints on transport errors. */
export async function rpc(method, params = []) {
  requestId += 1;
  const payload = { jsonrpc: "2.0", id: requestId, method, params };

  let lastError = null;
  for (let attempt = 0; attempt < RPC_ENDPOINTS.length; attempt += 1) {
    const index = (preferredIndex + attempt) % RPC_ENDPOINTS.length;
    try {
      const result = await postOnce(RPC_ENDPOINTS[index], payload);
      preferredIndex = index; // stick with whatever just worked
      return result;
    } catch (error) {
      if (error?.rpcRejected) throw error;
      lastError = error;
    }
  }

  throw new Error(
    `No Gnosis Chain RPC endpoint responded (${RPC_ENDPOINTS.length} tried). ` +
      `Last error: ${lastError?.message || "unknown"}`,
  );
}

/** `eth_call` at the latest block. */
export function ethCall(to, data) {
  return rpc("eth_call", [{ to, data }, "latest"]);
}

/** Convenience wrapper: selector plus already-encoded argument words. */
export function callFunction(to, selector, encodedArgs = "") {
  return ethCall(to, selector + encodedArgs);
}

export function getCode(address) {
  return rpc("eth_getCode", [address, "latest"]);
}

export async function hasCode(address) {
  const code = await getCode(address);
  return Boolean(code) && code !== "0x";
}

export function getTransactionReceipt(hash) {
  return rpc("eth_getTransactionReceipt", [hash]);
}
