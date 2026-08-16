/**
 * Deployment constants.
 *
 * Nothing here is secret and nothing needs a build step to inject — the page is
 * a static asset that talks to public infrastructure only.
 */

export const CHAIN = {
  id: 100,
  idHex: "0x64",
  name: "Gnosis Chain",
  nativeCurrency: { name: "xDAI", symbol: "XDAI", decimals: 18 },
};

/**
 * Read endpoints, tried in order with automatic failover. A single hardcoded
 * endpoint means the whole page dies whenever that one node rate-limits.
 *
 * Any host added here must also be added to `connect-src` in vercel.json,
 * otherwise the Content-Security-Policy will block the request in production.
 */
export const RPC_ENDPOINTS = [
  "https://rpc.gnosischain.com",
  "https://rpc.gnosis.gateway.fm",
  "https://gnosis-rpc.publicnode.com",
  "https://gnosis.drpc.org",
  "https://1rpc.io/gnosis",
];

/** gnosis.blockscout.com now redirects here, so this is the canonical explorer. */
export const EXPLORER = "https://gnosisscan.io";

/** CirclesBackingFactory — verified on Gnosis Chain. */
export const FACTORY_ADDRESS = "0xeced91232c609a42f6016860e8223b8aecaa7bd0";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * `releaseTimestamp()` is a uint32. The factory ships it at max-uint32, which
 * means "global early release is switched off" rather than a date in 2106.
 */
export const RELEASE_DISABLED_SENTINEL = 0xffffffff;

/** Saves a symbol()/decimals() round trip for the four supported backing assets. */
export const KNOWN_TOKENS = {
  "0xaf204776c7245bf4147c2612bf6e5972ee483701": { symbol: "sDAI", decimals: 18 },
  "0x9c58bacc331c9aa871afd802db6379a98e80cedb": { symbol: "GNO", decimals: 18 },
  "0x6a023ccd1ff6f2045c3309768ead9e68f978f6e1": { symbol: "WETH", decimals: 18 },
  "0x8e5bbbb09ed1ebde8674cda39a0c169401db4252": { symbol: "WBTC", decimals: 8 },
};

export const DEFAULT_SLIPPAGE_PCT = 1;

/** Receipt polling: 2.5s apart, giving a ~100s ceiling on a 5s-block chain. */
export const RECEIPT_POLL_INTERVAL_MS = 2500;
export const RECEIPT_POLL_ATTEMPTS = 40;

/** A wallet that never answers must not look like a dead button. */
export const WALLET_REQUEST_TIMEOUT_MS = 30000;
export const RPC_REQUEST_TIMEOUT_MS = 12000;
