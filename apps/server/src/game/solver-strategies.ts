// Read side of the imported solver strategies (see tools/solver import-pg).
// Lookups are plain indexed reads; safe inside or outside a transaction.

import { and, eq, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../db/connection.js';
import { solverMeta, solverStrategies } from '../db/schema.js';
import type { SolverConfig } from '../engine/solver/betting.js';

type Dbish = Database | Transaction;

export interface SolverBuckets {
  flop: number[];
  turn: number[];
  river: number[];
  ehs_samples: number;
}

export interface SolverMetaBundle {
  config: SolverConfig;
  buckets: SolverBuckets;
  depths: number[];
}

export interface StrategyRow {
  bucket: number;
  tokens: string[];
  strategy: number[];
}

/** Load config/buckets/depths, or null if no strategy set has been imported. */
export async function getSolverMeta(db: Dbish): Promise<SolverMetaBundle | null> {
  const rows = await db.select().from(solverMeta);
  const byKey = new Map(rows.map(r => [r.key, r.value]));
  const config = byKey.get('config') as SolverConfig | undefined;
  const buckets = byKey.get('buckets') as SolverBuckets | undefined;
  const depths = byKey.get('depths') as number[] | undefined;
  if (!config || !buckets || !depths?.length) return null;
  return { config, buckets, depths };
}

/** Trained depth closest to an effective stack in chips. */
export function nearestDepth(depths: number[], effectiveChips: number, blindBig: number): number {
  const target = effectiveChips / blindBig;
  let best = depths[0];
  for (const d of depths) {
    if (Math.abs(d - target) < Math.abs(best - target)) best = d;
  }
  return best;
}

/**
 * Strategy lookup with nearest-bucket fallback: exact (depth, street, seq,
 * bucket) first; otherwise the closest bucket on the same line (adjacent
 * percentile buckets hold near-identical strategies). Null = truly off-book.
 */
export async function lookupStrategy(
  db: Dbish,
  depthBb: number,
  street: number,
  seq: string,
  bucket: number,
): Promise<StrategyRow | null> {
  const exact = await db
    .select({
      bucket: solverStrategies.bucket,
      tokens: solverStrategies.tokens,
      strategy: solverStrategies.strategy,
    })
    .from(solverStrategies)
    .where(and(
      eq(solverStrategies.depthBb, depthBb),
      eq(solverStrategies.street, street),
      eq(solverStrategies.seq, seq),
      eq(solverStrategies.bucket, bucket),
    ))
    .limit(1);
  if (exact.length > 0) return exact[0];

  const nearest = await db
    .select({
      bucket: solverStrategies.bucket,
      tokens: solverStrategies.tokens,
      strategy: solverStrategies.strategy,
    })
    .from(solverStrategies)
    .where(and(
      eq(solverStrategies.depthBb, depthBb),
      eq(solverStrategies.street, street),
      eq(solverStrategies.seq, seq),
    ))
    .orderBy(sql`ABS(${solverStrategies.bucket} - ${bucket})`)
    .limit(1);
  return nearest[0] ?? null;
}
