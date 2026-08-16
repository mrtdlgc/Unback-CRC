/**
 * Precomputed 4-byte function selectors: keccak256(signature)[0:4].
 *
 * There is no keccak implementation in this bundle, so these are baked in as
 * constants. Every entry carries the exact signature string it was derived
 * from, so any of them can be re-derived independently, e.g.:
 *
 *   cast sig 'releaseBalancerPoolTokens(address)'
 *
 * All 27 were verified against a fresh keccak256 of the signature below, and
 * the load-bearing ones were additionally exercised against the live contracts
 * on Gnosis Chain.
 */
export const SELECTORS = {
  // --- CirclesBackingFactory ---
  computeAddress: "0x4e1d91d8", // computeAddress(address)
  releaseTimestamp: "0x0a3f013f", // releaseTimestamp()
  exitLBP: "0x9fed668a", // exitLBP(address,uint256,uint256,uint256)
  VAULT: "0x411557d1", // VAULT()

  // --- CirclesBacking (one instance per backer, CREATE2) ---
  BACKER: "0x89d220eb", // BACKER()
  lbp: "0x092f7de7", // lbp()
  balancerPoolTokensUnlockTimestamp: "0xe6e0ea03", // balancerPoolTokensUnlockTimestamp()
  BACKING_ASSET: "0xdca3d4d6", // BACKING_ASSET()
  STABLE_CRC_AMOUNT: "0x795c8dfc", // STABLE_CRC_AMOUNT()
  releaseBalancerPoolTokens: "0x80729c25", // releaseBalancerPoolTokens(address)

  // --- Balancer ---
  getPoolId: "0x38fff2d0", // getPoolId()
  getPoolTokens: "0xf94d4668", // getPoolTokens(bytes32)

  // --- ERC-20 ---
  balanceOf: "0x70a08231", // balanceOf(address)
  totalSupply: "0x18160ddd", // totalSupply()
  approve: "0x095ea7b3", // approve(address,uint256)
  allowance: "0xdd62ed3e", // allowance(address,address)
  symbol: "0x95d89b41", // symbol()
  decimals: "0x313ce567", // decimals()

  // --- Safe (v1.4.1) ---
  nonce: "0xaffed0e0", // nonce()
  getThreshold: "0xe75235b8", // getThreshold()
  getOwners: "0xa0e67e2b", // getOwners()
  getTransactionHash: "0xd8d11f78", // getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256)
  approvedHashes: "0x7d832974", // approvedHashes(address,bytes32)
  approveHash: "0xd4d9bdcd", // approveHash(bytes32)
  execTransaction: "0x6a761202", // execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)
};

/**
 * keccak256("ExecutionFailure(bytes32,uint256)").
 *
 * A Safe's execTransaction succeeds at the transaction level even when the
 * inner call reverts — it emits this event and returns false. Without checking
 * for it, a reverted release reports "Done." while nothing moved.
 */
export const TOPIC_EXECUTION_FAILURE =
  "0x23428b18acfb3ea64b08dc0c1d296ea9c09702c09083ca5272e64d115b687d23";
