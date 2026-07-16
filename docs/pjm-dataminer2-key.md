# Getting a PJM Data Miner 2 API key — steps, cost, and the catch

*Researched 2026-07-15 (sources: pjm.com Data Miner 2 page, apiportal.pjm.com, PJM membership
enrollment page). Written as the follow-up note to the wave-4 power-tail design, which chose
multi-hub keyless feeds (CAISO/MISO/ICE) partly because of the redistribution restriction
described below.*

## What the key buys

Programmatic access to PJM's Data Miner 2 API (`api.pjm.com/api/v1/...`) — day-ahead and
real-time LMPs for every PJM pricing node, including **Western Hub** (pnode 51288) and the
**Dominion zone** (Northern Virginia — Data Center Alley, the densest data-center market on
earth). This is the feed that would make the DC Ops power tail tell the most on-story version
of itself.

## Steps (≈15 minutes, self-service)

1. **Create a PJM account** — register at [tools.pjm.com](https://tools.pjm.com/) (a
   non-member "guest" account is fine; no company affiliation required).
2. **Sign in to the API Portal** — [apiportal.pjm.com](https://apiportal.pjm.com/) with that
   account, and subscribe to the **Data Miner 2 API** product. The subscription is
   self-service and issues a primary + secondary subscription key immediately.
3. **Copy the key** — requests authenticate with the `Ocp-Apim-Subscription-Key` header.
   Reference: the [Data Miner 2 API guide (PDF)](https://www.pjm.com/-/media/DotCom/etools/data-miner-2/data-miner-2-api-guide.pdf)
   (last updated Feb 2026).
4. **Wire it into the pipeline** — add `PJM_API_KEY=<primary key>` to `.env` locally and as a
   GitHub Actions repository secret (same pattern as `FRED_API_KEY`); the future connector
   registers under its own `PJM` source key.

## Cost and limits

- **The account and API key are free.** No application fee, no subscription charge.
- **Rate limits by status:** non-members are capped at **6 data connections per minute**
  (PJM members get 600). Our daily run would make 1–2 requests per day — the non-member cap is
  a non-issue for collection.

## The catch: publishing requires paid membership

PJM's Data Miner terms state that **"redistribution of information and or data contained in or
derived from Data Miner is strictly prohibited without an active PJM Membership. A minimum
level of Associate Membership is required."**

- **Associate Membership: $2,500/year** (no application fee; non-voting, no market access).
- macrogauge publishes everything it computes on a public site, and a spliced tail or a
  Dominion-zone stat card is plainly "derived from" the data — so *using* the free key for a
  published feature is effectively a **$2,500/year decision**, or requires written
  clarification from PJM that an aggregated/derived index falls outside "redistribution"
  (Member Relations: 866-400-8980).
- Collection for internal analysis under the free key is a lighter question, but this repo's
  posture (per the DRAMeXchange precedent) is to resolve publication rights BEFORE building
  anything that would publish.

## Bottom line

The wave-4 multi-hub keyless path (CAISO OASIS + MISO market reports + EIA's ICE workbook —
all public-transparency feeds with no redistribution gate) covers the power tail without any
of this. Register a PJM key only if the Dominion/Data-Center-Alley story is worth either
$2,500/year or a clarifying exchange with PJM Member Relations — in which case the connector
slots in under its own `PJM` source key with zero changes to the existing tail machinery
(a third entry in the ops component's `live_proxy_blend`).
