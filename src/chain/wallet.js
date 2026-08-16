/**
 * Wallet connection.
 *
 * A wallet is only ever needed to *sign*; every read on this page goes to the
 * public RPC layer instead. Discovery uses EIP-6963 so a second extension
 * squatting on `window.ethereum` cannot hide the one the user actually wants.
 */

import { CHAIN, RPC_ENDPOINTS, EXPLORER, WALLET_REQUEST_TIMEOUT_MS } from "../config.js";
import { withTimeout } from "../util/async.js";

const announced = [];
const subscribers = new Set();

const state = {
  provider: null,
  providerName: null,
  account: null,
  chainId: null,
};

/** Handlers currently bound to `state.provider`, so they can be unbound. */
let boundHandlers = null;

export function getWalletState() {
  return { ...state };
}

export function isConnected() {
  return Boolean(state.provider && state.account);
}

export function onWalletChange(callback) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

function notify() {
  subscribers.forEach((callback) => {
    try {
      callback(getWalletState());
    } catch (error) {
      console.error("Wallet subscriber failed", error);
    }
  });
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export function discoverProviders() {
  window.addEventListener("eip6963:announceProvider", (event) => {
    const detail = event?.detail;
    if (!detail?.provider) return;
    if (announced.some((entry) => entry.provider === detail.provider)) return;
    announced.push({ name: detail.info?.name || "Wallet", provider: detail.provider });
  });

  try {
    window.dispatchEvent(new Event("eip6963:requestProvider"));
  } catch {
    /* non-browser environment; nothing to announce */
  }
}

/** Announced wallets, falling back to a legacy injected provider. */
export function availableProviders() {
  if (announced.length > 0) return announced.slice();
  if (window.ethereum) return [{ name: "Injected wallet", provider: window.ethereum }];
  return [];
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

function unbindHandlers() {
  if (!boundHandlers) return;
  const { provider, onAccountsChanged, onChainChanged } = boundHandlers;
  // `removeListener` is the de-facto standard; guard for providers lacking it
  // so reconnecting never throws.
  provider.removeListener?.("accountsChanged", onAccountsChanged);
  provider.removeListener?.("chainChanged", onChainChanged);
  boundHandlers = null;
}

function bindHandlers(provider) {
  // Rebinding without unbinding first would stack a fresh pair of handlers on
  // every reconnect, so each account change would fire N re-renders.
  unbindHandlers();

  const onAccountsChanged = (accounts) => {
    state.account = accounts?.[0] || null;
    notify();
  };
  const onChainChanged = (chainId) => {
    state.chainId = chainId;
    notify();
  };

  provider.on?.("accountsChanged", onAccountsChanged);
  provider.on?.("chainChanged", onChainChanged);
  boundHandlers = { provider, onAccountsChanged, onChainChanged };
}

export async function connect(provider, providerName = "Wallet") {
  const accounts = await withTimeout(
    provider.request({ method: "eth_requestAccounts" }),
    WALLET_REQUEST_TIMEOUT_MS,
    "Your wallet never responded. Open the extension from your browser toolbar — " +
      "a connection request is probably waiting there unanswered.",
  );

  if (!accounts?.length) throw new Error("Wallet returned no accounts. Unlock it, then try again.");

  state.provider = provider;
  state.providerName = providerName;
  state.account = accounts[0];
  bindHandlers(provider);

  try {
    state.chainId = await provider.request({ method: "eth_chainId" });
  } catch {
    state.chainId = null;
  }

  notify();
  return getWalletState();
}

export function isOnExpectedChain() {
  return String(state.chainId || "").toLowerCase() === CHAIN.idHex;
}

/**
 * Make sure the wallet is on Gnosis Chain, prompting a switch (and an add, if
 * the chain is unknown to the wallet) when it is not.
 */
export async function ensureChain() {
  if (!state.provider) throw new Error("Connect a wallet first.");

  state.chainId = await state.provider.request({ method: "eth_chainId" });
  if (isOnExpectedChain()) {
    notify();
    return;
  }

  try {
    await state.provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN.idHex }],
    });
  } catch (error) {
    // 4902: the wallet does not know this chain yet.
    if (error?.code !== 4902) throw error;
    await state.provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: CHAIN.idHex,
          chainName: CHAIN.name,
          nativeCurrency: CHAIN.nativeCurrency,
          rpcUrls: RPC_ENDPOINTS.slice(0, 1),
          blockExplorerUrls: [EXPLORER],
        },
      ],
    });
  }

  state.chainId = await state.provider.request({ method: "eth_chainId" });
  notify();

  if (!isOnExpectedChain()) {
    throw new Error(`Wallet is not on ${CHAIN.name}. Switch networks and try again.`);
  }
}

/**
 * Send a transaction from the connected account.
 *
 * The chain is re-checked immediately before every send: a user who switches
 * networks manually after connecting would otherwise broadcast this calldata
 * onto the wrong chain.
 */
export async function sendTransaction({ to, data }) {
  if (!state.provider || !state.account) throw new Error("Connect an owner wallet first.");
  await ensureChain();

  return state.provider.request({
    method: "eth_sendTransaction",
    params: [{ from: state.account, to, data }],
  });
}
