// Token Radar's entry program (Node 22, standard library only).
//
// It reads the sealed snapshot, scores every pre-token protocol with the
// radar-2 model, and writes everything the entry hands in:
//   /output/board.json    the ranked board, 178 rows with farm plans
//   /output/data.js       the same figures slimmed down for the dashboard
//   /output/dashboard/    the page, copied from this repository
//   /output/screenshots/  the three renders, copied from this repository
//   /output/dossier.json  the judge's dossier, via the vendored library
//
// The run is deterministic: the same snapshot in gives the same bytes out,
// so the grader's two runs agree. Nothing here reads the clock, the network
// or any randomness.
//
// In the grader the snapshot is /input/snapshot.json and the output is
// /output. Locally, pass --input <snapshot> and set MAKEFUN_OUTPUT_DIR:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MODEL_VERSION,
  PARAMS,
  rankBoard,
  toDataRow,
  type SnapshotDoc,
} from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_INPUT = '/input/snapshot.json';
const DEFAULT_OUTPUT = '/output';

function flagValue(argv: string[], name: string): string | null {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name && i + 1 < argv.length) return argv[i + 1]!;
    if (argv[i]!.startsWith(`${name}=`)) return argv[i]!.slice(name.length + 1);
  }
  return null;
}

function resolveInput(argv: string[]): string {
  const flag = flagValue(argv, '--input');
  if (flag) return flag;
  const env = process.env.MAKEFUN_INPUT_DIR;
  if (env) return existsSync(env) && statSync(env).isDirectory() ? join(env, 'snapshot.json') : env;
  return DEFAULT_INPUT;
}

function resolveOutput(): string {
  return process.env.MAKEFUN_OUTPUT_DIR ?? DEFAULT_OUTPUT;
}

function readSnapshot(path: string): SnapshotDoc {
  const doc = JSON.parse(readFileSync(path, 'utf8')) as SnapshotDoc;
  if (!Array.isArray(doc.protocols) || !Array.isArray(doc.watchlist)) {
    throw new Error(`snapshot at ${path} is not a token-radar snapshot`);
  }
  return doc;
}

function main(): void {
  const inputPath = resolveInput(process.argv.slice(2));
  const outDir = resolveOutput();
  const doc = readSnapshot(inputPath);
  const board = rankBoard(doc);

  mkdirSync(outDir, { recursive: true });
  mkdirSync(join(outDir, 'dashboard'), { recursive: true });
  mkdirSync(join(outDir, 'screenshots'), { recursive: true });

  const boardPath = join(outDir, 'board.json');
  writeFileSync(boardPath, `${JSON.stringify({ rows: board.rows })}\n`, 'utf8');

  const payload = {
    as_of: doc.as_of,
    source: doc.source,
    floor_usd: doc.floor_usd,
    model: PARAMS,
    model_version: MODEL_VERSION,
    comp_multiple: board.compMultiple,
    comp_count: board.compCount,
    watchlist_size: doc.watchlist.length,
    board_size: board.rows.length,
    early_size: board.earlySize,
    live_size: board.live.length,
    rows: board.rows.map(toDataRow),
    live: board.live,
  };
  const dataPath = join(outDir, 'data.js');
  writeFileSync(dataPath, `window.RADAR=${JSON.stringify(payload)};\n`, 'utf8');

  cpSync(join(REPO_ROOT, 'dashboard'), join(outDir, 'dashboard'), { recursive: true });
  cpSync(join(REPO_ROOT, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });

  const dossierPath = join(outDir, 'dossier.json');
  writeFileSync(dossierPath, buildDossier(outDir, { text_max_bytes: 65536 }));

  const dashCount = board.rows.length;
  console.log(
    `token radar: ${doc.protocols.length} protocols, ${doc.watchlist.length} on the watchlist, ${dashCount} rows scored (${board.earlySize} early, ${board.live.length} live set aside)`,
  );
  console.log(
    `token radar: comp multiple ${board.compMultiple} from ${board.compCount} tokenized protocols at or above the $${doc.floor_usd.toLocaleString('en-US')} floor`,
  );
  console.log(
    `token radar: wrote ${boardPath}, ${dataPath}, ${join(outDir, 'dashboard')} (3 files), ${join(outDir, 'screenshots')} (3 images) and ${dossierPath}`,
  );
}

main();
