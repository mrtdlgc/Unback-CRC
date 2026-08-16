# Engineering notes

Background, verification record, and the reasoning behind the non-obvious choices. For layout and
deployment see [README.md](README.md).

## Domain background

Circles lets a user "back" their personal CRC token: they deposit ~$100 of a stable asset
(sDAI/GNO/WETH/WBTC) plus some of their own CRC into a dedicated per-user contract
(`CirclesBacking`, deployed by `CirclesBackingFactory` via CREATE2, one instance per backer). That
contract swaps the deposit through CoW Swap and creates a Balancer **Liquidity Bootstrapping Pool**
pairing the backing asset with the CRC. The instance holds the resulting Balancer Pool Tokens (BPT)
for **365 days** before the backer can reclaim them with `releaseBalancerPoolTokens(receiver)`.
After release the BPT is redeemed for the underlying tokens through the factory's `exitLBP(...)`,
which does `IERC20(lbp).transferFrom(msg.sender, ...)` and then exits the Balancer pool.

The release condition, read from the verified source, is **either/or** rather than both:

```solidity
if (FACTORY.releaseTimestamp() > uint32(block.timestamp)) {
    if (balancerPoolTokensUnlockTimestamp > block.timestamp) {
        revert BalancerPoolTokensLockedUntil(balancerPoolTokensUnlockTimestamp);
    }
}
```

So the position unlocks when the instance's own timer expires **or** the factory's global
early-release switch is set to a past timestamp. The effective unlock date is the *minimum* of the
two. That switch currently sits at `0xffffffff` (max uint32), which means "disabled" — displaying
it as a date in 2106 would be wrong, so it is treated as a sentinel.

`releaseBalancerPoolTokens` also resets `balancerPoolTokensUnlockTimestamp` to zero, so a released
position reads back an unlock timestamp of 0. That is expected, not a missing value.

## Why the page speaks Safe's protocol directly

`releaseBalancerPoolTokens` requires `msg.sender == BACKER`, and in practice the backer is a Gnosis
Safe. A Safe only ever acts through its own `execTransaction`, authorised by enough owner
signatures to meet its threshold — an owner's personal EOA signature does not satisfy
`msg.sender == Safe`. So a plain `eth_sendTransaction` from MetaMask cannot work.

Rather than depending on Safe's hosted Transaction Service, the page uses Safe's fully **on-chain**
approval mechanism: `approveHash(bytes32)` plus `execTransaction(...)` with the "pre-approved"
signature encoding (`r = owner address, s = 0, v = 1` per 65-byte signature, sorted ascending by
owner address). Any owner can open the page with an ordinary wallet and approve; once the threshold
is met, anyone can execute. The cost is one on-chain transaction per approving owner, in exchange
for no external API dependency and no blind-signing prompts.

**Determinism.** The release always targets `receiver = the backer` (no editable field) and always
calls `getTransactionHash` with the Safe's *current* `nonce()`, every other field zeroed
(`value = 0`, `operation = 0` i.e. Call not delegatecall, `safeTxGas = baseGas = gasPrice = 0`,
`gasToken = refundReceiver = address(0)`). All inputs are fixed constants or re-readable chain
state, so independent owners converge on the same transaction hash with nothing shared between
them.

### The `msg.sender` shortcut

Safe's `checkNSignatures` accepts a `v = 1` entry under either of two conditions:

```solidity
require(msg.sender == currentOwner || approvedHashes[currentOwner][dataHash] != 0, "GS025");
```

The account *sending* `execTransaction` therefore counts as a signer without having called
`approveHash` first. The page takes advantage of this in `selectSigners`: the connected owner is
counted toward the threshold, and their address is included in the signature blob. For a 1-of-1
Safe — the common case for a Circles avatar — this makes the whole step a **single transaction
instead of two**, and for an N-of-M Safe it lets the final owner approve and execute at once. The
UI labels this state "you · signs inline".

## Verification record

Selectors, encodings and the full read path were checked against the live contracts on Gnosis
Chain. `npm test` re-runs all of it (73 assertions).

- **All 27 function selectors** recomputed from their signature strings with a fresh keccak256.
  No mismatches. Each is annotated with its signature in `src/abi/selectors.js`.
- **`keccak256("ExecutionFailure(bytes32,uint256)")`** recomputed and confirmed:
  `0x23428b18…687d23`.
- **Safe transaction hash.** The page's `getTransactionHash` calldata was sent to the real 2-of-2
  Safe `0x89e5733a…f098`; its answer
  (`0x2b3bf35662ebbb16759f47825b9675765d4a9a3ff31221b21a932010577125e4`) matches an EIP-712 hash
  computed from scratch — `SafeTx` typehash, domain separator over `(chainId, verifyingContract)`,
  `keccak256(data)` for the dynamic field — byte for byte.
- **`execTransaction` calldata** captured from the running page and decoded field by field: head
  layout, `data` offset 320, `signatures` offset 416, inner selector `0x80729c25`, inner receiver
  = the Safe, one 65-byte signature with `r = owner, s = 0, v = 1`.
- **`exitLBP` argument order** confirmed against the verified factory source: `minAmountOut0/1`
  line up with the token order from `Vault.getPoolTokens(poolId)`, which is the order used here.
  The pool tokens are sent to `msg.sender`, i.e. the backer.
- **Full read path** exercised against a real locked position: instance address, backer, LBP,
  unlock timestamp, CRC amount, backing asset, vault, pool id, balances, total supply. The
  rendered figures (43.976353 sDAI / 3,604.902801 s-CRC) match independent RPC queries.
- **End-to-end in headless Chrome**: lookup, no-backing, invalid input, RPC failover, connected
  owner, non-owner, 1-of-1 execution, theme switching, and mobile layout — zero console errors.

**Not tested:** a real on-chain `approveHash`/`execTransaction`/`exitLBP` execution. The fixture
position is locked until October 2026, so the unlocked states were reached by fast-forwarding
`Date.now` and mocking the wallet transport; the calldata was captured and decoded rather than
broadcast.

## Fixes applied in the refactor

Correctness and safety:

1. **No HTML document.** The file began at `<title>` with no doctype, `<html>`, `<head>` or
   `<meta charset>` — fine as an inlined artifact, broken as a deployed page (the `…` and `·`
   characters depended on the server guessing the encoding).
2. **`[hidden]` was defeated by the cascade.** `.wallet-info` and `.provider-picker` set
   `display: flex`, which outranks the user-agent `[hidden] { display: none }` rule. The wallet
   chip and the wallet picker were therefore *always* visible — the chip showing a placeholder
   `—` before any wallet was connected. Now enforced with `[hidden] { display: none !important }`.
3. **XSS through `symbol()`.** Token symbols were concatenated into `innerHTML`. A pool token's
   symbol is attacker-controlled, so a crafted token could run script in the page — the one place
   that matters, since the page drives wallet transactions. All rendering now builds nodes and
   assigns `textContent`; confirmed with an `<img onerror>` payload that renders as inert text.
4. **Wrong-chain sends.** The chain was only checked at connect time. A user who switched networks
   afterwards would broadcast the calldata onto whatever chain was selected. `sendTransaction` now
   re-checks immediately before every send.
5. **Stale slippage bounds.** `minAmountsOut` was computed from pool balances read at page load.
   Pool balances move with every trade, so a stale snapshot either under-protects the exit or makes
   it revert. Step 3 now re-reads the pool immediately before building the calldata.
6. **Unchecked approval receipt.** A reverted `approveHash` was polled but never checked, so it
   silently displayed as "not approved yet" with no error.
7. **Single RPC endpoint.** One hardcoded node with no fallback. Now five endpoints with automatic
   failover; verified by killing the primary and watching the page render unaffected.
8. **Duplicate wallet listeners.** `accountsChanged`/`chainChanged` handlers were re-registered on
   every reconnect and never removed, so each account change fired N re-renders.
9. **Countdown timer leak.** The 1s interval kept running after a lookup moved to a different
   state, writing into a detached element.
10. **Fragile `getPoolTokens` decoding.** Array positions were assumed rather than read from the
    head offsets.

Usability and deployment:

11. Effective unlock now accounts for the factory's global release switch, with the max-uint32
    sentinel handled instead of rendered as a 2106 date.
12. `?address=0x…` deep links, so a lookup can be shared or reloaded.
13. Slippage changes re-render step 3 only, instead of tearing down all three steps.
14. `symbol()` returning a raw `bytes32` (older tokens) is decoded instead of falling back to an
    address, and UTF-8 is decoded properly rather than one byte per character.
15. Two-token-only pools are explained in the UI rather than silently hiding the withdrawal card.
16. Position reads run in parallel — four round-trip groups instead of a dozen sequential calls.
17. Accessibility: a real `<label>` for the lookup field, `aria-live` on state changes,
    `role="alert"` on errors, `aria-invalid` on bad input, and reduced-motion support.
18. Added a favicon (previously a 404 on any real deployment), a theme toggle, security headers,
    and a CSP.

## Known limitations

- Two-token pools only — a constraint of the factory's `exitLBP`, not of this page.
- No Safe modules, `delegatecall`, nonce gaps, or off-chain EIP-712 signature collection.
- No notification to a second owner that their approval is needed; they must be told out-of-band
  to open the page, though nothing has to be transmitted to them.
- Non-Safe smart accounts are treated as plain EOAs.
