# Circles Backing Ledger

Look up any Circles CRC **backing position** on Gnosis Chain without connecting a wallet, and
withdraw it once the lock expires — including when the backer is a Gnosis Safe multisig.

Static site. No build step, no bundler, no npm dependencies. Everything, including ABI encoding,
is plain ES modules served as-is.

## What it does

**Read-only lookup (no wallet).** Enter an address; the page derives the per-backer
`CirclesBacking` instance via `factory.computeAddress(...)`, reads its state from public Gnosis
Chain RPC nodes, and reports whether the position is locked, ready, or already withdrawn — plus
the position's live pro-rata share of the Balancer pool.

**Withdrawal (wallet only when signing).** Three steps: `releaseBalancerPoolTokens` → ERC-20
`approve` → `exitLBP`. When the backer is a Safe, each step is driven through Safe's fully
on-chain approval path (`approveHash` + `execTransaction` with pre-approved signatures) rather
than the hosted Safe Transaction Service, so the page depends on nothing but a public RPC node.

Because every field of the proposed Safe transaction is either a fixed constant or freely
re-readable on-chain state, two owners who open this page independently compute the *same* Safe
transaction hash. No calldata or partial signatures need to be shared between them.

## Deploying to Vercel

The repo is already a valid Vercel project — no framework preset, no build command.

```bash
npx vercel        # preview
npx vercel --prod # production
```

Or import the repository at [vercel.com/new](https://vercel.com/new) and accept the defaults;
`vercel.json` supplies the routing and headers.

`vercel.json` sets a strict `Content-Security-Policy`. **If you add an RPC endpoint to
`src/config.js`, add its origin to `connect-src` as well**, or the browser will block the request
in production.

## Local development

```bash
npm run dev    # http://localhost:5173
npm test       # verification suite (hits live Gnosis Chain)
```

`npm run dev` is a ~60-line zero-dependency static server; it exists mainly because ES modules
need the correct JavaScript MIME type, which some ad-hoc static servers get wrong.

## Layout

```
index.html              document shell — markup only
styles/
  tokens.css            design tokens + the three theme states
  base.css              element defaults, buttons, shared primitives
  layout.css            page shell, masthead, footer
  components.css        cards, receipt, table, steps, logs
src/
  config.js             addresses, RPC list, chain + explorer constants
  main.js               entry point: lookup flow, wallet UI, section routing
  abi/
    selectors.js        precomputed 4-byte selectors, each with its signature
    codec.js            pad/encode/decode, BigInt amount formatting
  chain/
    rpc.js              JSON-RPC client with endpoint failover
    erc20.js            token metadata (cached), balances, allowances
    backing.js          position loading + status derivation, calldata builders
    wallet.js           EIP-6963 discovery, connect, chain switching, sending
    transactions.js     receipt polling and result checking
  safe/
    encoding.js         getTransactionHash / execTransaction / signature blobs
    client.js           Safe reads, approvals, signer selection
  ui/
    dom.js              node builders (textContent only — never innerHTML)
    feedback.js         activity + error logs
    status.js           status receipt card and countdown
    returns.js          expected-on-withdrawal table
    safeAction.js       one action, routed via Safe or sent directly
    withdraw.js         the three-step procedure
    theme.js            system / light / dark
tests/run.js            verification suite
```

## Verification

`npm test` covers 73 assertions: ABI encode/decode fixtures, Safe calldata layout, signer
selection, pro-rata and slippage maths, and live reads against the deployed contracts.

The two claims worth checking independently, both asserted in the suite:

- **Selectors.** Every entry in `src/abi/selectors.js` carries the signature it was derived
  from, e.g. `cast sig 'releaseBalancerPoolTokens(address)'` → `0x80729c25`.
- **Safe transaction hash.** The page's `getTransactionHash` encoding is checked against the
  Safe's own on-chain answer, which in turn was cross-checked against an EIP-712 hash computed
  from scratch (`SafeTx` typehash + domain separator).

## Contracts

| | |
|---|---|
| `CirclesBackingFactory` | [`0xeced9…7bd0`](https://gnosisscan.io/address/0xeced91232c609a42f6016860e8223b8aecaa7bd0) |
| `CirclesBacking` (per backer) | derived via `factory.computeAddress(backer)` |
| Balancer Vault | resolved at runtime via `factory.VAULT()`, never hardcoded |

## Known limitations

- Only two-token pools are supported. This is a limit of the factory itself — `exitLBP` reverts
  with `OnlyTwoTokenLBPSupported` otherwise — and holds for every real backing position, since
  `CirclesBacking` always pairs one backing asset with one CRC token. The page says so rather
  than offering a broken button.
- Safe support covers the on-chain `approveHash` path only: no modules, no `delegatecall`, no
  nonce gaps, and no off-chain EIP-712 signature collection.
- A second owner is not notified when their approval is needed; they have to be told out-of-band
  to open the page. Nothing needs to be *sent* to them, though — the page recomputes the same
  transaction hash from chain state alone.
- Non-Safe smart accounts (ERC-4337 and similar) are treated as plain EOAs.
