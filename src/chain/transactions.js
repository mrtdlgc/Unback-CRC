/** Transaction confirmation and result checking. */

import { RECEIPT_POLL_ATTEMPTS, RECEIPT_POLL_INTERVAL_MS } from "../config.js";
import { TOPIC_EXECUTION_FAILURE } from "../abi/selectors.js";
import { getTransactionReceipt } from "./rpc.js";
import { sleep } from "../util/async.js";

/**
 * Poll the public RPC layer until the receipt shows up.
 *
 * Deliberately not asking the wallet: if the user has since switched networks,
 * their provider may answer `null` forever for a Gnosis Chain hash.
 */
export async function waitForReceipt(hash) {
  for (let attempt = 0; attempt < RECEIPT_POLL_ATTEMPTS; attempt += 1) {
    try {
      const receipt = await getTransactionReceipt(hash);
      if (receipt) return receipt;
    } catch {
      /* transient node error — keep polling */
    }
    await sleep(RECEIPT_POLL_INTERVAL_MS);
  }
  return null;
}

/**
 * Throw unless the transaction genuinely did what it was asked to.
 *
 * A Safe's `execTransaction` returns success at the transaction level even when
 * the inner call reverts — it emits `ExecutionFailure` and returns false. Not
 * checking for that reports "Done." while nothing moved and the Safe just paid
 * for gas.
 */
export function assertReceiptSucceeded(receipt, label) {
  if (!receipt) {
    throw new Error(
      `${label} was submitted but no receipt arrived in time — check the explorer before retrying.`,
    );
  }

  if (receipt.status && receipt.status !== "0x1") {
    throw new Error(`${label} reverted on-chain.`);
  }

  const innerCallFailed = (receipt.logs || []).some(
    (log) => log?.topics?.[0]?.toLowerCase() === TOPIC_EXECUTION_FAILURE,
  );

  if (innerCallFailed) {
    throw new Error(
      "The Safe transaction executed, but the inner call failed (ExecutionFailure) — " +
        "nothing moved and the Safe only paid gas.",
    );
  }

  return receipt;
}
