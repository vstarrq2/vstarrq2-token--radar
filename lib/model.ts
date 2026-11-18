// radar-2: the value model and farm-plan writer behind the token launch radar.
//
// The entry reads a frozen DefiLlama snapshot and answers two questions per
// protocol: what would its token be worth if it traded at the multiple the
// snapshot's own live tokens trade at, and what should a reader do to farm it.
// Nothing here names a protocol: every number comes from the snapshot's own
// figures (TVL, seven-day growth, age with no token, chain count), and every
// farm plan is built from the protocol's category, size and age.

export interface SnapshotProto {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface SnapshotDoc {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProto[];
  watchlist: string[];
}

export interface ScoreFactors {
  growthPct: number;
  growth: number;
  maturity: number;
  breadth: number;
  ageDays: number | null;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: string;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    comp_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  mcap_tvl_ratio: number;
}

export interface RadarParams {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_weight: number;
  breadth_cap: number;
}

// The model's constants. growth_floor/cap are in percent; the rest are plain
// multipliers and day counts.
export const PARAMS: RadarParams = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_weight: 0.05,
  breadth_cap: 3,
};

export const MODEL_VERSION = 'radar-2';
export const LIVE_SET_SIZE = 24;

const round4 = (x: number): number => Math.round(x * 1e4) / 1e4;

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

const medianOf = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

// The comp multiple: the median market-cap-to-TVL ratio of the tokenized
// protocols at or above the floor, rounded to four decimals. It is computed
// from the snapshot on every run, never written down.
export function deriveComp(protos: SnapshotProto[], floor: number): { multiple: number; count: number } {
  const ratios = protos
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd >= floor)
    .map((p) => p.mcap_usd! / p.tvl_usd);
  return { multiple: round4(medianOf(ratios)), count: ratios.length };
}

// Whole days from a listing date to the snapshot date; null when unlisted.
export function daysBetween(listedAt: string | null, asOf: string): number | null {
  if (listedAt === null) return null;
  const start = new Date(`${listedAt}T00:00:00Z`).getTime();
  const end = new Date(`${asOf}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((end - start) / 86400000));
}

// The four factors behind one protocol's implied value, on the exact
// (unrounded) numbers the board is scored with.
export function scoreFactors(proto: SnapshotProto, asOf: string): ScoreFactors {
  const pct = proto.change_7d ?? 0;
  const capped = clamp(pct, PARAMS.growth_floor, PARAMS.growth_cap);
  const growth = 1 + (PARAMS.growth_weight * capped) / 100;
  const ageDays = daysBetween(proto.listed_at, asOf);
  const ageForMaturity = ageDays ?? PARAMS.unknown_age_days;
  const maturity =
    PARAMS.maturity_floor +
    (PARAMS.maturity_range * Math.min(ageForMaturity, PARAMS.maturity_days)) / PARAMS.maturity_days;
  const breadth = 1 + PARAMS.breadth_weight * Math.min(Math.max(proto.chains.length - 1, 0), PARAMS.breadth_cap);
  return { growthPct: capped, growth, maturity, breadth, ageDays };
}

export function impliedUsd(tvl: number, comp: number, f: ScoreFactors): number {
  return Math.round(tvl * comp * f.growth * f.maturity * f.breadth);
}

// The early radar's rule: a pre-token protocol below the floor that is not a
// wrapped, staked or bridged product of a token that already trades, whose
// name carries no version marker and no wrapped/staked word, and that does
// not begin with an exchange's name. The watchlist itself is read from the
// snapshot; this rule finds the same kind of protocol below the floor.
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

export function isEarlyCandidate(proto: SnapshotProto): boolean {
  if (proto.gecko_id !== null || proto.symbol !== null) return false;
  if (proto.category !== null && EXCLUDED_CATEGORIES.has(proto.category)) return false;
  if (/\s(v\d+|V\d+|\d+\.\d+)\s*$/.test(proto.name)) return false;
  if (/\b(wrapped|staked|staking)\b/i.test(proto.name)) return false;
  const lower = proto.name.toLowerCase();
  if (EXCHANGE_NAMES.some((e) => lower.startsWith(`${e.toLowerCase()} `) || lower === e.toLowerCase())) return false;
  return true;
}

// How much a first position costs: bigger protocols get a bigger ticket.
export function depositTier(tvl: number): number {
  if (tvl >= 1_000_000_000) return 150;
  if (tvl >= 100_000_000) return 100;
  return 50;
}

// How long to hold: younger protocols need a longer track record.
export function holdSpan(ageDays: number | null): number {
  if (ageDays === null || ageDays >= 365) return 30;
  if (ageDays >= 180) return 45;
  return 60;
}

// ---------------------------------------------------------------- farm plans
//
// A plan has six steps. The first and last never change. The middle four
// come from the protocol's kind: each kind of protocol is farmed differently
// (a vault is topped up, a pool gets a second position, a lending market gets
// a borrow), so the playbook below maps every category to one of a handful of
// shapes, and each shape carries its own three wordings. Amounts follow the
// deposit tier; the second step is always $20.

type PlaybookShape = {
  open: string;
  again: string;
  weekly: string;
};

const STEP_ONE =
  'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.';
const STEP_LAST =
  "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes, then write the wallet, the dates and every transaction in a farm log. Cost: no fee to check, and never pay to claim. Time: 10 minutes.";
const REPEAT_ON_SECOND =
  'Repeat the position on {second} with $20 of USDC so the activity spans two chains. Cost: about $4 of gas and $20 of capital. Time: 10 minutes.';

const SHAPES: Record<string, PlaybookShape> = {
  vault: {
    open: 'Deposit {amt} into a {name} vault on {chain} and keep the shares.',
    again: 'Deposit $20 into a second {name} vault so the wallet holds two vault shares.',
    weekly: 'Top up a vault by $20 once a week.',
  },
  lend: {
    open: 'Supply {amt} of USDC to {name} on {chain} and keep the position open.',
    again: 'Borrow $20 against the supply on {name}, then repay it the same week to register borrower activity.',
    weekly: 'Supply or borrow a small amount each week so the wallet stays active.',
  },
  pool: {
    open: "Provide {amt} of liquidity to {name}'s main pool on {chain} and keep the position open.",
    again: 'Add $20 to a second pool on {name} so the wallet holds two positions, not one.',
    weekly: 'Swap or add a little liquidity each week so the wallet shows trader activity too.',
  },
  margin: {
    open: 'Deposit {amt} of USDC as margin on {name} and open one small hedge.',
    again: 'Close the hedge on {name} and open a fresh one, so the account shows two settled trades.',
    weekly: 'Open or close one small position each week.',
  },
  stake: {
    open: "Stake {amt} of the chain's staking asset through {name} and keep the receipt.",
    again: 'Restake the receipt once through {name} so the wallet holds the receipt and the restaked position.',
    weekly: 'Claim or compound the staking rewards each week.',
  },
  deposit: {
    open: 'Deposit {amt} of USDC into {name} on {chain} and keep the position open.',
    again: 'Make a second deposit of $20 into {name} on {chain} so the wallet shows repeat activity, not a single transaction.',
    weekly: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.',
  },
  bridge: {
    open: "Bridge {amt} to the chain and use {name}'s own apps for a week.",
    again: 'Make a second deposit of $20 into {name} on {chain} so the wallet shows repeat activity, not a single transaction.',
    weekly: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.',
  },
  route: {
    open: 'Route {amt} of payments through {name} on {chain} and keep the receipt.',
    again: 'Make a second deposit of $20 into {name} on {chain} so the wallet shows repeat activity, not a single transaction.',
    weekly: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.',
  },
  btcChain: {
    open: 'Mint {amt} of the BTC-backed asset through {name} on {chain}.',
    again: 'Make a second deposit of $20 into {name} on {chain} so the wallet shows repeat activity, not a single transaction.',
    weekly: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.',
  },
  btcBare: {
    open: 'Mint {amt} of the BTC-backed asset through {name} on {chain}.',
    again: 'Make a second deposit of $20 into {name} on {chain} so the wallet shows repeat activity, not a single transaction.',
    weekly: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.',
  },
  stable: {
    open: 'Mint or deposit {amt} of the stable asset through {name} on {chain}.',
    again: 'Mint a second stable position of $20 through {name} and hold it beside the first.',
    weekly: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.',
  },
  govern: {
    open: 'Lock {amt} in {name} governance on {chain} and vote once.',
    again: 'Make a second deposit of $20 into {name} on {chain} so the wallet shows repeat activity, not a single transaction.',
    weekly: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.',
  },
  cover: {
    open: 'Buy {amt} of cover from {name} on {chain} and keep the policy.',
    again: 'Make a second deposit of $20 into {name} on {chain} so the wallet shows repeat activity, not a single transaction.',
    weekly: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.',
  },
  yieldMint: {
    open: "Mint {amt} of the protocol's yield asset on {chain} and hold it.",
    again: 'Make a second deposit of $20 into {name} on {chain} so the wallet shows repeat activity, not a single transaction.',
    weekly: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.',
  },
  managed: {
    open: 'Deposit {amt} into a {name} managed position on {chain} and keep the shares.',
    again: 'Make a second deposit of $20 into {name} on {chain} so the wallet shows repeat activity, not a single transaction.',
    weekly: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.',
  },
  predict: {
    open: 'Fund {amt} and place one market position on {name}.',
    again: 'Make a second deposit of $20 into {name} on {chain} so the wallet shows repeat activity, not a single transaction.',
    weekly: 'Place or settle one market each week.',
  },
};

const SHAPE_FOR_CATEGORY: Record<string, string> = {
  'Risk Curators': 'vault',
  'Onchain Capital Allocator': 'vault',
  CDP: 'lend',
  'Collateral Markets': 'lend',
  Lending: 'lend',
  'Uncollateralized Lending': 'lend',
  Dexs: 'pool',
  Yield: 'pool',
  'Yield Aggregator': 'pool',
  'Leveraged Farming': 'pool',
  Farm: 'pool',
  Indexes: 'pool',
  'Basis Trading': 'margin',
  Derivatives: 'margin',
  'Interest Rate Derivatives': 'margin',
  Restaking: 'stake',
  'Staking Pool': 'stake',
  CeDeFi: 'deposit',
  Chain: 'bridge',
  'Crypto Card Issuer': 'route',
  Payments: 'route',
  'Anchor BTC': 'btcChain',
  'Decentralized BTC': 'btcBare',
  'Dual-Token Stablecoin': 'stable',
  'Stablecoin Wrapper': 'stable',
  'Governance Incentives': 'govern',
  Insurance: 'cover',
  RWA: 'yieldMint',
  'Liquidity Manager': 'managed',
  'Prediction Market': 'predict',
};

const shapeFor = (category: string | null): PlaybookShape =>
  SHAPES[SHAPE_FOR_CATEGORY[category ?? ''] ?? 'deposit']!;

const fill = (template: string, slots: Record<string, string>): string => {
  let out = template;
  for (const [key, value] of Object.entries(slots)) out = out.split(`{${key}}`).join(value);
  return out;
};

export function buildFarmPlan(proto: SnapshotProto, amount: number, hold: number): string[] {
  const shape = shapeFor(proto.category);
  const gas = amount >= 150 ? 8 : 4;
  const slots = {
    name: proto.name,
    chain: proto.chains[0] ?? '',
    second: proto.chains[1] ?? '',
    amt: `$${amount}`,
  };
  const open = `${fill(shape.open, slots)} Cost: $${amount} of capital and about $${gas} of gas. Time: 15 minutes to set up.`;
  const second =
    proto.chains.length > 1
      ? fill(REPEAT_ON_SECOND, slots)
      : `${fill(shape.again, slots)} Cost: about $4 of gas and $20 of capital. Time: 10 minutes.`;
  const weekly = `${shape.weekly} Cost: about $2 of gas a week. Time: 10 minutes a week.`;
  const holdStep = `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot. Cost: the $${amount} stays in the position. Time: ${hold} days.`;
  return [STEP_ONE, open, second, weekly, holdStep, STEP_LAST];
}

// ---------------------------------------------------------------- the board

export interface RadarBoard {
  rows: BoardRow[];
  live: LiveRow[];
  compMultiple: number;
  compCount: number;
  earlySize: number;
}

export function rankBoard(doc: SnapshotDoc): RadarBoard {
  const { multiple: comp, count: compCount } = deriveComp(doc.protocols, doc.floor_usd);
  const watch = new Set(doc.watchlist);
  const bySlug = new Map(doc.protocols.map((p) => [p.slug, p]));

  const chosen = new Set<string>();
  for (const slug of doc.watchlist) chosen.add(slug);
  for (const proto of doc.protocols) {
    if (!watch.has(proto.slug) && proto.tvl_usd < doc.floor_usd && isEarlyCandidate(proto)) chosen.add(proto.slug);
  }

  const scored: BoardRow[] = [];
  for (const slug of chosen) {
    const proto = bySlug.get(slug)!;
    const f = scoreFactors(proto, doc.as_of);
    const amount = depositTier(proto.tvl_usd);
    const hold = holdSpan(f.ageDays);
    scored.push({
      rank: 0,
      slug: proto.slug,
      name: proto.name,
      category: proto.category,
      chains: [...proto.chains],
      tvl_usd: proto.tvl_usd,
      change_7d: proto.change_7d,
      mcap_usd: proto.mcap_usd,
      listed_at: proto.listed_at,
      gecko_id: proto.gecko_id,
      symbol: proto.symbol,
      token_status: 'pre-token',
      age_days: f.ageDays,
      implied_value_usd: impliedUsd(proto.tvl_usd, comp, f),
      model: {
        comp_multiple: comp,
        growth_pct: f.growthPct,
        growth_multiplier: round4(f.growth),
        maturity_multiplier: round4(f.maturity),
        breadth_multiplier: round4(f.breadth),
        age_days: f.ageDays,
      },
      farm_steps: buildFarmPlan(proto, amount, hold),
    });
  }
  scored.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
  scored.forEach((row, i) => {
    row.rank = i + 1;
  });

  // The live set: the biggest tokens by market cap, exchanges aside, so the
  // reader can see the market the comp multiple is taken from.
  const live = doc.protocols
    .filter((p) => p.mcap_usd !== null && p.category !== 'CEX')
    .sort((a, b) => b.mcap_usd! - a.mcap_usd!)
    .slice(0, LIVE_SET_SIZE)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: [...p.chains],
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      change_7d: p.change_7d,
      mcap_tvl_ratio: round4(p.mcap_usd! / p.tvl_usd),
    }));

  const earlySize = scored.filter((r) => !watch.has(r.slug)).length;
  return { rows: scored, live, compMultiple: comp, compCount, earlySize };
}

// The slim row the dashboard reads: the board's figures with the model
// flattened, no farm plan (the page rebuilds the plan from the same shapes).
export function toDataRow(row: BoardRow): Record<string, unknown> {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    comp_multiple: row.model.comp_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
  };
}
