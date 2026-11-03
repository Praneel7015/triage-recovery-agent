import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { batchRuns } from "@/db/schema";
import { desc, isNotNull } from "drizzle-orm";
import { migrate } from "@/db/migrate";
import { lastEvalAsLedgerRuns, overlayIllegalFromCache } from "@/lib/evalCache";

migrate();

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const runs = db.select().from(batchRuns)
      .where(isNotNull(batchRuns.completedAt))
      .orderBy(desc(batchRuns.createdAt))
      .limit(20)
      .all();

    if (runs.length > 0) {
      return NextResponse.json(overlayIllegalFromCache(runs));
    }

    const cached = lastEvalAsLedgerRuns();
    if (cached) return NextResponse.json(cached);

    return NextResponse.json([]);
  } catch (err: any) {
    const cached = lastEvalAsLedgerRuns();
    if (cached) return NextResponse.json(cached);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
