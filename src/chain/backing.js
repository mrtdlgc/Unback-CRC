/**
 * Circles backing domain reads.
 *
 * A backer deposits a stable asset plus their own CRC into a per-backer
 * `CirclesBacking` instance (CREATE2, one per address). The instance swaps via
 * CoW Swap, creates a Balancer LBP, and holds the resulting pool tokens for a
 * year before the backer can reclaim them.
 */

import { SELECTORS } from "../abi/selectors.js";
import {
  decodePoolTokens,
  firstAddress,
  firstUint,
  isZeroAddress,
  padAddress,
  padBytes32,
  padUint,
  toWords,
} from "../abi/codec.js";
import { FACTORY_ADDRESS } from "../config.js";
import { nowSeconds, isSentinelTimestamp } from "../util/format.js";
import { callFunction, hasCode } from "./rpc.js";
import { balanceOf, tokenMetadata, totalSupply } from "./erc20.js";

/** Where a backing position can be in its lifecycle. */
export const PositionStatus = {
  MISSING: "missing", // no instance deployed for this address
  PENDING: "pending", // instance exists, CoW swap has not settled into an LBP yet
  LOCKED: "locked", // holding pool tokens, still inside the lock
  READY: "ready", // unlocked, instance still holds the pool tokens
  HOLDING: "holding", // released to the backer, redemption steps still to run
  RELEASED: "released", // fully withdrawn
};

export async function computeInstanceAddress(backer) {
  return firstAddress(
    await callFunction(FACTORY_ADDRESS, SELECTORS.computeAddress, padAddress(backer)),
  );
}

export async function readFactoryReleaseTimestamp() {
  return Number(firstUint(await callFunction(FACTORY_ADDRESS, SELECTORS.releaseTimestamp)));
}

export async function readVaultAddress() {
  return firstAddress(await callFunction(FACTORY_ADDRESS, SELECTORS.VAULT));
}

/**
 * Live snapshot of the Balancer pool backing this position.
 *
 * Read fresh whenever slippage bounds are computed — pool balances move with
 * every trade, and a stale snapshot either under-protects the exit or makes it
 * revert on `minAmountsOut`.
 */
export async function readPoolSnapshot(vault, poolId, lbp) {
  const [poolData, supply] = await Promise.all([
    callFunction(vault, SELECTORS.getPoolTokens, padBytes32(poolId)),
    totalSupply(lbp),
  ]);
  const pool = decodePoolTokens(poolData);
  return { tokens: pool.tokens, balances: pool.balances, totalSupply: supply };
}

/**
 * Load everything the UI needs about one address's backing position.
 *
 * Reads are issued in parallel wherever they do not depend on each other; the
 * whole lookup is four sequential round-trip groups rather than a dozen.
 */
export async function loadPosition(lookupAddress) {
  const instance = await computeInstanceAddress(lookupAddress);

  if (!(await hasCode(instance))) {
    return { lookupAddress, instance, status: PositionStatus.MISSING };
  }

  const lbp = firstAddress(await callFunction(instance, SELECTORS.lbp));
  if (isZeroAddress(lbp)) {
    return { lookupAddress, instance, status: PositionStatus.PENDING };
  }

  const [backer, unlockTimestamp, crcAmount, backingAsset, factoryRelease, vault, poolId] =
    await Promise.all([
      callFunction(instance, SELECTORS.BACKER).then(firstAddress),
      callFunction(instance, SELECTORS.balancerPoolTokensUnlockTimestamp).then((r) =>
        Number(firstUint(r)),
      ),
      callFunction(instance, SELECTORS.STABLE_CRC_AMOUNT).then(firstUint),
      callFunction(instance, SELECTORS.BACKING_ASSET).then(firstAddress),
      readFactoryReleaseTimestamp(),
      readVaultAddress(),
      callFunction(lbp, SELECTORS.getPoolId).then((r) => `0x${toWords(r)[0]}`),
    ]);

  const [instanceBpt, backerBpt, snapshot, assetMetadata] = await Promise.all([
    balanceOf(lbp, instance),
    balanceOf(lbp, backer),
    readPoolSnapshot(vault, poolId, lbp),
    tokenMetadata(backingAsset),
  ]);

  const poolMetadata = await Promise.all(snapshot.tokens.map((token) => tokenMetadata(token)));

  const now = nowSeconds();
  // Mirrors CirclesBacking.releaseBalancerPoolTokens: the release is permitted
  // when EITHER the instance's own lock has expired OR the factory's global
  // early-release switch has been flipped to a past timestamp.
  const unlocked = now >= unlockTimestamp || now >= factoryRelease;
  const effectiveUnlock = isSentinelTimestamp(factoryRelease)
    ? unlockTimestamp
    : Math.min(unlockTimestamp, factoryRelease);

  let status;
  if (instanceBpt === 0n && backerBpt === 0n) status = PositionStatus.RELEASED;
  else if (instanceBpt === 0n) status = PositionStatus.HOLDING;
  else if (unlocked) status = PositionStatus.READY;
  else status = PositionStatus.LOCKED;

  return {
    lookupAddress,
    instance,
    status,
    backer,
    lbp,
    vault,
    poolId,
    unlockTimestamp,
    factoryReleaseTimestamp: factoryRelease,
    effectiveUnlock,
    unlocked,
    crcAmount,
    backingAsset,
    assetMetadata,
    instanceBpt,
    backerBpt,
    // Whichever side currently holds the position decides the pro-rata share.
    shareBpt: instanceBpt > 0n ? instanceBpt : backerBpt,
    pool: { ...snapshot, metadata: poolMetadata },
  };
}

// ---------------------------------------------------------------------------
// Calldata builders
// ---------------------------------------------------------------------------

/** `CirclesBacking.releaseBalancerPoolTokens(address receiver)` */
export function encodeRelease(receiver) {
  return SELECTORS.releaseBalancerPoolTokens + padAddress(receiver);
}

/**
 * `CirclesBackingFactory.exitLBP(address,uint256,uint256,uint256)`
 *
 * `minAmountOut0/1` line up with the token order returned by
 * `Vault.getPoolTokens(poolId)`, which is the order used everywhere here.
 */
export function encodeExitLBP(lbp, bptAmount, minAmountOut0, minAmountOut1) {
  return (
    SELECTORS.exitLBP +
    padAddress(lbp) +
    padUint(bptAmount) +
    padUint(minAmountOut0) +
    padUint(minAmountOut1)
  );
}

/** Pro-rata share of one pool token for a given BPT amount. */
export function proRataAmount(poolBalance, bptAmount, bptTotalSupply) {
  if (!bptTotalSupply || bptTotalSupply === 0n) return 0n;
  return (poolBalance * bptAmount) / bptTotalSupply;
}

/** Apply a slippage tolerance expressed in basis points. */
export function applySlippage(amount, slippageBps) {
  return amount - (amount * slippageBps) / 10000n;
}
