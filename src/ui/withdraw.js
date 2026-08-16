/**
 * The three-step withdrawal procedure.
 *
 *   1. release  — CirclesBacking.releaseBalancerPoolTokens(backer)
 *   2. approve  — LBP.approve(factory, balance)
 *   3. redeem   — CirclesBackingFactory.exitLBP(lbp, balance, min0, min1)
 *
 * Steps 2 and 3 always re-read the chain rather than trusting the snapshot
 * taken at lookup time: the pool balances move with every trade, so slippage
 * bounds computed from stale numbers either under-protect the exit or make it
 * revert on `minAmountsOut`.
 */

import { formatUnits, shorten } from "../abi/codec.js";
import {
  PositionStatus,
  applySlippage,
  encodeExitLBP,
  encodeRelease,
  proRataAmount,
  readPoolSnapshot,
} from "../chain/backing.js";
import { allowance, balanceOf, encodeApprove } from "../chain/erc20.js";
import { DEFAULT_SLIPPAGE_PCT, FACTORY_ADDRESS } from "../config.js";
import { errorMessage } from "../util/async.js";
import { formatDate } from "../util/format.js";
import { byId, el, hint, render, setHidden } from "./dom.js";
import { createSafeAction } from "./safeAction.js";

let position = null;
let reloadPosition = () => {};
let releasedThisSession = false;

export function initWithdraw({ onPositionReload }) {
  reloadPosition = onPositionReload;

  byId("slippageInput").addEventListener("change", () => {
    // Only step 3 depends on slippage — re-rendering the whole card here would
    // throw away any in-progress state in steps 1 and 2.
    if (position) refreshExitStep().catch((error) => console.error(error));
  });
}

function readSlippageBps() {
  const raw = Number.parseFloat(byId("slippageInput").value);
  const pct = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 50) : DEFAULT_SLIPPAGE_PCT;
  return BigInt(Math.round(pct * 100));
}

function panels() {
  return {
    release: byId("releasePanel"),
    approve: byId("approvePanel"),
    exit: byId("exitPanel"),
  };
}

export function renderWithdraw(nextPosition) {
  position = nextPosition;
  releasedThisSession = false;

  const card = byId("withdrawCard");
  const { release, approve, exit } = panels();

  // Nothing left to withdraw, or a pool shape `exitLBP` cannot handle.
  if (position.status === PositionStatus.RELEASED) {
    setHidden(card, true);
    return;
  }

  if (position.pool.tokens.length !== 2) {
    setHidden(card, false);
    render(
      release,
      hint(
        `This pool holds ${position.pool.tokens.length} tokens. The factory's exitLBP only ` +
          "supports two-token pools, so withdrawal cannot be driven from this page.",
        "warn",
      ),
    );
    render(approve, hint("Unavailable for this pool."));
    render(exit, hint("Unavailable for this pool."));
    return;
  }

  setHidden(card, false);

  if (position.status === PositionStatus.LOCKED) {
    render(
      release,
      hint(
        `Locked until ${formatDate(position.effectiveUnlock)}. Come back after that date.`,
        "warn",
      ),
    );
    render(approve, hint("Available once step 1 is done."));
    render(exit, hint("Available once step 2 is done."));
    return;
  }

  renderReleaseStep();
  refreshRedemptionSteps().catch((error) => {
    render(panels().approve, hint(errorMessage(error), "warn"));
  });
}

function renderReleaseStep() {
  const { release } = panels();

  if (position.instanceBpt === 0n) {
    render(release, hint("Done — the pool tokens have already left the backing instance.", "ok"));
    return;
  }

  const action = createSafeAction({
    mount: release,
    actor: position.backer,
    to: position.instance,
    data: encodeRelease(position.backer),
    label: "release",
    onComplete: () => {
      releasedThisSession = true;
      return refreshRedemptionSteps();
    },
  });

  action.refresh();
}

async function refreshRedemptionSteps() {
  const { approve, exit } = panels();
  render(approve, hint("Checking…"));

  let held;
  try {
    held = await balanceOf(position.lbp, position.backer);
  } catch (error) {
    render(approve, hint(`Couldn't read the backer's pool token balance: ${errorMessage(error)}`, "warn"));
    return;
  }

  if (held === 0n) {
    render(
      approve,
      releasedThisSession
        ? hint(
            "Step 1 reported success, but the backer still holds no pool tokens — check the " +
              "release transaction on the explorer before retrying.",
            "warn",
          )
        : hint("The backer holds no pool tokens yet — finish step 1 first."),
    );
    render(exit, hint("Available once step 2 is done."));
    return;
  }

  const spendable = await allowance(position.lbp, position.backer, FACTORY_ADDRESS);
  const summary = hint(
    `${shorten(position.backer)} holds ${formatUnits(held, 18, 6)} pool tokens.`,
  );

  if (spendable >= held) {
    render(approve, [summary, hint("Already approved for the factory.", "ok")]);
    await renderExitStep(held);
    return;
  }

  const actionMount = el("div");
  render(approve, [summary, actionMount]);
  render(exit, hint("Available once the approval above is executed."));

  const action = createSafeAction({
    mount: actionMount,
    actor: position.backer,
    to: position.lbp,
    data: encodeApprove(FACTORY_ADDRESS, held),
    label: "approve",
    onComplete: () => renderExitStep(held),
  });

  await action.refresh();
}

/** Recompute step 3 alone — used by the slippage control. */
export async function refreshExitStep() {
  if (!position) return;
  const held = await balanceOf(position.lbp, position.backer);
  if (held === 0n) return;

  const spendable = await allowance(position.lbp, position.backer, FACTORY_ADDRESS);
  if (spendable < held) return; // still gated on step 2

  await renderExitStep(held);
}

async function renderExitStep(bptAmount) {
  const { exit } = panels();
  render(exit, hint("Pricing the exit…"));

  let snapshot;
  try {
    snapshot = await readPoolSnapshot(position.vault, position.poolId, position.lbp);
  } catch (error) {
    render(exit, hint(`Couldn't read live pool balances: ${errorMessage(error)}`, "warn"));
    return;
  }

  const slippageBps = readSlippageBps();
  const expected = snapshot.balances.map((balance) =>
    proRataAmount(balance, bptAmount, snapshot.totalSupply),
  );
  const minimums = expected.map((amount) => applySlippage(amount, slippageBps));

  const quote = el(
    "ul",
    { class: "owner-list" },
    snapshot.tokens.map((token, index) => {
      const metadata = position.pool.metadata[index] ?? { symbol: shorten(token), decimals: 18 };
      return el("li", { class: "owner-row" }, [
        el("span", {
          text:
            `${metadata.symbol}: expect ${formatUnits(expected[index], metadata.decimals, 6)}, ` +
            `accept no less than ${formatUnits(minimums[index], metadata.decimals, 6)}`,
        }),
      ]);
    }),
  );

  const actionMount = el("div");
  render(exit, [quote, actionMount]);

  const action = createSafeAction({
    mount: actionMount,
    actor: position.backer,
    to: FACTORY_ADDRESS,
    data: encodeExitLBP(position.lbp, bptAmount, minimums[0], minimums[1]),
    label: "redeem",
    onComplete: () => reloadPosition(),
  });

  await action.refresh();
}
