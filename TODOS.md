# TODOS

## Golden Fixture Tests for Calculation Engine

**What:** Unit tests for all financial calculation functions against R-generated golden outputs.

**Why:** JS calculations must match R to 4 decimal places. Currently 0 test coverage on the entire calculation engine. Silent calculation bugs are the highest-risk failure mode for a financial dashboard.

**Where to start:**
1. Export R fixtures: `write.csv(results, 'src/__tests__/fixtures/fund_A.csv')`
2. Write Vitest comparisons: `expect(cagr(returns)).toBeCloseTo(r_output, 4)`

**Functions to cover:**
- `cagr()` — annualized return
- `maxDrawdown()` — max peak-to-trough decline
- `drawdownSeries()` — full drawdown time series
- `rollingReturns()` — sliding window returns
- `weeklyReturns()` — price → weekly return conversion
- `cumulativeReturns()` — compounded growth
- `winRateAmong()` — multi-fund win rate
- `simulateMultiFundPortfolio()` — rebalancing simulation

**Priority:** P1 — financial accuracy is non-negotiable.

**Depends on:** R environment to export golden fixtures. Already have `src/__tests__/fixtures/` directory ready.

---

## Deferred from CEO Plan (2026-03-25)

- **Sharpe/Sortino Ratios** — risk-adjusted return metrics (P2, effort S)
- **Export Chart as PNG** — download individual charts as images (P3, effort S)
