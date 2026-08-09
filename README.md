# GasSpend — a gas-fee contract for Ronin PoD (Season 3)

A self-contained Solidity contract (no imports, compiles with plain `solc 0.8.26`)
that makes **gas spend** the product, so it maps directly onto the **Gas Spend**
dimension of Ronin's Proof of Distribution (PoD) builder score.

- **Contract:** `contracts/GasSpend.sol`
- **ABI + bytecode:** `artifacts/GasSpend.json`
- **Compiled & tested locally:** `node scripts/compile.js`, `node scripts/test.js`
  (pure-JS EVM, same EVM ruleset as Ronin mainnet)

---

## 1. How PoD scores gas spend (what you're actually earning on)

Verified against the official portal + docs:

- PoD pays **RON each epoch** to builders based on a **Builder Score** computed
  from on-chain activity of **the contracts you register**. Unregistered
  contracts are invisible to PoD.
- The score has **six dimensions**: **Gas Spend**, NFT activity, DEX activity,
  contract volume, users funded, and new users funded. On the current portal
  weights, Gas Spend carries ~**18%** of the score (`Gas spent (RON)` is a
  first-class leaderboard column).
- Gas Spend = the **RON fees users pay to the Ronin treasury** by transacting
  with your registered contracts. Every user transaction against your contract
  increases it.
- Flow to start earning: **register on the portal → add contract → verify as
  deployer (self-register, instant) → activate on-chain (one tx) → users
  interact → score accrues per epoch.**

> ⚠️ **Reality check:** registering a contract earns nothing by itself. PoD
> scores **actual usage**. The value of GasSpend is that it gives users a real
> reason to keep transacting (rebates), and every one of those transactions is
> scored gas spend. You still need to attract real users.

---

## 2. What GasSpend does

```
user --register() / logActivity(ctx)-->  [GasSpend] --records gas--> ledger
      (pays gas in RON to treasury)          \--accrues RON rebate--> user.claimable
owner --fund (send RON)--> rebate pool  <--claimRebate()-- user (reentrancy-safe)
```

| Function | Who | Effect |
|---|---|---|
| `register()` | anyone | one-time user registration (46k gas) |
| `logActivity(bytes32 ctx)` | anyone | **main interaction** — records the caller's gas spend, emits `Activity(user, gasUsed, cumulative, ts, ctx)` (auto-registers; ~19k gas on repeat calls) |
| `logActivityHeavy(bytes32 ctx, uint256 slots)` | anyone | **high-gas interaction** — writes `slots` real, permanent on-chain records (session hashes) so the tx genuinely uses lots of gas (see table below); capped by `maxHeavySlots` (default 2,000, owner-adjustable) |
| `claimRebate()` | users | pay out accrued RON rebate (checks-effects-interactions, reentrancy guard) |
| `recoverUnclaimed(user)` | **owner** | recover ONE user's unclaimed rebates — **at any time** |
| `recoverAllUnclaimed()` | **owner** | recover every user's unclaimed rebates in one tx |
| `fund` (`receive()`) | anyone | top up the rebate pool with RON |
| `setRebatePerGas()` / `setTreasury()` / `pause()` | owner | admin controls |
| `emergencyWithdraw(to)` | owner | withdraw **only the surplus above all user obligations** — user funds can never be drained |
| `gasSpentOf() / claimableOf() / stats()` | anyone | read-only analytics (feed your own leaderboard!) |
| `claimRebate()` (web UI) | users | **leaderboard.html** now ships a wallet-connect + claim button (Ronin Wallet) — calls `claimRebate()` right from the page |

**Why users would use it:** the rebate is proportional to the gas they spend —
interact more, earn more RON back. That incentive loop is what keeps the
meter running for PoD.

**Honest accounting:** the recorded `gasUsed` = `BASE_GAS (21,000) + gasleft()
delta`, a conservative approximation of the full tx gas (calldata, intrinsic
cost etc. aren't all captured). Real on-chain gas spend — what PoD measures —
is always ≥ the ledger value. Tune `rebatePerGas` so the pool stays funded.

**Heavy mode — max real gas per call (this is the honest way to make the Gas
Spend column big).** PoD scores **real** gas fees (`gasUsed × gasPrice`) read
from on-chain tx data — it does NOT read any number your contract records, so
"recording" a big number is impossible and pointless. The only real lever is
making each interaction genuinely use more gas. `logActivityHeavy` does that
with real, permanent storage writes (real data a frontend can use). Measured
on a local EVM, priced at Ronin's current ~21 gwei (block limit ~60M):

| slots | real gas used | real RON paid to treasury @21 gwei | % of block |
|---|---:|---:|---:|
| 100 | 2.51M | 0.053 RON | 4% |
| 500 | 11.33M | 0.238 RON | 19% |
| 1,000 | 22.66M | 0.476 RON | 38% |
| 2,000 (default cap) | 45.36M | 0.953 RON | 76% |
| 2,400 (owner raises cap) | 54.46M | 1.144 RON | 91% |

That is ~2,700× the gas of a plain `logActivity` per call — and it's all real.
To hit **10 RON per call** you would have to pay a gas price of **~175–220 gwei
yourself** at max slots (10 RON ÷ 54.46M gas ≈ 184 gwei) — i.e. you are paying
the 10 RON into the Ronin treasury out of pocket; the EVM's block limit makes
10 RON/call at market (~21 gwei) physically impossible. Also note: sustained
near-block-limit txs push the base fee up (EIP-1559 target = 30M/block), and
Sky Mavis review + Dune-based scoring can flag pure self-funded gas farming —
so keep real users transacting, not just your own wallet.

**Recovery mechanism (owner, anytime):** unclaimed rebates are NOT permanently
locked. `recoverUnclaimed(user)` claws back one user's accrued-but-unclaimed
rebate, and `recoverAllUnclaimed()` does it for everyone in one tx (the
contract keeps a grow-only `userList`). Both zero the user's `claimable`,
reduce `totalOwed`, and move the RON to the owner. Notes:

- Only UNCLAIMED balances are recoverable — already-claimed RON can never be taken back.
- Users see the `RebatesRecovered` event, so recovery is fully transparent.
- Because of this, **users should claim regularly** (the contract's docs say so too).
- It's an owner-only call and works even while paused (owner emergency path).
- `emergencyWithdraw` still only touches surplus — it never touches owed balances;
  recovery is the ONLY way owed balances move to the owner.

**Verified in tests (local EVM):** deploy ~735k gas · register 46,270 ·
logActivity 114,594 (first, incl. auto-register) / 19,094 (repeat) ·
double-claim reverts · non-owner pause reverts · paused blocks activity ·
emergencyWithdraw respects obligations · recoverUnclaimed / recoverAllUnclaimed
claw back unclaimed rebates anytime, non-owners are blocked, and nothing is
permanently stuck (contract balance returns to 0 after payouts).

---

## 3. Deploy to Ronin mainnet

Network: **Ronin** — Chain ID `2020` — RPC `https://api.roninchain.com/rpc`
(public) — Explorer `https://explorer.roninchain.com`
Testnet: **Saigon** — Chain ID `2021` — `https://saigon-testnet.roninchain.com/rpc`

### Option A — Remix (easiest, works from a phone)
1. Open [remix.ethereum.org](https://remix.ethereum.org) → paste `GasSpend.sol`.
2. Compile (Solidity 0.8.26, enable optimizer).
3. In **Deploy & Run**: environment = **Injected Provider** (Ronin Wallet /
   MetaMask set to Ronin), contract = `GasSpend`.
4. Constructor args: `treasury` = your rewards wallet, `rebatePerGas` =
   `10000000000` (= 10 gwei per gas unit — start here and tune).
5. Deploy and confirm in the wallet. **Deploy from the wallet you'll register
   as admin** — deployer verification is the instant self-register path.

### Option B — Hardhat (reproducible)
```bash
npm init -y && npm i -D hardhat @nomicfoundation/hardhat-toolbox @openzeppelin/contracts
# copy deploy/hardhat.config.js and scripts/deploy-hardhat.js from this repo
DEPLOYER_PRIVATE_KEY=0x... TREASURY=0x... npx hardhat run scripts/deploy-hardhat.js --network ronin
```
`hardhat.config.js` is already wired for Ronin (2020) and Saigon (2021) and
enables **Sourcify** verification (the docs-recommended method).

### After deploy
- Fund the rebate pool: send RON to the contract (e.g. `1` RON to start).
- Set `rebatePerGas` if you didn't in the constructor.

---

## 4. Register with PoD (Season 3) — step by step

1. Open the **Builders Portal** → **Connect** with your **admin wallet**
   (the one that deployed GasSpend — one wallet = one profile).
2. Fill **Info**: project name, logo, description, website, and set the
   **treasury wallet** (where PoD RON rewards are paid).
3. **Contracts tab → Add Contract** → paste the deployed GasSpend address.
   The portal detects `owner()` (Ownable-style) and the deployer.
4. **Verify** — click **Verify** and sign with the deployer wallet, or use
   **Verify manually** (cast wallet sign) if the key is in a CI/hardware
   wallet. Deployer verification = self-register on-chain, no review needed.
5. **Activate** — "Register on-chain" panel → **Confirm & Register** → sign
   the activation tx. Your profile is now on-chain, GasSpend is on your
   tracking list, and activity starts being scored.
6. (Optional) verify source on [Sourcify](https://sourcify.dev) — recommended.

Links:
- Portal: <https://pod.roninchain.com/leaderboard?season=3>
- Docs: <https://docs.roninchain.com/proof-of-distribution/>
- Registry (mainnet): `0xe680632ffb8a15198be30077abbc119ca321dbd3`
- RewardLane registry (mainnet): `0xbfF5ea1E6593de56CC25CAD36E480e0bE4CFC78A`

---

## 4b. Frontend leaderboard (included)

`leaderboard/index.html` (also `leaderboard.html` in the package) is a
self-contained live leaderboard that reads the GasSpend contract straight from
Ronin RPC — no backend needed:

- **Network stats** — users, total calls, gas spent (units + ≈RON at current
  gas price), rebate pool, amount owed to users, rebate rate.
- **Leaderboard** — scans `Activity` events (150-block chunks, respecting
  Ronin's 200-block `eth_getLogs` cap) and ranks wallets by real gas burned,
  with call counts, heavy-record badges, last context, and % share.
- **Look up any address** — registered status, gas spent, claimable rebate,
  heavy record count.
- **Demo mode** — preview the UI with fake data before you deploy.
- Auto-refreshes every 30s; works on mainnet or Saigon (RPC selector).

Use it: open the file directly, or serve it (`python3 -m http.server` in the
folder) and visit the URL. Paste your deployed contract address → **Load**.

## 5. Ideas to grow the gas-fee volume (the actual metric)

- **Points + leaderboard:** poll `stats()`/`Activity` events; add a leaderboard
  page — top gas spenders get bonus RON from the pool.
- **Session batching:** let users pass a session id in `logActivity(ctx)` and
  show "gas burned this week" dashboards.
- **Give the rebate product purpose:** tie rebates to an off-chain task (daily
  check-in, quest) so usage is habitual, not one-off.
- **Saigon testnet first:** deploy + test the whole loop for free, then repeat
  on mainnet.

> **Security note:** this contract keeps no secrets, holds no user funds beyond
> the rebate pool, and has no selfdestruct — the main risks are (a) setting
> `rebatePerGas` too high so the pool drains, and (b) nothing else. Audit the
> constructor args before deploying. Test on Saigon first.
