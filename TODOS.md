# TODOS

## ~~Golden Fixture Tests for Calculation Engine~~ ✅ DONE (2026-04-02)

50/50 hand-calculated unit tests passing in `src/__tests__/calculations.test.ts`.

---

## Deferred from CEO Plan (2026-03-25)

- **Sharpe/Sortino Ratios** — risk-adjusted return metrics (P2, effort S)
- **Export Chart as PNG** — download individual charts as images (P3, effort S)

---

## Deferred from Design Review (2026-04-02)

- **DESIGN.md** — Document the design system: màu sắc (#059669 xanh / #2563EB xanh dương), spacing scale, pattern `dca-param-row`, pill button pattern, card layout conventions. Helps keep So Sánh, DCA, LS vs DCA tabs visually consistent as the app grows. (P3, effort S)

---

## Deferred from Eng Review (2026-07-10) — daily-data migration diff

**What:** Two performance findings surfaced during `/plan-eng-review` of the weekly→daily calculation-engine migration, both profiled and found acceptable at current scale (56 funds, longest history 22 years) but worth revisiting if data volume grows.

- **`WinRateBlock.tsx` re-parses the same date array up to 12x per render.** `btcPercents.map()` (3 weight scenarios) × `HORIZONS.map()` (4 horizons) = 12 calls to `rollingWinRate()`, each internally calling `rollingCumulativeReturns()` twice, each independently doing `returns.map(r => new Date(r.date).getTime())` over the full array — and `baseReturns` is the *same* array across all 12 outer iterations. Measured: ~893ms end-to-end for E1VFVN30 (12yr) covering the whole Bitcoin tab re-render (all charts + this table), which is acceptable. Fix would be to memoize `baseReturns`'s parsed dates once and thread pre-parsed `number[]` dates through `rollingCumulativeReturns`/`rollingWinRate` — touches a public signature used across 5 components, so hold until it's actually slow. (P3, effort S, source: outside-voice cross-model review)

- **`rollingMaxDrawdown` (calculations.ts) is still O(n·w)**, unlike its sibling rolling functions which got prefix-sum treatment during the daily migration. Both `n` (data points) and `w` (window size in points) scale ~5-7x under the weekly→daily migration for the same calendar span, so this function's cost scales ~25-49x for that transition specifically (not for longer history — that part scales linearly). Max-drawdown is inherently harder to optimize than sum/variance (needs a monotonic-deque technique for true O(n), not just prefix-sums). Profiled as part of the same 893ms measurement above — fine today. Revisit if fund histories get much longer or if this becomes a hot path (e.g. called per-portfolio in a loop somewhere new). (P3, effort M — nontrivial algorithm, needs careful test coverage, source: outside-voice cross-model review)

**Context:** both found via an independent Claude-subagent "outside voice" review during `/plan-eng-review`, not the primary review pass — a good example of the cross-model check catching something the single-pass review missed (documented in the review's Completion Summary).
