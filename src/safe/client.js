/**
 * Safe reads and signer selection.
 *
 * The backer of a Circles position is normally a Gnosis Safe, and
 * `releaseBalancerPoolTokens` requires `msg.sender == BACKER`. An owner's own
 * EOA signature does not satisfy that — the call has to come from the Safe via
 * `execTransaction`.
 *
 * This page uses Safe's fully on-chain approval path (`approveHash` +
 * `execTransaction` with pre-approved signatures) rather than the hosted Safe
 * Transaction Service, so it depends on nothing but a public RPC node.
 */

import { SELECTORS } from "../abi/selectors.js";
import { decodeAddressArray, firstUint, padAddress, padBytes32, sameAddress, toWords } from "../abi/codec.js";
import { callFunction, hasCode } from "../chain/rpc.js";
import { buildTransactionHashArgs } from "./encoding.js";

/**
 * Read a Safe's threshold, owners and nonce.
 *
 * Returns null when `address` is not a Safe — either a plain EOA (no code) or
 * a contract that does not answer the Safe interface.
 */
export async function readSafeInfo(address) {
  if (!(await hasCode(address))) return null;

  try {
    const [thresholdData, ownersData, nonceData] = await Promise.all([
      callFunction(address, SELECTORS.getThreshold),
      callFunction(address, SELECTORS.getOwners),
      callFunction(address, SELECTORS.nonce),
    ]);

    const threshold = Number(firstUint(thresholdData));
    const owners = decodeAddressArray(ownersData);
    if (!threshold || owners.length === 0) return null;

    return { address, threshold, owners, nonce: firstUint(nonceData) };
  } catch {
    return null;
  }
}

/** Ask the Safe itself for the EIP-712 hash of the proposed transaction. */
export async function computeSafeTransactionHash(safeAddress, to, data, nonce) {
  const result = await callFunction(
    safeAddress,
    SELECTORS.getTransactionHash,
    buildTransactionHashArgs(to, data, nonce),
  );
  return `0x${toWords(result)[0]}`;
}

/** Has `owner` already recorded an on-chain approval for this hash? */
export async function hasApprovedHash(safeAddress, owner, transactionHash) {
  const result = await callFunction(
    safeAddress,
    SELECTORS.approvedHashes,
    padAddress(owner) + padBytes32(transactionHash),
  );
  return firstUint(result) !== 0n;
}

/** Read every owner's approval state for a hash in one parallel batch. */
export async function readApprovals(safeAddress, owners, transactionHash) {
  const flags = await Promise.all(
    owners.map((owner) => hasApprovedHash(safeAddress, owner, transactionHash)),
  );
  return new Set(owners.filter((_, index) => flags[index]).map((owner) => owner.toLowerCase()));
}

/**
 * Work out who can sign this execution right now, and whether that is enough.
 *
 * The key subtlety: Safe's `checkNSignatures` accepts a `v = 1` entry when
 *
 *     msg.sender == currentOwner || approvedHashes[currentOwner][dataHash] != 0
 *
 * so the account *sending* `execTransaction` counts as an approver without
 * having called `approveHash` first. For a 1-of-1 Safe — the common case for a
 * Circles avatar — that turns the whole step into a single transaction instead
 * of two, and for an N-of-M Safe it lets the final owner approve and execute at
 * once.
 */
export function selectSigners({ owners, threshold, approvals, connectedAccount }) {
  const connectedIsOwner =
    Boolean(connectedAccount) && owners.some((owner) => sameAddress(owner, connectedAccount));

  const eligible = owners.filter(
    (owner) =>
      approvals.has(owner.toLowerCase()) ||
      (connectedIsOwner && sameAddress(owner, connectedAccount)),
  );

  return {
    connectedIsOwner,
    connectedHasApproved:
      Boolean(connectedAccount) && approvals.has(String(connectedAccount).toLowerCase()),
    /** Owners whose signature this transaction could carry, if sent now. */
    eligible,
    /** Signature entries the transaction will actually use. */
    signers: eligible.slice(0, threshold),
    canExecuteNow: eligible.length >= threshold,
    approvedCount: approvals.size,
  };
}
