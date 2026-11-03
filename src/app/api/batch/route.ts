import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { batchRuns } from "@/db/schema";
import { desc, isNotNull } from "drizzle-orm";
import { migrate } from "@/db/migrate";
import { lastEvalAsLedgerRuns, markUntrackedIllegal } from "@/lib/evalCache";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Inside the try, so a migration error still reaches the cache fallback.
    migrate();
    const runs = db.select().from(batchRuns)
      .where(isNotNull(batchRuns.completedAt))
      .orderBy(desc(batchRuns.createdAt))
      .limit(20)
      .all();

    if (runs.length > 0) {
      return NextResponse.json(markUntrackedIllegal(runs));
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
