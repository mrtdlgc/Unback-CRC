/**
 * Safe (v1.4.1) calldata encoding.
 *
 * Both `getTransactionHash` and `execTransaction` take the same ten-parameter
 * SafeTx tuple, so they share a head layout:
 *
 *   0  address to
 *   1  uint256 value
 *   2  bytes    data          -> offset into the tail
 *   3  uint8    operation
 *   4  uint256  safeTxGas
 *   5  uint256  baseGas
 *   6  uint256  gasPrice
 *   7  address  gasToken
 *   8  address  refundReceiver
 *   9  uint256  nonce  /  bytes signatures -> offset into the tail
 *
 * Ten head words means the tail always starts at byte offset 320.
 *
 * Every field except `to`, `data` and `nonce` is pinned to zero. That is what
 * makes the flow work without any off-chain coordination: two owners who open
 * this page independently feed identical inputs into `getTransactionHash` and
 * therefore arrive at the same Safe transaction hash, with nothing to share
 * between them. `operation = 0` also keeps this a plain CALL, never a
 * delegatecall.
 */

import { SELECTORS } from "../abi/selectors.js";
import { encodeBytes, padAddress, padBytes32, padUint, strip0x } from "../abi/codec.js";
import { ZERO_ADDRESS } from "../config.js";

const HEAD_WORDS = 10;
const TAIL_START = HEAD_WORDS * 32; // 320

function buildHead(to, lastWord) {
  return [
    padAddress(to), // to
    padUint(0n), // value
    padUint(TAIL_START), // data offset
    padUint(0n), // operation = Call
    padUint(0n), // safeTxGas
    padUint(0n), // baseGas
    padUint(0n), // gasPrice
    padAddress(ZERO_ADDRESS), // gasToken
    padAddress(ZERO_ADDRESS), // refundReceiver
    lastWord, // nonce, or the signatures offset
  ].join("");
}

/** Arguments for `getTransactionHash(...)`, minus the selector. */
export function buildTransactionHashArgs(to, data, nonce) {
  return buildHead(to, padUint(nonce)) + encodeBytes(data);
}

/** Full calldata for `execTransaction(...)`. */
export function buildExecTransactionCalldata(to, data, signatures) {
  const dataBlock = encodeBytes(data);
  // `signatures` is the second dynamic parameter, so it starts immediately
  // after the encoded `data` block.
  const signaturesOffset = TAIL_START + dataBlock.length / 2;

  return (
    SELECTORS.execTransaction +
    buildHead(to, padUint(signaturesOffset)) +
    dataBlock +
    encodeBytes(signatures)
  );
}

/**
 * Encode the "pre-approved hash" signature type for a set of owners.
 *
 * Each 65-byte signature is `r = owner address, s = 0, v = 1`. Safe's
 * `checkNSignatures` requires the owners to be strictly ascending by address,
 * so they are sorted here.
 *
 * A `v = 1` entry is accepted when the owner either called `approveHash`
 * earlier or *is the account sending this transaction* — see `selectSigners`.
 */
export function encodeApprovedHashSignatures(owners) {
  const sorted = owners
    .slice()
    .sort((a, b) => {
      const left = BigInt(a.toLowerCase());
      const right = BigInt(b.toLowerCase());
      if (left < right) return -1;
      return left > right ? 1 : 0;
    });

  return sorted.map((owner) => padAddress(owner) + padUint(0n) + "01").join("");
}

/** Calldata for `approveHash(bytes32)`. */
export function encodeApproveHash(transactionHash) {
  return SELECTORS.approveHash + padBytes32(strip0x(transactionHash));
}
