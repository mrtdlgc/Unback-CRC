/** Small async utilities shared by the RPC and wallet layers. */

export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Reject with `message` if `promise` has not settled within `ms`.
 *
 * Used around wallet requests: an extension that never answers
 * `eth_requestAccounts` would otherwise leave a permanently spinning button
 * with no explanation.
 */
export function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

/** Normalise anything thrown into a readable sentence. */
export function errorMessage(error) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  // Wallet providers nest the useful text one or two levels down.
  const nested = error.data?.message || error.error?.message;
  return nested || error.message || String(error);
}
