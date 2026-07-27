# P4 Long-Lead Board Vendor Figure Verification Spike Notes (2026-07-26)

Live re-fetch of every primary source named in
`.superpowers/sdd/2026-07-26-dc-longlead-board/task-1-brief.md` — 8 vendors (GE Vernova, Vertiv,
ABB, Hitachi Energy, Eaton, Caterpillar, Cummins, Schneider Electric) plus a pumps-roster search
pass. Every fetch below was run live today (2026-07-26) via `curl` with an identifying UA (SEC
requires one) and teed verbatim to the scratchpad before any number was transcribed; PDFs were
extracted with `pdftotext -layout`. Where the recon table's URL was superseded by a newer filing,
both URLs are recorded and the newer one wins per the task brief.

**Headline results:** 6 of 8 vendors confirmed the recon table's magnitudes essentially exactly
(GE Vernova, ABB, Hitachi Energy, Eaton, Caterpillar, Schneider). Two are genuine findings that
change the picture: **Vertiv's Q1 2026 earnings release and 10-Q contain zero backlog/book-to-bill
disclosure** — the metric recon expected to be "confirmed or superseded" was instead *discontinued*
between Q4 2025 and Q1 2026, so the newest available figure is still the Q4 2025 one (recon's
candidate), not a newer number. **Eaton's "+44%" backlog-growth figure turns out to be
segment-specific (Electrical Americas), not a blanket "Electrical" figure** — the release's own
headline bullet states a different, blended +48% for "Electrical sector," and Electrical Global
specifically grew +73%; all three numbers are real and verbatim, they're just different scopes of
the same word "Electrical." The Cummins and pumps null verdicts both confirmed exactly as
expected, with a precise, quotable definition of what Cummins *does* disclose (a maintenance-
dominated Topic 606 note, not an order backlog) and a live 10-Q line item proving Flowserve — the
only public pure-play pump maker on the loose roster — breaks its backlog out by four generic
end-markets that do not include a data-center category. Schneider's canonical PDF, flagged by the
brief as 403-blocked to non-browser fetchers, **loaded cleanly (HTTP 200) for this run's curl UA**
— a discrepancy against the brief's stated hazard, noted below.

---

## 1. GE Vernova — group backlog + Electrification book-to-bill

**Fetched:** `https://www.sec.gov/Archives/edgar/data/1996810/000199681026000147/gevpressrelease2q26.htm`
(Q2 2026 8-K press release, filed 2026-07-22) — tee: `task1-spike-gev-q2-8k.log` (644,707 bytes),
cleaned text `task1-spike-gev-q2-8k-clean.txt`. This **is already the newest available release**
(SEC submissions feed checked — accession 0001996810-26-000147, filed 2026-07-22, is GEV's most
recent 8-K; no Q3 2026 exists yet).

**Verbatim quotes:**
- Headline: "GE Vernova reports second quarter 2026 financial results and raises 2026 financial
  guidance ... Backlog¹ growth of $13.0 B sequentially"
- Footnote (superscript 1, top of doc): "¹ Defined as remaining performance obligation (RPO)"
- CEO quote: "With a backlog of $176 billion, continued revenue growth and margin expansion, and
  significant free cash flow generation, GE Vernova’s momentum is building, and we are raising our
  2026 financial guidance," said GE Vernova CEO Scott Strazik.
- Electrification: "Orders of $6.3 billion increased +66% organically, driving a book-to-bill
  ratio of approximately 1.7, with continued strong demand for..."
- Dateline: "CAMBRIDGE, Mass., (July 22, 2026)"

**Precision upgrade (bonus fetch, not required by the brief):** also fetched the matching Q2 2026
10-Q — `https://www.sec.gov/Archives/edgar/data/1996810/000199681026000148/gev-20260630.htm`
(accession 0001996810-26-000148, filed same day 2026-07-22) — tee: `task1-spike-gev-q2-10q.log` /
`-clean.txt`. MD&A states the **precise** figure the press release rounds: "RPO was $176.3 billion
and $128.7 billion as of June 30, 2026 and 2025, respectively." Fully consistent with the press
release's "$176 billion" (rounds to it), not a disagreement — SPIKE-FINAL uses the more precise
10-Q figure and cites both documents. The 10-Q also restates the RPO≡backlog definition in fuller
form: "RPO, a measure of backlog, includes unfilled firm and unconditional customer orders for
equipment and services, excluding any purchase order that provides the customer with the ability
to cancel or terminate without incurring a substantive penalty."

**Verdict — confirmed, magnitude matches brief's ~$176B expectation exactly; precision improved
to $176.3B via the same-day 10-Q.**

---

## 2. Vertiv — backlog discontinued in Q1 2026 disclosure (genuine finding)

**Fetched (brief's candidate):**
`https://www.sec.gov/Archives/edgar/data/1674101/000167410126000006/exhibit991vrt02112026.htm`
(Q4 2025 8-K Ex-99.1, filed 2026-02-11) — tee: `task1-spike-vrt-q4-8k.log` / `-clean.txt`.

**Verbatim quote (Q4 2025):** "Fourth quarter 2025 book-to-bill ratio was ~2.9x and backlog
increased to $15.0 billion, up 109% compared to the same period last year."

**Supersession check (per brief step 2):** queried SEC EDGAR submissions
(`task1-spike-submissions-vrt.log`) for all VRT 8-K/10-Q filings since 2026-01-01. Newest earnings
filings are the **Q1 2026** 8-K (accession 0001628280-26-026379, filed 2026-04-22,
`q12026exhibit991vrt04222026.htm`) and matching 10-Q (accession 0001628280-26-026556, filed
2026-04-22, `vrt-20260331.htm`). Both fetched fresh: tee `task1-spike-vrt-q1-8k.log` /
`-clean.txt` and `task1-spike-vrt-q1-10q.log` / `-clean.txt`. **Neither document contains a
numeric backlog or book-to-bill figure** — grep for "backlog" in both returns only the generic
risk-factor boilerplate ("failure to realize sales expected from our backlog of orders and
contracts"), and "book-to-bill" returns zero hits in either. This is a genuine change from every
prior quarter's release, which led with the metric. A WebSearch pass for "Vertiv Q1 2026 earnings
backlog book-to-bill investor presentation slides" independently turned up no numeric backlog
figure from any source either (Motley Fool transcript, Quartr summary, etc. all report sales/EPS/
margin, never backlog).

No later filing exists: two later 8-Ks (2026-06-03, 2026-06-12) not earnings-related by form
context, and the newest, 2026-06-18 (`vrt-20260617.htm`), is confirmed **Item 5.07** (annual
meeting vote results) by direct fetch — tee `task1-spike-vrt-jun-8k-check.log` — not an earnings
release. No Q2 2026 filing exists yet as of 2026-07-26 (Vertiv typically reports Q2 in early
August).

**Verdict — genuine finding, not a simple confirm-or-supersede: the newest AVAILABLE
backlog/book-to-bill figure remains the recon table's Q4 2025 candidate ($15.0B / ~2.9x), because
Vertiv stopped disclosing the metric in its two most recent quarterly releases.** SPIKE-FINAL
records the Q4 2025 figures with a discrepancy note; both the Q1 2026 8-K and 10-Q URLs are
recorded as evidence that the metric was checked and is absent, not merely unfetched.

---

## 3. ABB — Electrification order backlog, group backlog, group book-to-bill

**Fetched (Q1 2026, brief's stable entry point):** `https://new.abb.com/news/detail/135137/q1-2026-results`
— tee: `task1-spike-abb-q1-news.log` (112,973 bytes). Published 2026-04-22 (page metadata:
`datetime="2026-04-22T04:46:40+02:00"`).

**Verbatim (Q1 2026 CEO quote):** "We achieved book-to-bill of 1.29 with strong comparable order
growth of 9% and 5% respectively in the Motion and Automation business..."

**Newest-release check (per brief step 3):** WebSearch confirmed ABB's **Q2 2026 results
published 2026-07-16** — newer than Q1 and newer than the brief's named stable URL. Fetched the
Q2 2026 news-center page: `https://new.abb.com/news/detail/137496/q2-2026-results` — tee:
`task1-spike-abb-q2-news.log` (119,199 bytes, `datetime="2026-07-16T05:08:22+02:00"`). Per the
brief's explicit hazard note, this news-center page URL — not the tokenized `library.e.abb.com`
PDF link — is what SPIKE-FINAL cites as `src.url`.

To pull exact figures, also fetched two **non-tokenized** `resources.news.e.abb.com` attachment
URLs discovered by parsing the news page's own links (same durability class as a stable IR
attachment, no `x-sign` expiring token):
- Press release PDF: `https://resources.news.e.abb.com/attachments/published/137496/en-US/9123465FF532/ABB_Q2_2026_Press_release_English.pdf`
  — tee: `task1-spike-abb-q2-pressrelease.pdf` / `.txt` (773 lines extracted).
- Group results (investor deck) PDF: `https://resources.news.e.abb.com/attachments/published/137496/en-US/C18F3EFD6403/ABB-Q2-2026-Group-results.pdf`
  — tee: `task1-spike-abb-q2-groupresults.pdf` / `.txt` (20-slide deck, corroborating source).
- Financial Information PDF (tokenized `library.e.abb.com` link, fetched for verification only,
  never as a citation `src.url` per the brief's hazard note): tee `task1-spike-abb-q2-fininfo.pdf`
  / `.txt` (1,207,035 bytes — byte-identical size to a prior same-day fetch, corroborating it's
  the genuine document).

**Verbatim quotes:**
- Electrification segment table (`task1-spike-abb-q2-fininfo.txt`, financial-information
  supplement, headed "Order backlog (end June) ... Electrification"): "Order backlog (end June)
  ABB Group 30,007 23,670 27% 28% 28% / Electrification 13,676 8,685 57% 59% 59%" (columns: Q2
  2026 / Q2 2025 / US$ chg / Local chg / Comparable chg). Independently corroborated in the press
  release's own segment table (`task1-spike-abb-q2-pressrelease.txt` line 352): "Order backlog
  13,676 8,685 57% 59% 13,676 8,685 57% 59%" (Q2 and H1 columns, same numbers since H1=Q2 backlog
  is a point-in-time stock).
- Group backlog + book-to-bill (prose, press release): "The order backlog amounted to $30,007
  million, up 27% (28% comparable) year-on-year." / "Revenues were record-high but orders even
  stronger, leaving the book-to-bill at 1.27, supported by a positive development in all three
  business areas."
- Order-backlog definition note (`task1-spike-abb-q2-fininfo.txt`): "The Company considers its
  order backlog to represent its unsatisfied performance obligations. At June 30, 2026, the
  Company had unsatisfied performance obligations totaling $30,007 million and, of this amount,
  the Company expects to fulfill approximately 47 percent of the obligations in 2026,
  approximately 33 percent of the obligations in 2027 and the balance thereafter."

**Verdict — confirmed exactly against the brief's Q2 expectation ($13,676M vs $8,685M, +57%).**
Q2 2026 book-to-bill is **1.27** (group), which *supersedes* the brief-cited Q1 2026 CEO quote of
1.29 — both are real, verbatim, and now recorded; SPIKE-FINAL uses the newer 1.27.

---

## 4. Hitachi Energy — order backlog (FY2025-end)

**Fetched:** `https://www.hitachi.com/content/dam/hitachi/global/en/press/files/2026/04/260427/2025_Anpre.pdf`
(FY2025 annual earnings presentation, dated 2026-04-27) — tee: `task1-spike-hitachi-fy2025-pres.pdf`
(1,077,823 bytes) / `.txt`.

**Verbatim (slide "Order Backlog (as of FY2025-end)"):**
```
Order Backlog (as of FY2025-end)
     DSS              : 1.7 tn yen     (+11% vs end-FY2024)
     Hitachi Energy   : 9.2 tn yen     (+42% vs end-FY2024)
                        57.9 bn USD    (+33% vs end-FY2024)
16   Mobility         : 7.1 tn yen     (+15% vs end-FY2024)
```
Period: FY2025-end = 2026-03-31 (Japanese fiscal year). Both currency figures recorded verbatim
per the brief's instruction; SPIKE-FINAL config uses the company-stated USD figure (57.9bn).

**Newer-deck check (per brief step 4):** the official IR presentation library
(`https://www.hitachi.com/IR-e/library/presentation/index.html`, tee
`task1-spike-hitachi-ir-index.log`, HTTP 200) lists no FY2026 Q1 (Apr–Jun 2026) deck as of
2026-07-26 — Hitachi Ltd.'s Q1 FY2026 results are not yet published (Hitachi Energy's separately-
listed Indian subsidiary, POWERINDIA, reports on its own India-FY calendar and is a different
entity, confirmed via WebSearch, not conflated here). Also fetched Hitachi's June 10, 2026
"Investor Day 2026" Energy-segment deck
(`https://www.hitachi.com/content/dam/hitachi/global/en/press/files/2026/06/260610/20260610_01_energy_en.pdf`,
tee `task1-spike-hitachi-investorday2026.pdf`/`.txt`, 3,843,767 bytes) — it restates the *same*
FY2025 backlog on a strategy chart ("~60" B USD, "*1 B USD 2026 budget rate," rounds consistently
with 57.9) but is not a new quarterly disclosure, so it does not supersede the April deck.

**Verdict — confirmed exactly against the brief's expected slide text.**

---

## 5. Eaton — backlog growth is scope-dependent (genuine finding), rolling book-to-bill confirmed

**Fetched:** `https://www.sec.gov/Archives/edgar/data/1551182/000155118226000010/etn03312026exhibit99.htm`
(Q1 2026 8-K Ex-99, released DUBLIN — May 5, 2026) — tee: `task1-spike-etn-q1-8k.log` /
`-clean.txt`. Confirmed this is already the newest: SEC submissions
(`task1-spike-submissions-etn.log`) show no 10-Q or earnings 8-K after 2026-05-05; the one later
8-K (2026-06-11) was fetched and confirmed **Item 7.01/8.01/9.01** (tee
`task1-spike-etn-jun-8k-check.log`) — a Reg FD/other-events filing, not earnings. Eaton had not
yet reported Q2 2026 as of 2026-07-26.

**Verbatim quotes — three different "Electrical" backlog-growth numbers in one release, each a
different scope:**
- Headline bullet (company-wide blend): "Strong year-over-year total backlog growth of 48% in
  Electrical sector and 28% in Aerospace segment"
- Electrical **Americas** segment body copy: "The twelve-month rolling average of orders in the
  first quarter was up 42% organically. Total backlog at the end of March remained strong and was
  up 44% over March 2025."
- Electrical **Global** segment body copy: "The twelve-month rolling average of orders in the
  first quarter was up 13% organically. Total backlog at the end of March was up 73% over March
  2025."
- Rolling-12mo book-to-bill (combined Electrical businesses, immediately following the Electrical
  Global sentence above): "On a rolling twelve-month basis, the book-to-bill ratio for the
  Electrical businesses increased to 1.2."

**Verdict — the brief's expected "+44%" is real but is the Electrical Americas segment figure
specifically, not a blanket "Electrical sector" number** (that headline figure is 48%, a blend of
Americas 44% + Global 73%, weighted differently than a simple average). SPIKE-FINAL records the
44% figure with `scope` disambiguated to Electrical Americas in the `metric` slug and quotes the
full sentence so the segment is unambiguous; the 48% headline and 73% Electrical Global numbers
are recorded here as context, not duplicated as separate SPIKE-FINAL figures (brief asked for one
backlog_growth figure). Rolling-12mo book-to-bill of **1.2** confirmed exactly, scope = combined
Electrical businesses (Americas + Global), matching the brief's expectation exactly.

---

## 6. Caterpillar — MD&A order backlog

**Fetched:** `https://www.sec.gov/Archives/edgar/data/18230/000001823026000021/cat-20260331.htm`
(Q1 2026 10-Q, filed 2026-05-06) — tee: `task1-spike-cat-q1-10q.log` (3,459,434 bytes) /
`-clean.txt`. Confirmed newest via SEC submissions (`task1-spike-submissions-cat.log`): no Q2 2026
10-Q exists yet as of 2026-07-26 (CAT files early August).

**Verbatim (MD&A "Order Backlog" section):** "At the end of the first quarter of 2026, the dollar
amount of backlog believed to be firm was approximately $62.7 billion, about $11.5 billion higher
than the fourth quarter of 2025. The order backlog increased across the three primary segments,
with the largest increase in Power & Energy. The backlog for large reciprocating engines and
turbine products continues to grow within Power & Energy. Of the total backlog at March 31, 2026,
approximately $24.8 billion was not expected to be filled in the following twelve months."

**Segment-name check (per brief step 6):** the quoted sentence itself confirms the current segment
name is **"Power & Energy"** (not "Energy & Transportation," the pre-2023 name) — this is the
`dc_segment` value downstream tasks should use.

**Verdict — confirmed exactly against the brief's expected $62.7B total / $24.8B beyond-12-months
split.**

---

## 7. Cummins — null verdict (backlog/orders/book-to-bill absent; RPO note is maintenance-dominated)

**Fetched:**
- Q1 2026 10-Q: `https://www.sec.gov/Archives/edgar/data/26172/000002617226000016/cmi-20260331.htm`
  (filed 2026-05-05) — tee: `task1-spike-cmi-q1-10q.log` (2,064,541 bytes) / `-clean.txt`.
- Matching Q1 2026 earnings release: `https://www.sec.gov/Archives/edgar/data/26172/000002617226000013/cmi2026q18-kex99.htm`
  (8-K Ex-99, released May 5, 2026) — tee: `task1-spike-cmi-q1-8k.log` (550,348 bytes) /
  `-clean.txt`.

**Confirmed: zero mentions.** `grep -io "backlog"` and `grep -io "book-to-bill"` both return **0**
hits in both documents (checked directly, not by inference).

**What Cummins discloses instead (verbatim, 10-Q Note 2, "Revenue from Contracts with
Customers"):** "We have certain arrangements, primarily long-term maintenance agreements,
construction contracts, product sales with associated performance obligations extending beyond a
year, product sales with lead times extending beyond one year that are non-cancellable or for
which the customer incurs a penalty for cancellation and extended warranty coverage arrangements
that span a period in excess of one year. The aggregate amount of the transaction price for these
contracts, excluding extended warranty coverage arrangements, at March 31, 2026, was $6.9 billion.
We expect to recognize the related revenue of $4.0 billion over the next 12 months and $2.9
billion over periods up to 10 years."

**Verdict — confirmed, matches brief's expected null exactly.** The $6.9B figure is a Topic 606
remaining-transaction-price disclosure, explicitly scoped by the note's own text to "primarily
long-term maintenance agreements" — not an industrial equipment order-backlog metric comparable to
GEV/VRT/ABB/Hitachi/ETN/CAT. `null_note` text below cites both documents and today's check date.

---

## 8. Schneider Electric — FY2025 annual figure (canonical URL loaded cleanly this run)

**Fetched (canonical, brief's flagged-hazard URL):**
`https://www.se.com/ww/en/assets/564/document/528237/release-fy-results-2025.pdf` — tee:
`task1-spike-se-fy2025-canonical.pdf` (781,628 bytes, valid 19-page PDF) / `.txt`.

**Discrepancy against the brief:** the brief states this URL "403-blocks non-browser fetchers
(Akamai)." **This run's `curl` — using an identifying research UA string rather than curl's
default UA — got HTTP 200 on the first try**, no browser-grade fetch needed. (A separate,
earlier same-day attempt in this scratchpad using a different UA did get an Akamai "Access Denied"
403 — both outcomes are on record — see `task1-spike-se-financialresults-page.log` context and
the pre-existing `se_fy2025.pdf` 403 body in the scratchpad. The 403 is real and UA-sensitive, not
a brief error; today's successful fetch should not be assumed reproducible for an unattended
fetcher.) Because the canonical URL worked directly this run, it is cited as both the `src.url`
**and** the verified-against document — no fallback republication was needed. A Euronext regulated-
news mirror was also located as a documented fallback path for future runs
(`https://live.euronext.com/sites/default/files/company_press_releases/attachments/2026/02/26/cpr03_lesechos_16165_1391071_20260226_PR_FY2025_EN_vF.pdf`)
but returned HTTP 202 with an empty body on this attempt (tee: `task1-spike-se-fy2025-euronext-mirror.pdf`,
0 bytes) — noted as a fetch failure for the record, not relied upon since the canonical URL
succeeded.

**Verbatim quote:** "The Group closed the year with backlog of €25,362 million (2024: €21,420
million), up +18%. Backlog grew across both businesses, with Energy Management at €21,340 million,
up +21%, and Industrial Automation at €4,022 million, up +8%. Backlog grew across all business
models, with the most significant increase seen in Systems in North America due to accelerated
demand in the Data Center end-market." Dateline: "Rueil-Malmaison (France), February 26, 2026."

**H1 2026 check (per brief step 8):** WebSearch confirms Schneider's H1 2026 results are
**scheduled for 2026-07-30** — 4 days after this spike, not yet published. Confirmed independently
via Schneider's own financial-results IR index page
(`https://www.se.com/ww/en/about-us/investor-relations/financial-results/`, tee
`task1-spike-se-financialresults-page.log`, HTTP 200): only a Q1 2026 revenue release is listed
(`release-q1-revenues-2026`, `presentation-q1-revenues-2026`), no H1/H2 2026 filing exists yet.
FY2025 remains the correct figure per the brief's own expectation of "qualitative-only at
half-year, if anything."

**Verdict — confirmed exactly against the brief's expected €25,362M / €21,340M.**

---

## 9. Pumps — null verdict (Flowserve, Xylem, Grundfos)

**Flowserve** (the only public pure-play pump maker on the loose roster) — fetched Q1 2026 10-Q:
`https://www.sec.gov/Archives/edgar/data/30625/000003062526000012/fls-20260331.htm` (period ended
2026-03-31; note the CIK must be unpadded — `data/0000030625/...` 301-redirects to
`data/30625/...`) — tee: `task1-spike-fls-q1-10q.log` (1,480,221 bytes) / `-clean.txt`.

**Verbatim (Bookings, Sales and Backlog section):** "Backlog of $2.9 billion at March 31, 2026
increased by $78.0 million, or 2.7%, as compared with December 31, 2025. ... Approximately 43.4%
of the backlog ... was related to aftermarket orders." Immediately preceding: "We revised the end
market categories for bookings during the first quarter of 2025 ... from five categories (i.e.,
oil and gas, chemical, power generation, water management and general industries) to four
categories (i.e., energy, chemical, power generation and general industries)."

**Confirmed: "data center" appears zero times in the entire filing** (`grep -cio "data center"` →
0). Flowserve discloses one company-wide backlog figure, split only by aftermarket share and four
generic industrial end-markets (energy / chemical / power generation / general industries) — no
data-center category exists in its own disclosure taxonomy.

**Xylem and Grundfos:** WebSearch passes for each found only narrative marketing content about
data-center liquid-cooling products (e.g., xylem.com's "AI Data Center liquid cooling solutions"
page) and, for Grundfos, its 2025 annual report's growth commentary citing data centers as "a key
growth driver" for US sales — but **neither discloses any order-backlog figure at all**, segmented
or otherwise, at a level that would meet the primary-source bar (Grundfos is a private,
foundation-owned company and does not file a 10-Q/10-K; Xylem's own IR materials were not found to
carry a backlog metric in this search pass).

**Verdict — confirmed, matches brief's expected null exactly: no pump maker meets the roster's
primary-source-with-DC-relevance bar.**

---

## SPIKE-FINAL

All values below are transcribed directly from the teed evidence cited above (tee filenames
repeated on each figure). Task 2 copies this section verbatim into the config.

```json
[
  {
    "vendor": "GE Vernova",
    "metric": "group_backlog_rpo",
    "kind": "backlog",
    "basis": "rpo",
    "scope": "group",
    "value": 176.3,
    "unit": "usd_b",
    "period": "2026-06-30",
    "asof": "2026-07-22",
    "quote": "RPO was $176.3 billion and $128.7 billion as of June 30, 2026 and 2025, respectively.",
    "src": {
      "label": "GE Vernova Q2 2026 10-Q (SEC EDGAR)",
      "url": "https://www.sec.gov/Archives/edgar/data/1996810/000199681026000148/gev-20260630.htm"
    },
    "notes": "Press release (src2) rounds to the same figure: \"With a backlog of $176 billion...\" — CEO Scott Strazik, GE Vernova Q2 2026 8-K press release, https://www.sec.gov/Archives/edgar/data/1996810/000199681026000147/gevpressrelease2q26.htm. Footnote defines backlog ≡ RPO (\"Defined as remaining performance obligation (RPO)\"). Tee: task1-spike-gev-q2-10q.log, task1-spike-gev-q2-8k.log."
  },
  {
    "vendor": "GE Vernova",
    "metric": "electrification_book_to_bill",
    "kind": "book_to_bill",
    "basis": "quarterly-book-to-bill",
    "scope": "segment",
    "value": 1.7,
    "unit": "ratio",
    "period": "2026-06-30",
    "asof": "2026-07-22",
    "quote": "Orders of $6.3 billion increased +66% organically, driving a book-to-bill ratio of approximately 1.7, with continued strong demand for...",
    "src": {
      "label": "GE Vernova Q2 2026 8-K press release, Electrification segment (SEC EDGAR)",
      "url": "https://www.sec.gov/Archives/edgar/data/1996810/000199681026000147/gevpressrelease2q26.htm"
    },
    "notes": "metric scoped to the Electrification segment specifically. Tee: task1-spike-gev-q2-8k.log."
  },
  {
    "vendor": "Vertiv",
    "metric": "group_backlog",
    "kind": "backlog",
    "basis": "order-backlog",
    "scope": "group",
    "value": 15.0,
    "unit": "usd_b",
    "period": "2025-12-31",
    "asof": "2026-02-11",
    "quote": "Fourth quarter 2025 book-to-bill ratio was ~2.9x and backlog increased to $15.0 billion, up 109% compared to the same period last year.",
    "src": {
      "label": "Vertiv Q4 2025 8-K exhibit 99.1 (SEC EDGAR)",
      "url": "https://www.sec.gov/Archives/edgar/data/1674101/000167410126000006/exhibit991vrt02112026.htm"
    },
    "notes": "GENUINE FINDING: this is still the newest AVAILABLE figure, not merely the newest checked. Vertiv's Q1 2026 8-K (https://www.sec.gov/Archives/edgar/data/1674101/000162828026026379/q12026exhibit991vrt04222026.htm) and matching 10-Q (https://www.sec.gov/Archives/edgar/data/1674101/000162828026026556/vrt-20260331.htm), both filed 2026-04-22, were fetched and checked directly — both contain zero numeric backlog/book-to-bill disclosure (only generic risk-factor boilerplate). No Q2 2026 filing exists yet as of 2026-07-26. Tee: task1-spike-vrt-q4-8k.log, task1-spike-vrt-q1-8k.log, task1-spike-vrt-q1-10q.log."
  },
  {
    "vendor": "Vertiv",
    "metric": "group_book_to_bill",
    "kind": "book_to_bill",
    "basis": "quarterly-book-to-bill",
    "scope": "group",
    "value": 2.9,
    "unit": "ratio",
    "period": "2025-12-31",
    "asof": "2026-02-11",
    "quote": "Fourth quarter 2025 book-to-bill ratio was ~2.9x and backlog increased to $15.0 billion, up 109% compared to the same period last year.",
    "src": {
      "label": "Vertiv Q4 2025 8-K exhibit 99.1 (SEC EDGAR)",
      "url": "https://www.sec.gov/Archives/edgar/data/1674101/000167410126000006/exhibit991vrt02112026.htm"
    },
    "notes": "Same discontinuation finding as group_backlog above applies to this metric too. Tee: task1-spike-vrt-q4-8k.log."
  },
  {
    "vendor": "ABB",
    "metric": "electrification_order_backlog",
    "kind": "backlog",
    "basis": "order-backlog",
    "scope": "segment",
    "value": 13676,
    "unit": "usd_m",
    "period": "2026-06-30",
    "asof": "2026-07-16",
    "quote": "Order backlog (end June) ... Electrification 13,676 8,685 57% 59% 59%",
    "src": {
      "label": "ABB Q2 2026 results (news center)",
      "url": "https://new.abb.com/news/detail/137496/q2-2026-results"
    },
    "notes": "Table columns (Financial Information supplement, p.3): Q2 2026 / Q2 2025 / US$ change / Local change / Comparable change. Verified against ABB_Q2_2026_Press_release_English.pdf (line 352, same numbers) and Q2 2026 Financial Information supplement (fetched via tokenized library.e.abb.com link for verification only, never cited as src per the brief's hazard note). Matches brief's expected $13,676M vs $8,685M, +57% exactly. Tee: task1-spike-abb-q2-pressrelease.txt, task1-spike-abb-q2-fininfo.txt."
  },
  {
    "vendor": "ABB",
    "metric": "group_order_backlog",
    "kind": "backlog",
    "basis": "order-backlog",
    "scope": "group",
    "value": 30007,
    "unit": "usd_m",
    "period": "2026-06-30",
    "asof": "2026-07-16",
    "quote": "The order backlog amounted to $30,007 million, up 27% (28% comparable) year-on-year.",
    "src": {
      "label": "ABB Q2 2026 results (news center)",
      "url": "https://new.abb.com/news/detail/137496/q2-2026-results"
    },
    "notes": "Order-backlog definition note (verified against Financial Information supplement): \"The Company considers its order backlog to represent its unsatisfied performance obligations. At June 30, 2026, the Company had unsatisfied performance obligations totaling $30,007 million and, of this amount, the Company expects to fulfill approximately 47 percent of the obligations in 2026, approximately 33 percent of the obligations in 2027 and the balance thereafter.\" Tee: task1-spike-abb-q2-pressrelease.txt, task1-spike-abb-q2-fininfo.txt."
  },
  {
    "vendor": "ABB",
    "metric": "group_book_to_bill",
    "kind": "book_to_bill",
    "basis": "quarterly-book-to-bill",
    "scope": "group",
    "value": 1.27,
    "unit": "ratio",
    "period": "2026-06-30",
    "asof": "2026-07-16",
    "quote": "Revenues were record-high but orders even stronger, leaving the book-to-bill at 1.27, supported by a positive development in all three business areas.",
    "src": {
      "label": "ABB Q2 2026 results (news center)",
      "url": "https://new.abb.com/news/detail/137496/q2-2026-results"
    },
    "notes": "SUPERSEDES the brief-cited Q1 2026 CEO quote of 1.29 (\"We achieved book-to-bill of 1.29...\", ABB Q1 2026 results, https://new.abb.com/news/detail/135137/q1-2026-results, tee task1-spike-abb-q1-news.log) — both are real and verbatim; this figure uses the newer Q2 print per the brief's newest-wins rule. Tee: task1-spike-abb-q2-pressrelease.txt."
  },
  {
    "vendor": "Hitachi Energy",
    "metric": "order_backlog",
    "kind": "backlog",
    "basis": "order-backlog",
    "scope": "segment",
    "value": 57.9,
    "unit": "usd_b",
    "period": "2026-03-31",
    "asof": "2026-04-27",
    "quote": "Order Backlog (as of FY2025-end) ... Hitachi Energy : 9.2 tn yen (+42% vs end-FY2024) 57.9 bn USD (+33% vs end-FY2024)",
    "src": {
      "label": "Hitachi FY2025 (year ended March 2026) results presentation",
      "url": "https://www.hitachi.com/content/dam/hitachi/global/en/press/files/2026/04/260427/2025_Anpre.pdf"
    },
    "notes": "Both currency figures recorded per brief instruction (9.2 tn yen, +42% YoY; 57.9 bn USD, +33% YoY); config value uses the company-stated USD figure. No FY2026 Q1 deck exists yet on hitachi.com IR as of 2026-07-26 (checked: task1-spike-hitachi-ir-index.log). Tee: task1-spike-hitachi-fy2025-pres.txt."
  },
  {
    "vendor": "Eaton",
    "metric": "electrical_americas_backlog_growth",
    "kind": "backlog_growth",
    "basis": "yoy-backlog-growth",
    "scope": "segment",
    "value": 44,
    "unit": "pct_yoy",
    "period": "2026-03-31",
    "asof": "2026-05-05",
    "quote": "The twelve-month rolling average of orders in the first quarter was up 42% organically. Total backlog at the end of March remained strong and was up 44% over March 2025.",
    "src": {
      "label": "Eaton Q1 2026 8-K exhibit 99 (SEC EDGAR)",
      "url": "https://www.sec.gov/Archives/edgar/data/1551182/000155118226000010/etn03312026exhibit99.htm"
    },
    "notes": "GENUINE FINDING: this sentence is from the Electrical AMERICAS segment paragraph specifically, not a blanket 'Electrical' figure. The release's own headline bullet states a different, blended company-wide figure: \"Strong year-over-year total backlog growth of 48% in Electrical sector and 28% in Aerospace segment.\" The Electrical GLOBAL segment paragraph separately states: \"Total backlog at the end of March was up 73% over March 2025.\" All three numbers are real and verbatim; 44% matches the brief's expected value and is the most granular (segment-level) reading. Tee: task1-spike-etn-q1-8k.txt (see task1-spike-etn-q1-8k-clean.txt)."
  },
  {
    "vendor": "Eaton",
    "metric": "electrical_book_to_bill_ltm",
    "kind": "book_to_bill",
    "basis": "ltm-book-to-bill",
    "scope": "segment",
    "value": 1.2,
    "unit": "ratio",
    "period": "2026-03-31",
    "asof": "2026-05-05",
    "quote": "On a rolling twelve-month basis, the book-to-bill ratio for the Electrical businesses increased to 1.2.",
    "src": {
      "label": "Eaton Q1 2026 8-K exhibit 99 (SEC EDGAR)",
      "url": "https://www.sec.gov/Archives/edgar/data/1551182/000155118226000010/etn03312026exhibit99.htm"
    },
    "notes": "Scope = combined Electrical businesses (Americas + Global), rolling 12 months. Matches brief's expected 1.2 exactly. Tee: task1-spike-etn-q1-8k-clean.txt."
  },
  {
    "vendor": "Caterpillar",
    "metric": "group_order_backlog",
    "kind": "backlog",
    "basis": "mdna-backlog",
    "scope": "group",
    "value": 62.7,
    "unit": "usd_b",
    "period": "2026-03-31",
    "asof": "2026-05-06",
    "quote": "At the end of the first quarter of 2026, the dollar amount of backlog believed to be firm was approximately $62.7 billion, about $11.5 billion higher than the fourth quarter of 2025. The order backlog increased across the three primary segments, with the largest increase in Power & Energy.",
    "src": {
      "label": "Caterpillar Q1 2026 10-Q, MD&A Order Backlog (SEC EDGAR)",
      "url": "https://www.sec.gov/Archives/edgar/data/18230/000001823026000021/cat-20260331.htm"
    },
    "notes": "dc_segment confirmed as \"Power & Energy\" (current name, per this same sentence). Tee: task1-spike-cat-q1-10q-clean.txt."
  },
  {
    "vendor": "Caterpillar",
    "metric": "group_backlog_beyond_12mo",
    "kind": "backlog_split",
    "basis": "mdna-backlog",
    "scope": "group",
    "value": 24.8,
    "unit": "usd_b",
    "period": "2026-03-31",
    "asof": "2026-05-06",
    "quote": "Of the total backlog at March 31, 2026, approximately $24.8 billion was not expected to be filled in the following twelve months.",
    "src": {
      "label": "Caterpillar Q1 2026 10-Q, MD&A Order Backlog (SEC EDGAR)",
      "url": "https://www.sec.gov/Archives/edgar/data/18230/000001823026000021/cat-20260331.htm"
    },
    "notes": "Tee: task1-spike-cat-q1-10q-clean.txt."
  },
  {
    "vendor": "Schneider Electric",
    "metric": "group_backlog",
    "kind": "backlog",
    "basis": "order-backlog",
    "scope": "group",
    "value": 25362,
    "unit": "eur_m",
    "period": "2025-12-31",
    "asof": "2026-02-26",
    "quote": "The Group closed the year with backlog of €25,362 million (2024: €21,420 million), up +18%.",
    "src": {
      "label": "Schneider Electric FY2025 Results release (se.com)",
      "url": "https://www.se.com/ww/en/assets/564/document/528237/release-fy-results-2025.pdf"
    },
    "notes": "Canonical URL loaded cleanly (HTTP 200) for this run's curl UA, contradicting the brief's stated 403-Akamai hazard (a different UA did 403 earlier the same day — both outcomes on record, hazard is real but UA-sensitive). Verified-against document = the same canonical URL (no fallback republication needed). H1 2026 results scheduled 2026-07-30, not yet published as of 2026-07-26 (checked: task1-spike-se-financialresults-page.log). Tee: task1-spike-se-fy2025-canonical.txt."
  },
  {
    "vendor": "Schneider Electric",
    "metric": "energy_management_backlog",
    "kind": "backlog",
    "basis": "order-backlog",
    "scope": "segment",
    "value": 21340,
    "unit": "eur_m",
    "period": "2025-12-31",
    "asof": "2026-02-26",
    "quote": "Backlog grew across both businesses, with Energy Management at €21,340 million, up +21%, and Industrial Automation at €4,022 million, up +8%.",
    "src": {
      "label": "Schneider Electric FY2025 Results release (se.com)",
      "url": "https://www.se.com/ww/en/assets/564/document/528237/release-fy-results-2025.pdf"
    },
    "notes": "Tee: task1-spike-se-fy2025-canonical.txt."
  }
]
```

**Cummins `null_note` (verbatim for the config):**

> Cummins discloses no backlog, order-backlog, orders, or book-to-bill metric in either its Q1
> 2026 10-Q (SEC EDGAR, filed 2026-05-05, accession 0000026172-26-000016,
> https://www.sec.gov/Archives/edgar/data/26172/000002617226000016/cmi-20260331.htm) or its
> matching Q1 2026 earnings release (8-K Ex-99, filed 2026-05-05, accession 0000026172-26-000013,
> https://www.sec.gov/Archives/edgar/data/26172/000002617226000013/cmi2026q18-kex99.htm) — both
> checked live 2026-07-26, zero hits for "backlog" or "book-to-bill" in either document. The only
> comparable aggregate is a Topic 606 remaining-transaction-price note in the 10-Q ("NOTE 2.
> REVENUE FROM CONTRACTS WITH CUSTOMERS"), which states $6.9 billion at March 31, 2026 for
> long-term arrangements the note itself describes as "primarily long-term maintenance agreements,
> construction contracts, product sales with associated performance obligations extending beyond a
> year..." — a maintenance-dominated aggregate, not an industrial equipment order-backlog metric
> comparable to peers on this board. Cummins is excluded on this basis.

**Pumps `null_note` (verbatim for the config):**

> One search pass across Flowserve, Xylem, and Grundfos (2026-07-26) found no primary-source pump
> order-backlog metric with data-center relevance. Flowserve's Q1 2026 10-Q (SEC EDGAR, period
> ended 2026-03-31, https://www.sec.gov/Archives/edgar/data/30625/000003062526000012/fls-20260331.htm)
> reports one company-wide backlog of $2.9 billion, broken out only by aftermarket share and four
> generic end-market categories (energy, chemical, power generation, general industries) —
> "data center" appears zero times in the filing. Xylem and Grundfos publish narrative
> data-center-cooling product marketing but no order-backlog figure segmented (or even
> unsegmented, in Grundfos's case as a private foundation-owned company with no 10-K/10-Q) at a
> level meeting this board's primary-source bar. No pump maker is added to the long-lead board.

---

## Access notes

- **SEC EDGAR** (`sec.gov`, `data.sec.gov`): no auth; requires a non-default, identifying UA
  string per SEC's fair-access policy — plain `curl` with no `-A` was not tried, an identifying UA
  (`macrogauge-research ... contact: ericwyluda@gmail.com`) was used throughout and worked for
  every SEC fetch (200s on all EDGAR document and `data.sec.gov/submissions` requests). CIK paths
  must be **unpadded** in `/Archives/edgar/data/<CIK>/...` — a padded CIK (e.g.
  `data/0000030625/...` for Flowserve) 301-redirects to the unpadded form; `curl -L` follows it
  fine but a non-redirecting fetcher would need the unpadded CIK from the start.
- **ABB** (`new.abb.com`, `resources.news.e.abb.com`): no gate for a browser-like UA; the news
  page itself is a heavy client-rendered shell but embeds the full article body (including tables)
  as escaped HTML in an inline payload, greppable directly. `resources.news.e.abb.com/attachments/published/<newsID>/en-US/<hash>/<filename>`
  is a **non-tokenized**, durable attachment URL pattern (no `x-sign`) discoverable by parsing the
  news page's own outbound links — a better citation target than the brief-flagged tokenized
  `library.e.abb.com` links, though this spike followed the brief's explicit instruction to cite
  the news-center page itself as `src.url`.
- **Hitachi** (`hitachi.com`): PDF downloads with plain `curl`, no gate.
- **Eaton, Caterpillar, Cummins, GE Vernova, Vertiv, Flowserve**: all served directly from SEC
  EDGAR, no gate beyond the UA requirement above.
- **Schneider Electric** (`se.com`): Akamai-gated for *some* UAs (confirmed 403 body on file from
  an earlier same-day fetch) but returned clean HTTP 200 for this run's identifying UA — hazard is
  real but not universal; do not assume an unattended fetcher will reproduce today's success
  without testing its specific UA string. The `live.euronext.com` regulated-news mirror discovered
  as a fallback candidate returned HTTP 202 with an empty body on this attempt and was not usable.
- **Xylem, Grundfos**: no direct primary-source fetch attempted (WebSearch only) since the search
  pass found no candidate backlog disclosure worth re-verifying by direct fetch — consistent with
  the brief's expected null outcome.

## Report path

Full report: `.superpowers/sdd/2026-07-26-dc-longlead-board/task-1-report.md`.
Raw evidence tee'd to
`/private/tmp/claude-501/-Users-ericwyluda-Development-macrogauge/1ee235e4-b91d-40b9-adbc-c2e9ee552844/scratchpad/task1-spike-*`
(`.log`/`.pdf`/`.txt` — HTML/PDF raw fetches plus `-clean.txt` regex-stripped text used for
grepping and quoting).
