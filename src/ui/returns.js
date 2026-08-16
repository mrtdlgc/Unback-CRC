/** "Expected on withdrawal" — the position's live pro-rata share of the pool. */

import { formatUnits, shorten } from "../abi/codec.js";
import { proRataAmount } from "../chain/backing.js";
import { formatPercent } from "../util/format.js";
import { byId, el, render } from "./dom.js";

export function renderReturns(position) {
  const { pool, shareBpt } = position;

  const rows = pool.tokens.map((token, index) => {
    const metadata = pool.metadata[index];
    const owed = proRataAmount(pool.balances[index], shareBpt, pool.totalSupply);

    return el("tr", {}, [
      el("td", {}, [
        el("div", { class: "token-name", text: metadata.symbol }),
        el("div", { class: "token-addr", text: shorten(token) }),
      ]),
      el("td", { class: "num", text: formatUnits(owed, metadata.decimals, 6) }),
    ]);
  });

  render(byId("returnsBody"), rows);

  const share = formatPercent(shareBpt, pool.totalSupply);
  byId("shareNote").textContent =
    `This position holds ${share}% of the pool's outstanding tokens. ` +
    "The figures move with trading until the position is actually redeemed.";
}
