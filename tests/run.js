#!/usr/bin/env node
/**
 * Verification suite.
 *
 * Pure encoding/decoding is checked against fixtures, and the load-bearing
 * parts — the Safe transaction hash and the whole position lookup — are checked
 * against the live contracts on Gnosis Chain.
 *
 *   node tests/run.js
 */

import {
  decodePoolTokens,
  decodeString,
  encodeBytes,
  formatUnits,
  isAddress,
  padAddress,
  padUint,
  sameAddress,
  shorten,
  toWords,
} from "../src/abi/codec.js";
import { SELECTORS } from "../src/abi/selectors.js";
import {
  buildExecTransactionCalldata,
  buildTransactionHashArgs,
  encodeApproveHash,
  encodeApprovedHashSignatures,
} from "../src/safe/encoding.js";
import { computeSafeTransactionHash, readSafeInfo, selectSigners } from "../src/safe/client.js";
import {
  PositionStatus,
  applySlippage,
  encodeExitLBP,
  encodeRelease,
  loadPosition,
  proRataAmount,
} from "../src/chain/backing.js";
import { tokenMetadata } from "../src/chain/erc20.js";

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function equal(name, actual, expected) {
  check(name, actual === expected, `got ${actual}, expected ${expected}`);
}

// Real, verified fixtures on Gnosis Chain.
const SAFE = "0x89e5733a998C4c334870F045E44Af146BC2Ef098";
const INSTANCE = "0xa9593c6c7eca95ccfe62270dd48f042726582b05";
const LBP = "0x4488c778999cc3113ce3b2a3ce72ff9c557a85d6";
const OWNER_A = "0xbcc5b59942d896ff73fdf6f55a48f4feec9a6e9a";
const OWNER_B = "0xfd90fad33ee8b58f32c00aceead1358e4afc23f9";

console.log("\n[codec]");
{
  equal("padAddress lowercases and pads", padAddress(SAFE), `${"0".repeat(24)}89e5733a998c4c334870f045e44af146bc2ef098`);
  equal("padUint encodes BigInt", padUint(320n), `${"0".repeat(61)}140`);
  check("padUint rejects negatives", (() => { try { padUint(-1n); return false; } catch { return true; } })());
  check("padAddress rejects short input", (() => { try { padAddress("0x1234"); return false; } catch { return true; } })());

  // 36-byte payload -> length word + two padded words.
  const encoded = encodeBytes(`0x${"ab".repeat(36)}`);
  equal("encodeBytes length word", encoded.slice(0, 64), `${"0".repeat(62)}24`);
  equal("encodeBytes pads to a 32-byte boundary", (encoded.length - 64) / 64, 2);

  equal("formatUnits handles 18 decimals", formatUnits(68910783608306250413n, 18, 4), "68.9107");
  equal("formatUnits groups thousands", formatUnits(1234567890000000000000n, 18, 2), "1,234.56");
  equal("formatUnits trims trailing zeros", formatUnits(10n ** 18n, 18, 6), "1");
  equal("formatUnits handles 8 decimals", formatUnits(123456789n, 8, 8), "1.23456789");

  check("isAddress accepts a real address", isAddress(SAFE));
  check("isAddress rejects truncated input", !isAddress("0x89e5733a"));
  check("sameAddress is case-insensitive", sameAddress(SAFE, SAFE.toLowerCase()));
  equal("shorten", shorten(SAFE), "0x89e5…f098");

  // Real getPoolTokens response for the fixture pool.
  const poolReturn =
    "0x" +
    "0000000000000000000000000000000000000000000000000000000000000060" +
    "00000000000000000000000000000000000000000000000000000000000000c0" +
    "0000000000000000000000000000000000000000000000000000000002625a00" +
    "0000000000000000000000000000000000000000000000000000000000000002" +
    "000000000000000000000000af204776c7245bf4147c2612bf6e5972ee483701" +
    "000000000000000000000000de7ded22f83298803d0e50f364106ab1b304af5f" +
    "0000000000000000000000000000000000000000000000000000000000000002" +
    "0000000000000000000000000000000000000000000000026207c2c4d3a4bcd1" +
    "000000000000000000000000000000000000000000000c351b0d1b3a5b0e830b";
  const pool = decodePoolTokens(poolReturn);
  equal("decodePoolTokens token count", pool.tokens.length, 2);
  equal("decodePoolTokens follows the offsets", pool.tokens[1], "0xde7ded22f83298803d0e50f364106ab1b304af5f");
  equal("decodePoolTokens balance count", pool.balances.length, 2);
  equal("decodePoolTokens balance value", pool.balances[0], 0x26207c2c4d3a4bcd1n);
  equal("decodePoolTokens lastChangeBlock", pool.lastChangeBlock, 40000000n);

  // bytes32-style symbol() — some tokens still return this shape.
  equal("decodeString handles bytes32", decodeString(`0x${Buffer.from("GNO").toString("hex").padEnd(64, "0")}`), "GNO");
}

console.log("\n[safe encoding]");
{
  const releaseData = encodeRelease(SAFE);
  equal("encodeRelease selector", releaseData.slice(0, 10), SELECTORS.releaseBalancerPoolTokens);
  equal("encodeRelease length", (releaseData.length - 2) / 2, 36);

  const args = buildTransactionHashArgs(INSTANCE, releaseData, 1n);
  const words = toWords(args);
  equal("txHash args: to", `0x${words[0].slice(24)}`, INSTANCE);
  equal("txHash args: value is zero", words[1], "0".repeat(64));
  equal("txHash args: data offset is 320", Number(BigInt(`0x${words[2]}`)), 320);
  equal("txHash args: operation is Call", Number(BigInt(`0x${words[3]}`)), 0);
  equal("txHash args: gasToken is zero", words[7], "0".repeat(64));
  equal("txHash args: nonce", Number(BigInt(`0x${words[9]}`)), 1);
  equal("txHash args: data length word", Number(BigInt(`0x${words[10]}`)), 36);

  const signatures = encodeApprovedHashSignatures([OWNER_B, OWNER_A]);
  equal("signatures are 65 bytes each", signatures.length / 2 / 65, 2);
  check(
    "signatures sort ascending by owner",
    signatures.slice(24, 64).toLowerCase() < signatures.slice(154, 194).toLowerCase(),
    signatures,
  );
  equal("signature v byte is 1 (pre-approved)", signatures.slice(128, 130), "01");

  const execCalldata = buildExecTransactionCalldata(INSTANCE, releaseData, signatures);
  const execWords = toWords(execCalldata.slice(10));
  equal("exec calldata selector", execCalldata.slice(0, 10), SELECTORS.execTransaction);
  equal("exec calldata: data offset", Number(BigInt(`0x${execWords[2]}`)), 320);
  // data block = 1 length word + 2 payload words = 96 bytes, so signatures start at 416.
  equal("exec calldata: signatures offset", Number(BigInt(`0x${execWords[9]}`)), 416);
  equal("exec calldata: signatures length", Number(BigInt(`0x${execWords[13]}`)), 130);

  equal("encodeApproveHash length", (encodeApproveHash(`0x${"11".repeat(32)}`).length - 2) / 2, 36);

  const exitData = encodeExitLBP(LBP, 1000n, 10n, 20n);
  equal("encodeExitLBP length", (exitData.length - 2) / 2, 4 + 32 * 4);
  equal("encodeExitLBP selector", exitData.slice(0, 10), SELECTORS.exitLBP);
}

console.log("\n[signer selection]");
{
  const owners = [OWNER_A, OWNER_B];

  const noneApproved = selectSigners({ owners, threshold: 2, approvals: new Set(), connectedAccount: OWNER_A });
  check("one connected owner is not enough for 2-of-2", !noneApproved.canExecuteNow);
  equal("connected owner counts as eligible", noneApproved.eligible.length, 1);
  check("connected owner is recognised", noneApproved.connectedIsOwner);

  const oneApproved = selectSigners({
    owners,
    threshold: 2,
    approvals: new Set([OWNER_B.toLowerCase()]),
    connectedAccount: OWNER_A,
  });
  check("approved owner + connected owner reaches threshold", oneApproved.canExecuteNow);
  equal("exactly `threshold` signatures are used", oneApproved.signers.length, 2);

  const solo = selectSigners({ owners: [OWNER_A], threshold: 1, approvals: new Set(), connectedAccount: OWNER_A });
  check("1-of-1 Safe executes without a separate approveHash", solo.canExecuteNow);

  const stranger = selectSigners({
    owners,
    threshold: 1,
    approvals: new Set(),
    connectedAccount: "0x0000000000000000000000000000000000000dead",
  });
  check("non-owner cannot execute an unapproved hash", !stranger.canExecuteNow);
  check("non-owner is flagged", !stranger.connectedIsOwner);

  const relayer = selectSigners({
    owners,
    threshold: 1,
    approvals: new Set([OWNER_A.toLowerCase()]),
    connectedAccount: "0x0000000000000000000000000000000000000dead",
  });
  check("non-owner may execute once owners have approved", relayer.canExecuteNow);
}

console.log("\n[math]");
{
  equal("proRata share", proRataAmount(1000n, 25n, 100n), 250n);
  equal("proRata guards zero supply", proRataAmount(1000n, 25n, 0n), 0n);
  equal("1% slippage", applySlippage(10000n, 100n), 9900n);
  equal("0% slippage is a no-op", applySlippage(10000n, 0n), 10000n);
}

console.log("\n[live chain]");
{
  const info = await readSafeInfo(SAFE);
  check("reads the Safe", info !== null);
  equal("threshold", info.threshold, 2);
  equal("owner count", info.owners.length, 2);
  check("owners match", info.owners.some((o) => sameAddress(o, OWNER_A)));

  // The page's encoding must agree with the Safe's own getTransactionHash.
  const hash = await computeSafeTransactionHash(SAFE, INSTANCE, encodeRelease(SAFE), 1n);
  equal(
    "getTransactionHash matches the independently derived EIP-712 hash",
    hash,
    "0x2b3bf35662ebbb16759f47825b9675765d4a9a3ff31221b21a932010577125e4",
  );

  check("EOA is not mistaken for a Safe", (await readSafeInfo(OWNER_A)) === null);

  const meta = await tokenMetadata("0xaf204776c7245bf4147c2612bf6e5972ee483701");
  equal("known token symbol", meta.symbol, "sDAI");
  const crc = await tokenMetadata("0xde7ded22f83298803d0e50f364106ab1b304af5f");
  check("live symbol() lookup returns something", crc.symbol.length > 0);
  equal("live decimals() lookup", crc.decimals, 18);

  const position = await loadPosition(SAFE);
  equal("position instance address", position.instance, INSTANCE);
  equal("position status", position.status, PositionStatus.LOCKED);
  check("backer matches", sameAddress(position.backer, SAFE));
  equal("lbp", position.lbp, LBP);
  equal("vault", position.vault, "0xba12222222228d8ba445958a75a0704d566bf2c8");
  equal("pool token count", position.pool.tokens.length, 2);
  equal("backing asset symbol", position.assetMetadata.symbol, "sDAI");
  check("instance holds the pool tokens", position.instanceBpt > 0n);
  equal("share comes from the instance", position.shareBpt, position.instanceBpt);
  check("position is locked into the future", position.effectiveUnlock > Math.floor(Date.now() / 1000));
  check("global release sentinel is not treated as a date", position.effectiveUnlock === position.unlockTimestamp);

  const missing = await loadPosition("0x000000000000000000000000000000000000dEaD");
  equal("unbacked address reports missing", missing.status, PositionStatus.MISSING);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
