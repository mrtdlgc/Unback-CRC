/**
 * A single on-chain action, routed through a Safe when the acting address is
 * one, or sent directly when it is a plain EOA.
 *
 * Each of the three withdrawal steps is an instance of this component; they
 * differ only in the `to`/`data` pair they carry.
 */

import { sameAddress, shorten } from "../abi/codec.js";
import { assertReceiptSucceeded, waitForReceipt } from "../chain/transactions.js";
import { getWalletState, sendTransaction } from "../chain/wallet.js";
import { hasCode } from "../chain/rpc.js";
import {
  computeSafeTransactionHash,
  readApprovals,
  readSafeInfo,
  selectSigners,
} from "../safe/client.js";
import { buildExecTransactionCalldata, encodeApproveHash, encodeApprovedHashSignatures } from "../safe/encoding.js";
import { errorMessage } from "../util/async.js";
import { explorerAddress } from "../util/format.js";
import { el, externalLink, hint, render } from "./dom.js";
import { recordActivity } from "./feedback.js";

export function createSafeAction({ mount, actor, to, data, label, onComplete }) {
  let safeInfo = null;
  let transactionHash = null;
  let completed = false;
  let refreshToken = 0;

  const hintLine = hint("");

  function setHint(message, tone) {
    hintLine.textContent = message;
    hintLine.className = tone ? `hint ${tone}` : "hint";
  }

  function complete() {
    completed = true;
    if (typeof onComplete === "function") {
      Promise.resolve()
        .then(onComplete)
        .catch((error) => console.error("Step follow-up failed", error));
    }
  }

  /** Run a submitted transaction to completion, reporting progress inline. */
  async function submit(button, { target, calldata, activityLabel, confirmMessage }) {
    button.disabled = true;
    try {
      setHint(confirmMessage);
      const hash = await sendTransaction({ to: target, data: calldata });
      recordActivity(activityLabel, hash);
      setHint("Submitted — waiting for confirmation…");
      const receipt = await waitForReceipt(hash);
      assertReceiptSucceeded(receipt, activityLabel);
      return hash;
    } catch (error) {
      setHint(`${activityLabel} failed: ${errorMessage(error)}`, "warn");
      button.disabled = false;
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Plain EOA backer
  // -------------------------------------------------------------------------
  function renderDirect() {
    const { account } = getWalletState();

    if (!account) {
      render(mount, hint(`Connect the wallet for ${shorten(actor)} to send this transaction.`));
      return;
    }

    if (!sameAddress(account, actor)) {
      render(
        mount,
        hint(
          `Connected wallet is ${shorten(account)}, but this must be sent from ${shorten(actor)}.`,
          "warn",
        ),
      );
      return;
    }

    const button = el("button", {
      class: "btn-primary btn-small",
      type: "button",
      text: `Send ${label}`,
      onClick: async () => {
        const hash = await submit(button, {
          target: to,
          calldata: data,
          activityLabel: label,
          confirmMessage: "Confirm in your wallet…",
        });
        if (hash) {
          setHint("Done.", "ok");
          complete();
        }
      },
    });

    render(mount, [el("div", { class: "safe-actions" }, [button]), hintLine]);
  }

  // -------------------------------------------------------------------------
  // Safe backer
  // -------------------------------------------------------------------------
  function renderSafe(approvals) {
    const { account } = getWalletState();
    const plan = selectSigners({
      owners: safeInfo.owners,
      threshold: safeInfo.threshold,
      approvals,
      connectedAccount: account,
    });

    const ownerRows = safeInfo.owners.map((owner) => {
      const approved = approvals.has(owner.toLowerCase());
      const isConnected = Boolean(account) && sameAddress(owner, account);
      // An owner who is connected but has not called approveHash still counts,
      // because they will be `msg.sender` on the execution.
      const signsInline = isConnected && !approved;

      const pillClass = approved ? "approval-pill yes" : signsInline ? "approval-pill self" : "approval-pill";

      return el("li", { class: "owner-row" }, [
        el("span", { class: pillClass, text: approved ? "✓" : signsInline ? "•" : "" }),
        externalLink(explorerAddress(owner), shorten(owner)),
        isConnected
          ? el("span", { class: "owner-tag", text: signsInline ? "you · signs inline" : "you" })
          : null,
      ]);
    });

    const heading = el("div", { class: "safe-panel-head" }, [
      el("span", {
        class: "safe-panel-title",
        text:
          `Safe approval · ${plan.eligible.length} of ${safeInfo.threshold} required ` +
          `(${safeInfo.owners.length} owner${safeInfo.owners.length === 1 ? "" : "s"})`,
      }),
    ]);

    const actions = el("div", { class: "safe-actions" });

    if (!account) {
      actions.append(el("span", { class: "hint", text: "Connect an owner wallet above to approve or execute." }));
    } else if (plan.canExecuteNow) {
      actions.append(
        el("button", {
          class: "btn-primary btn-small",
          type: "button",
          text: `Execute ${label}`,
          onClick: async (event) => {
            const button = event.currentTarget;
            const signatures = encodeApprovedHashSignatures(plan.signers);
            const calldata = buildExecTransactionCalldata(to, data, signatures);
            const hash = await submit(button, {
              target: actor,
              calldata,
              activityLabel: `Execute ${label}`,
              confirmMessage: "Confirm execution in your wallet…",
            });
            if (hash) {
              setHint("Done.", "ok");
              complete();
            }
          },
        }),
      );

      if (plan.connectedIsOwner && !plan.connectedHasApproved) {
        actions.append(
          el("span", {
            class: "hint",
            text: "Your key signs as part of this transaction — no separate approval needed.",
          }),
        );
      }
    } else if (!plan.connectedIsOwner) {
      actions.append(
        el("span", { class: "hint warn", text: `${shorten(account)} isn't an owner of this Safe.` }),
      );
    } else if (plan.connectedHasApproved) {
      actions.append(
        el("span", { class: "hint ok", text: "Approved — waiting on the other owners." }),
      );
    } else {
      actions.append(
        el("button", {
          class: "btn-primary btn-small",
          type: "button",
          text: `Approve as ${shorten(account)}`,
          onClick: async (event) => {
            const button = event.currentTarget;
            const hash = await submit(button, {
              target: actor,
              calldata: encodeApproveHash(transactionHash),
              activityLabel: `Approve (${label})`,
              confirmMessage: "Confirm the approval in your wallet…",
            });
            if (hash) await refresh();
          },
        }),
      );
    }

    render(mount, [heading, el("ul", { class: "owner-list" }, ownerRows), actions, hintLine]);
  }

  // -------------------------------------------------------------------------

  async function refresh() {
    if (completed) return;
    const token = ++refreshToken;
    render(mount, hint("Checking…"));

    try {
      if (!(await hasCode(actor))) {
        if (token !== refreshToken) return;
        renderDirect();
        return;
      }

      safeInfo = await readSafeInfo(actor);
      if (!safeInfo) {
        if (token !== refreshToken) return;
        renderDirect();
        return;
      }

      transactionHash = await computeSafeTransactionHash(actor, to, data, safeInfo.nonce);
      const approvals = await readApprovals(actor, safeInfo.owners, transactionHash);

      // A newer refresh started while these reads were in flight; its result wins.
      if (token !== refreshToken) return;
      renderSafe(approvals);
    } catch (error) {
      if (token !== refreshToken) return;
      render(mount, hint(`Couldn't read the Safe: ${errorMessage(error)}`, "warn"));
    }
  }

  return { refresh, isComplete: () => completed };
}
