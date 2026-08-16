/**
 * Entry point: lookup flow, wallet connection UI, and section routing.
 *
 * Reads never need a wallet. A wallet is requested only when the user chooses
 * to sign one of the withdrawal steps.
 */

import { isAddress, shorten } from "./abi/codec.js";
import { PositionStatus, loadPosition } from "./chain/backing.js";
import {
  availableProviders,
  connect,
  discoverProviders,
  getWalletState,
  isOnExpectedChain,
  onWalletChange,
} from "./chain/wallet.js";
import { CHAIN, FACTORY_ADDRESS } from "./config.js";
import { errorMessage } from "./util/async.js";
import { explorerAddress } from "./util/format.js";
import { byId, el, externalLink, render, setHidden } from "./ui/dom.js";
import { clearErrors, reportError } from "./ui/feedback.js";
import { renderReturns } from "./ui/returns.js";
import { renderStatus, stopCountdown } from "./ui/status.js";
import { initTheme } from "./ui/theme.js";
import { initWithdraw, renderWithdraw } from "./ui/withdraw.js";

const SECTIONS = [
  "emptyState",
  "loadingState",
  "noBackingState",
  "pendingState",
  "statusCard",
  "returnsCard",
  "withdrawCard",
];

let currentPosition = null;
let lookupInFlight = false;

function showOnly(...ids) {
  SECTIONS.forEach((id) => setHidden(byId(id), !ids.includes(id)));
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

async function runLookup(address) {
  if (lookupInFlight) return;
  lookupInFlight = true;

  clearErrors();
  stopCountdown();
  currentPosition = null;
  byId("checkButton").disabled = true;
  showOnly("loadingState");

  try {
    const position = await loadPosition(address);
    currentPosition = position;

    if (position.status === PositionStatus.MISSING) {
      byId("noBackingAddress").textContent = address;
      showOnly("noBackingState");
      return;
    }

    if (position.status === PositionStatus.PENDING) {
      showOnly("pendingState");
      return;
    }

    updateVaultFootnote(position.vault);

    const visible = ["statusCard"];
    if (position.status !== PositionStatus.RELEASED) visible.push("returnsCard");
    showOnly(...visible);

    renderStatus(position);
    if (position.status !== PositionStatus.RELEASED) renderReturns(position);
    renderWithdraw(position);
  } catch (error) {
    console.error(error);
    showOnly("emptyState");
    reportError(`Couldn't load this position: ${errorMessage(error)}`);
  } finally {
    lookupInFlight = false;
    byId("checkButton").disabled = false;
  }
}

function submitLookup() {
  const input = byId("lookupInput");
  const address = input.value.trim();

  if (!isAddress(address)) {
    input.setAttribute("aria-invalid", "true");
    reportError("Enter a valid 0x-prefixed, 40-character address to look up.");
    return;
  }

  input.removeAttribute("aria-invalid");

  // Keep the address in the URL so a lookup can be linked to or reloaded.
  const url = new URL(window.location.href);
  url.searchParams.set("address", address);
  window.history.replaceState(null, "", url);

  runLookup(address);
}

function reloadCurrentPosition() {
  if (currentPosition) return runLookup(currentPosition.lookupAddress);
  return Promise.resolve();
}

function updateVaultFootnote(vault) {
  render(byId("vaultLink"), externalLink(explorerAddress(vault), shorten(vault), ""));
}

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

function renderWalletState() {
  const { account } = getWalletState();
  const info = byId("walletInfo");
  const tag = byId("networkTag");

  setHidden(info, !account);
  if (!account) {
    byId("connectButton").textContent = "Connect owner wallet";
    return;
  }

  byId("walletAddress").textContent = shorten(account);
  byId("connectButton").textContent = "Switch owner wallet";

  if (isOnExpectedChain()) {
    tag.textContent = CHAIN.name;
    tag.classList.remove("wrong");
  } else {
    tag.textContent = "Wrong network";
    tag.classList.add("wrong");
  }
}

async function connectProvider(entry) {
  const button = byId("connectButton");
  const previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Check your wallet…";
  clearErrors();

  try {
    await connect(entry.provider, entry.name);
  } catch (error) {
    reportError(`Wallet connection failed: ${errorMessage(error)}`);
    button.textContent = previousLabel;
  } finally {
    button.disabled = false;
    renderWalletState();
  }
}

function handleConnectClick() {
  const picker = byId("providerPicker");
  const candidates = availableProviders();

  if (candidates.length === 0) {
    reportError(
      "No wallet extension detected. Install a Gnosis Chain compatible wallet " +
        "(MetaMask, Rabby, Frame) and reload this page.",
    );
    return;
  }

  if (candidates.length === 1) {
    setHidden(picker, true);
    connectProvider(candidates[0]);
    return;
  }

  // More than one extension is installed — ask, rather than guessing at
  // whichever one won the `window.ethereum` race.
  setHidden(picker, false);
  render(picker, [
    el("span", { class: "picker-title", text: "Multiple wallets detected — pick one" }),
    el(
      "div",
      { class: "picker-row" },
      candidates.map((entry) =>
        el("button", {
          class: "btn-secondary btn-small",
          type: "button",
          text: entry.name,
          onClick: () => {
            setHidden(picker, true);
            connectProvider(entry);
          },
        }),
      ),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function init() {
  initTheme(byId("themeToggle"));
  initWithdraw({ onPositionReload: reloadCurrentPosition });

  byId("factoryLink").replaceChildren(
    externalLink(explorerAddress(FACTORY_ADDRESS), shorten(FACTORY_ADDRESS), ""),
  );

  byId("checkButton").addEventListener("click", submitLookup);
  byId("lookupInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") submitLookup();
  });
  byId("lookupInput").addEventListener("input", () => {
    byId("lookupInput").removeAttribute("aria-invalid");
  });

  byId("tryAnotherButton").addEventListener("click", () => {
    showOnly("emptyState");
    byId("lookupInput").focus();
    byId("lookupInput").select();
  });

  discoverProviders();
  byId("connectButton").addEventListener("click", handleConnectClick);
  byId("refreshButton").addEventListener("click", () => {
    if (currentPosition) renderWithdraw(currentPosition);
  });

  onWalletChange(() => {
    renderWalletState();
    // Owner identity drives which buttons each step offers.
    if (currentPosition) renderWithdraw(currentPosition);
  });

  renderWalletState();

  // Deep link: ?address=0x… runs the lookup straight away.
  const requested = new URL(window.location.href).searchParams.get("address");
  if (requested && isAddress(requested)) {
    byId("lookupInput").value = requested.trim();
    runLookup(requested.trim());
  }
}

init();
