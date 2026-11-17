# Token Radar

[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/vstarrq2/vstarrq2-token--radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/vstarrq2/vstarrq2-token--radar/reward.svg)](https://make.fun/bounty/token-radar-01)

A token launch radar for the make.fun bounty
[Build the best token launch radar](https://make.fun/bounty/token-radar-01).

It reads a sealed snapshot of every protocol DefiLlama tracks, ranks the
protocols that record no token by an implied value, and shows a reader how to
farm each one. The implied value is priced at the multiple the snapshot's own
live tokens trade at: the median market-cap-to-TVL ratio of the tokenized
protocols at or above the $50M watchlist floor. No protocol name is
special-cased; one function scores every row.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

`main.ts` (Node 22, standard library only) writes `board.json`, `data.js`,
`dashboard/`, `screenshots/` and `dossier.json` into the output directory.
The dashboard is a static page with no network: open
`out/dashboard/index.html` in a browser.
