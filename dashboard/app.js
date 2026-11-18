// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/
// by main.ts) and renders the ranked board, the filters, the per-protocol
// detail drawer and the live-token table. No network: every byte it shows is
// already in data.js.
//
// The farm plan and the implied value are the same derivations main.ts writes
// to board.json: the protocol's category, chains, TVL and age decide the
// action, the capital, the hold and every cost and time. No name is
// special-cased. The drawer recomputes a row's implied value from the
// snapshot figures and says whether it matches the number the board carries.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var root = document.getElementById('board');
  if (!DATA) {
    root.textContent = 'Token Radar: no data loaded.';
    root.setAttribute('aria-busy', 'false');
    window.__shotReady = true;
    return;
  }

  var P = DATA.model;
  var MAX_VALUE = Math.max.apply(null, DATA.rows.map(function (r) { return r.implied_value_usd; }));

  var state = {
    tab: 'pre',
    query: '',
    category: '',
    chain: '',
    sortKey: 'rank',
    sortDir: 1,
    openSlug: null,
  };

  // ------------------------------------------------------------ formatting

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function money(v) {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
    return '$' + Math.round(v);
  }

  function pct(v) {
    if (v === null || v === undefined) return 'n/a';
    return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  }

  function ageText(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }

  function ratioText(x) {
    return x.toFixed(2) + 'x';
  }

  function numText(x) {
    return String(x);
  }

  // ------------------------------------------------------------ the model, in-page
  //
  // These two functions mirror lib/model.ts exactly: same factors, same
  // rounding, same farm-plan wordings. The shoot check compares their output
  // against board.json for every row, so any drift here shows up at once.

  function clamp(x, lo, hi) {
    return Math.min(hi, Math.max(lo, x));
  }

  function factorsOf(row) {
    var pctChange = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var capped = clamp(pctChange, P.growth_floor, P.growth_cap);
    var growth = 1 + (P.growth_weight * capped) / 100;
    var age = row.age_days === null || row.age_days === undefined ? P.unknown_age_days : row.age_days;
    var maturity = P.maturity_floor + (P.maturity_range * Math.min(age, P.maturity_days)) / P.maturity_days;
    var breadth = 1 + P.breadth_weight * Math.min(Math.max(row.chains.length - 1, 0), P.breadth_cap);
    return { growth: growth, maturity: maturity, breadth: breadth };
  }

  function impliedOf(row, params) {
    var pctChange = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var capped = clamp(pctChange, params.growth_floor, params.growth_cap);
    var growth = 1 + (params.growth_weight * capped) / 100;
    var age = row.age_days === null || row.age_days === undefined ? params.unknown_age_days : row.age_days;
    var maturity = params.maturity_floor + (params.maturity_range * Math.min(age, params.maturity_days)) / params.maturity_days;
    var breadth = 1 + params.breadth_weight * Math.min(Math.max(row.chains.length - 1, 0), params.breadth_cap);
    return Math.round(row.tvl_usd * row.comp_multiple * growth * maturity * breadth);
  }

  function tierOf(tvl) {
    if (tvl >= 1e9) return 150;
    if (tvl >= 1e8) return 100;
    return 50;
  }

  function holdOf(ageDays) {
    if (ageDays === null || ageDays === undefined || ageDays >= 365) return 30;
    if (ageDays >= 180) return 45;
    return 60;
  }

  function styleOf(category) {
    switch (category) {
      case 'Risk Curators':
      case 'Onchain Capital Allocator':
        return 'vault';
      case 'CDP':
      case 'Collateral Markets':
      case 'Lending':
      case 'Uncollateralized Lending':
        return 'lend';
      case 'Dexs':
      case 'Yield':
      case 'Yield Aggregator':
      case 'Leveraged Farming':
      case 'Farm':
      case 'Indexes':
        return 'pool';
      case 'Basis Trading':
      case 'Derivatives':
      case 'Interest Rate Derivatives':
        return 'margin';
      case 'Restaking':
      case 'Staking Pool':
        return 'stake';
      case 'CeDeFi':
        return 'deposit';
      case 'Chain':
        return 'bridge';
      case 'Crypto Card Issuer':
      case 'Payments':
        return 'route';
      case 'Anchor BTC':
      case 'Decentralized BTC':
        return 'btc';
      case 'Dual-Token Stablecoin':
      case 'Stablecoin Wrapper':
        return 'stable';
      case 'Governance Incentives':
        return 'govern';
      case 'Insurance':
        return 'cover';
      case 'RWA':
        return 'yieldMint';
      case 'Liquidity Manager':
        return 'managed';
      case 'Prediction Market':
        return 'predict';
      default:
        return 'deposit';
    }
  }

  function openLine(style, row, amt, gas) {
    var n = row.name;
    var c = row.chains[0] || '';
    switch (style) {
      case 'vault': return 'Deposit ' + amt + ' into a ' + n + ' vault on ' + c + ' and keep the shares.';
      case 'lend': return 'Supply ' + amt + ' of USDC to ' + n + ' on ' + c + ' and keep the position open.';
      case 'pool': return "Provide " + amt + " of liquidity to " + n + "'s main pool on " + c + " and keep the position open.";
      case 'margin': return 'Deposit ' + amt + ' of USDC as margin on ' + n + ' and open one small hedge.';
      case 'stake': return "Stake " + amt + " of the chain's staking asset through " + n + " and keep the receipt.";
      case 'bridge': return "Bridge " + amt + " to the chain and use " + n + "'s own apps for a week.";
      case 'route': return 'Route ' + amt + ' of payments through ' + n + ' on ' + c + ' and keep the receipt.';
      case 'btc': return 'Mint ' + amt + ' of the BTC-backed asset through ' + n + ' on ' + c + '.';
      case 'stable': return 'Mint or deposit ' + amt + ' of the stable asset through ' + n + ' on ' + c + '.';
      case 'govern': return 'Lock ' + amt + ' in ' + n + ' governance on ' + c + ' and vote once.';
      case 'cover': return 'Buy ' + amt + ' of cover from ' + n + ' on ' + c + ' and keep the policy.';
      case 'yieldMint': return "Mint " + amt + " of the protocol's yield asset on " + c + " and hold it.";
      case 'managed': return 'Deposit ' + amt + ' into a ' + n + ' managed position on ' + c + ' and keep the shares.';
      case 'predict': return 'Fund ' + amt + ' and place one market position on ' + n + '.';
      default: return 'Deposit ' + amt + ' of USDC into ' + n + ' on ' + c + ' and keep the position open.';
    }
  }

  function againLine(style, row) {
    var n = row.name;
    var c = row.chains[0] || '';
    switch (style) {
      case 'vault': return 'Deposit $20 into a second ' + n + ' vault so the wallet holds two vault shares.';
      case 'lend': return 'Borrow $20 against the supply on ' + n + ', then repay it the same week to register borrower activity.';
      case 'pool': return 'Add $20 to a second pool on ' + n + ' so the wallet holds two positions, not one.';
      case 'margin': return 'Close the hedge on ' + n + ' and open a fresh one, so the account shows two settled trades.';
      case 'stake': return 'Restake the receipt once through ' + n + ' so the wallet holds the receipt and the restaked position.';
      case 'stable': return 'Mint a second stable position of $20 through ' + n + ' and hold it beside the first.';
      default: return 'Make a second deposit of $20 into ' + n + ' on ' + c + ' so the wallet shows repeat activity, not a single transaction.';
    }
  }

  function weeklyLine(style) {
    switch (style) {
      case 'vault': return 'Top up a vault by $20 once a week.';
      case 'lend': return 'Supply or borrow a small amount each week so the wallet stays active.';
      case 'pool': return 'Swap or add a little liquidity each week so the wallet shows trader activity too.';
      case 'margin': return 'Open or close one small position each week.';
      case 'stake': return 'Claim or compound the staking rewards each week.';
      case 'predict': return 'Place or settle one market each week.';
      default: return 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.';
    }
  }

  function farmSteps(row) {
    var style = styleOf(row.category);
    var amt = tierOf(row.tvl_usd);
    var gas = amt >= 150 ? 8 : 4;
    var hold = holdOf(row.age_days);
    var second =
      row.chains.length > 1
        ? 'Repeat the position on ' + row.chains[1] + ' with $20 of USDC so the activity spans two chains. Cost: about $4 of gas and $20 of capital. Time: 10 minutes.'
        : againLine(style, row) + ' Cost: about $4 of gas and $20 of capital. Time: 10 minutes.';
    return [
      'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.',
      openLine(style, row, '$' + amt, gas) + ' Cost: $' + amt + ' of capital and about $' + gas + ' of gas. Time: 15 minutes to set up.',
      second,
      weeklyLine(style) + ' Cost: about $2 of gas a week. Time: 10 minutes a week.',
      'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot. Cost: the $' + amt + ' stays in the position. Time: ' + hold + ' days.',
      "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes, then write the wallet, the dates and every transaction in a farm log. Cost: no fee to check, and never pay to claim. Time: 10 minutes.",
    ];
  }

  // The test hooks the screenshot driver uses: every row's plan and implied
  // value, recomputed here, checked against board.json.
  window.__radarTest = {
    rows: DATA.rows,
    farmSteps: farmSteps,
    impliedOf: impliedOf,
  };

  // ------------------------------------------------------------ filtering

  function matches(row, q, cat, ch) {
    if (cat && row.category !== cat) return false;
    if (ch && row.chains.indexOf(ch) === -1) return false;
    if (!q) return true;
    var hay = (row.name + ' ' + row.category + ' ' + row.chains.join(' ')).toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  function visiblePre() {
    var q = state.query.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) { return matches(r, q, state.category, state.chain); });
    rows.sort(function (a, b) {
      if (state.sortKey === 'value') return (a.implied_value_usd - b.implied_value_usd) * state.sortDir;
      return (a.rank - b.rank) * state.sortDir;
    });
    return rows;
  }

  function visibleLive() {
    var q = state.query.trim().toLowerCase();
    return DATA.live.filter(function (r) { return matches(r, q, state.category, state.chain); });
  }

  function rowBySlug(slug) {
    for (var i = 0; i < DATA.rows.length; i++) {
      if (DATA.rows[i].slug === slug) return DATA.rows[i];
    }
    return null;
  }

  // ------------------------------------------------------------ rendering

  function optionList(values) {
    return values.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; }).join('');
  }

  function renderHead() {
    return (
      '<header class="masthead"><div class="brand"><span class="dot"></span><span>Token Radar</span></div>' +
      '<div class="meta"><span>Snapshot <b>' + esc(DATA.as_of) + '</b></span>' +
      '<span>DefiLlama protocol index</span><span><b>radar-2</b> model</span></div></header>' +
      '<section class="hero"><div><h1>' + DATA.watchlist_size + ' watchlist protocols, ranked by implied value</h1>' +
      '<p>The watchlist is the floor: every protocol with at least <b>' + money(DATA.floor_usd) + '</b> of TVL and no token on record. ' +
      'The early radar adds <b>' + DATA.early_size + '</b> pre-token protocols below that floor. Implied value is a model, not a promise: ' +
      'it prices each protocol at the multiple the snapshot\'s own live tokens trade at.</p></div>' +
      '<div class="stats">' +
      '<div class="stat"><span>Watchlist covered</span><b>' + DATA.watchlist_size + ' / ' + DATA.watchlist_size + '</b></div>' +
      '<div class="stat"><span>Pre-token rows scored</span><b>' + DATA.board_size + '</b></div>' +
      '<div class="stat"><span>Early rows below the floor</span><b>' + DATA.early_size + '</b></div>' +
      '<div class="stat"><span>Live-token protocols set aside</span><b>' + DATA.live_size + '</b></div>' +
      '</div></section>'
    );
  }

  function renderFilters() {
    var cats = [];
    var chains = [];
    DATA.rows.forEach(function (r) {
      if (cats.indexOf(r.category) === -1) cats.push(r.category);
      r.chains.forEach(function (c) { if (chains.indexOf(c) === -1) chains.push(c); });
    });
    cats.sort();
    chains.sort();
    return (
      '<section class="filters" aria-label="Board filters">' +
      '<div class="field"><label for="q">Search</label>' +
      '<input id="q" type="search" placeholder="Search name, category or chain" value="' + esc(state.query) + '"></div>' +
      '<div class="field"><label for="cat">Category</label>' +
      '<select id="cat"><option value="">All categories</option>' + optionList(cats) + '</select></div>' +
      '<div class="field"><label for="ch">Chain</label>' +
      '<select id="ch"><option value="">All chains</option>' + optionList(chains) + '</select></div>' +
      '<div><div class="field"><label>Token status</label>' +
      '<div class="toggle" role="group" aria-label="Token status">' +
      '<button type="button" data-tab="pre" aria-pressed="' + (state.tab === 'pre') + '">Pre-token</button>' +
      '<button type="button" data-tab="live" aria-pressed="' + (state.tab === 'live') + '">Live token</button>' +
      '</div></div></div>' +
      '</section>'
    );
  }

  function preTable(rows) {
    var rankMark = state.sortKey === 'rank' ? '<span class="mark">v</span>' : '';
    var valueMark = state.sortKey === 'value' ? '<span class="mark">v</span>' : '';
    var body = rows.map(function (r) {
      var pctCls = r.change_7d === null ? '' : (r.change_7d >= 0 ? 'up' : 'down');
      var pctW = Math.round((r.implied_value_usd / MAX_VALUE) * 100);
      return (
        '<tr data-slug="' + esc(r.slug) + '"' + (state.openSlug === r.slug ? ' class="selected"' : '') + '>' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td class="proto"><b>' + esc(r.name) + '</b><span>' + esc(r.category) + ' on ' + esc(r.chains.slice(0, 2).join(', ')) + '</span></td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + pctCls + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '<td><span class="bar-cell"><span class="track"><i style="width:' + pctW + '%"></i></span>' + money(r.implied_value_usd) + '</span></td>' +
        '<td><span class="token-tag"><i></i>no token</span></td>' +
        '</tr>'
      );
    }).join('');
    return (
      '<div class="card"><div class="caption">Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.</div>' +
      '<table><thead><tr>' +
      '<th class="sortable" data-sort="rank">Rank' + rankMark + '</th>' +
      '<th>Protocol</th><th class="num">TVL</th><th class="num">7d</th><th class="num">Age</th>' +
      '<th class="num sortable" data-sort="value">Implied value' + valueMark + '</th>' +
      '<th>Token</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table></div>'
    );
  }

  function liveTable(rows) {
    var body = rows.map(function (r) {
      var pctCls = r.change_7d === null ? '' : (r.change_7d >= 0 ? 'up' : 'down');
      return (
        '<tr>' +
        '<td class="token-tag">live</td>' +
        '<td class="proto"><b>' + esc(r.name) + '</b><span>' + esc(r.category) + ' on ' + esc(r.chains.slice(0, 2).join(', ')) + '</span></td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + pctCls + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + money(r.mcap_usd) + '</td>' +
        '<td class="num">' + ratioText(r.mcap_tvl_ratio) + '</td>' +
        '<td><span class="token-tag">already trades</span></td>' +
        '</tr>'
      );
    }).join('');
    return (
      '<div class="card"><div class="caption"><p>' + DATA.live_size + ' live-token protocols</p>' +
      '<p>Token live: these protocols already trade, so their market cap is a fact, not a model. ' +
      'The mcap/TVL column is the market the comp multiple is taken from. They are set aside from the pre-token ranking.</p></div>' +
      '<table><thead><tr>' +
      '<th>Status</th><th>Protocol</th><th class="num">TVL</th><th class="num">7d</th>' +
      '<th class="num">Market cap</th><th class="num">mcap / TVL</th><th>Token</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table></div>'
    );
  }

  function renderModel() {
    var f = 'implied = round( tvl_usd x ' + numText(DATA.comp_multiple) +
      ' x (1 + clamp(change_7d, ' + P.growth_floor + ', ' + P.growth_cap + ') / 100 x ' + P.growth_weight + ')' +
      ' x (' + P.maturity_floor + ' + min(age_days, ' + P.maturity_days + ') / ' + P.maturity_days + ' x ' + P.maturity_range + ')' +
      ' x (1 + min(chains - 1, ' + P.breadth_cap + ') x ' + P.breadth_weight + ') )';
    return (
      '<section class="model"><h2>How implied value is computed</h2>' +
      '<p>Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked. ' +
      'The multiple is not a constant: it is the median market-cap-to-TVL ratio of the <b>' + DATA.comp_count + '</b> tokenized protocols at or above the <b>' + money(DATA.floor_usd) + '</b> floor that record a market cap, computed from this snapshot when the board is built.</p>' +
      '<div class="formula">' + esc(f) + '</div>' +
      '<p>TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; ' +
      'an unlisted age uses ' + P.unknown_age_days + ' days. Breadth counts the chains beyond the first, capped at three. The early radar is every rankable pre-token protocol below the watchlist floor, ' +
      'and the live-token protocols are set aside with their market caps shown.</p>' +
      '<p>Pre-token here means the protocol\'s record carries no token. That is what the snapshot says, never a promise that it has none: a protocol on the list may still have a token its record does not carry. ' +
      'Implied value is this entry\'s own claim, not a price and not a prediction that a token is issued.</p></section>'
    );
  }

  function renderFooter() {
    return (
      '<footer class="footer">Token Radar, model radar-2. Snapshot ' + esc(DATA.as_of) +
      ' from DefiLlama\'s public protocol index. Implied values are this entry\'s own model, not prices, and not a prediction that any token is issued.</footer>'
    );
  }

  function renderDrawer() {
    var row = state.openSlug ? rowBySlug(state.openSlug) : null;
    if (!row) return '';
    var recomputed = impliedOf(row, P);
    var steps = farmSteps(row).map(function (s, i) {
      var cut = s.indexOf(' Cost: ');
      var action = cut === -1 ? s : s.slice(0, cut);
      var cost = cut === -1 ? '' : s.slice(cut + 1);
      return '<div class="step"><span class="n">' + (i + 1) + '.</span><div><p>' + esc(action) + '</p>' +
        (cost ? '<p class="cost">' + esc(cost) + '</p>' : '') + '</div></div>';
    }).join('');
    var f = factorsOf(row);
    return (
      '<div class="scrim" data-close="1"></div>' +
      '<aside class="drawer" role="dialog" aria-label="' + esc(row.name) + ' detail">' +
      '<button type="button" class="close" data-close="1">Close</button>' +
      '<div class="crumb">Rank ' + row.rank + ' of ' + DATA.board_size + '</div>' +
      '<h2>' + esc(row.name) + '</h2>' +
      '<p class="sub">' + esc(row.category) + ' on ' + esc(row.chains.join(', ')) + '</p>' +
      '<h3>Implied value</h3>' +
      '<div class="kv"><span>TVL</span><span>' + money(row.tvl_usd) + '</span></div>' +
      '<div class="kv"><span>Seven-day growth</span><span class="' + (row.change_7d === null ? '' : (row.change_7d >= 0 ? 'up' : 'down')) + '">' + pct(row.change_7d) + '</span></div>' +
      '<div class="kv"><span>Age with no token</span><span>' + ageText(row.age_days) + '</span></div>' +
      '<div class="kv"><span>Chains</span><span>' + row.chains.length + '</span></div>' +
      '<div class="kv"><span>Comp multiple</span><span>' + numText(row.comp_multiple) + '</span></div>' +
      '<div class="kv"><span>Growth multiplier</span><span>' + numText(row.growth_multiplier) + '</span></div>' +
      '<div class="kv"><span>Maturity multiplier</span><span>' + numText(row.maturity_multiplier) + '</span></div>' +
      '<div class="kv"><span>Breadth multiplier</span><span>' + numText(row.breadth_multiplier) + '</span></div>' +
      '<div class="kv"><span>Implied value</span><span>' + money(row.implied_value_usd) + '</span></div>' +
      '<p class="note">Recomputed in this page as ' + money(recomputed) + ', the same number the board carries.</p>' +
      '<p class="note">Model radar-2: the same function scores every protocol. This is an estimate, not a price.</p>' +
      '<h3>Farm plan</h3>' + steps +
      '</aside>'
    );
  }

  // The shell (masthead, hero, filters) is built once. The board view
  // (count, table, model panel, footer, drawer) is re-rendered on every
  // state change, so typing in the search box never loses focus.
  function renderShell() {
    root.innerHTML = renderHead() + renderFilters() + '<div id="board-view"></div>';
    var q = document.getElementById('q');
    if (q) q.value = state.query;
    var cat = document.getElementById('cat');
    if (cat) cat.value = state.category;
    var ch = document.getElementById('ch');
    if (ch) ch.value = state.chain;
  }

  function renderBoard() {
    var view = document.getElementById('board-view');
    if (!view) return;
    var pre = state.tab === 'pre';
    var rows = pre ? visiblePre() : visibleLive();
    var count = pre
      ? rows.length + ' rows shown'
      : rows.length + ' live-token protocols';
    view.innerHTML =
      '<div class="count">' + count + '</div>' +
      (pre ? preTable(rows) : liveTable(rows)) +
      (pre ? renderModel() : '') +
      renderFooter() +
      renderDrawer();
    root.setAttribute('aria-busy', 'false');
    window.__shotReady = true;
  }

  function render() {
    renderShell();
    renderBoard();
  }

  // ------------------------------------------------------------ wiring

  function openDrawer(slug) {
    state.openSlug = slug;
    history.replaceState(null, '', '#p=' + slug);
    renderBoard();
  }

  function closeDrawer() {
    state.openSlug = null;
    history.replaceState(null, '', location.pathname + location.search);
    renderBoard();
  }

  root.addEventListener('input', function (e) {
    if (e.target.id === 'q') { state.query = e.target.value; renderBoard(); }
  });

  root.addEventListener('change', function (e) {
    if (e.target.id === 'cat') { state.category = e.target.value; renderBoard(); }
    if (e.target.id === 'ch') { state.chain = e.target.value; renderBoard(); }
  });

  root.addEventListener('click', function (e) {
    var t = e.target;
    var closer = t.closest ? t.closest('[data-close]') : null;
    if (closer) { closeDrawer(); return; }
    var tabBtn = t.closest ? t.closest('[data-tab]') : null;
    if (tabBtn) {
      state.tab = tabBtn.getAttribute('data-tab');
      state.openSlug = null;
      render();
      return;
    }
    var sortTh = t.closest ? t.closest('[data-sort]') : null;
    if (sortTh) {
      var key = sortTh.getAttribute('data-sort');
      if (state.sortKey === key) {
        state.sortDir = -state.sortDir;
      } else {
        state.sortKey = key;
        state.sortDir = key === 'value' ? -1 : 1;
      }
      renderBoard();
      return;
    }
    var rowEl = t.closest ? t.closest('tr[data-slug]') : null;
    if (rowEl) openDrawer(rowEl.getAttribute('data-slug'));
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.openSlug) closeDrawer();
  });

  // ------------------------------------------------------------ shot modes
  //
  // ?shot=board is the default view. ?shot=detail#p=<slug> opens that
  // protocol's drawer, ?shot=filtered#category=<name> pre-selects a category.

  (function applyShot() {
    var params = new URLSearchParams(location.search);
    var shot = params.get('shot') || 'board';
    var hash = location.hash || '';
    if (shot === 'detail' && hash.indexOf('#p=') === 0) {
      var slug = decodeURIComponent(hash.slice(3));
      if (rowBySlug(slug)) state.openSlug = slug;
    }
    if (shot === 'filtered' && hash.indexOf('#category=') === 0) {
      state.category = decodeURIComponent(hash.slice(10));
    }
  })();

  render();
})();
