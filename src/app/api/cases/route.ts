import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { cases, type FailureCause } from "@/db/schema";
import { eq, desc, and, not, type SQL } from "drizzle-orm";
import { migrate } from "@/db/migrate";

migrate();

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url  = new URL(request.url);
    const strategy = url.searchParams.get("strategy"); // "triage" | "naive"
    const batchId  = url.searchParams.get("batchId");
    const cause    = url.searchParams.get("cause");
    const fallback = url.searchParams.get("fallback");

    const clauses: SQL[] = [];
    if (batchId) clauses.push(eq(cases.batchId, batchId));
    else if (strategy === "naive") clauses.push(eq(cases.isNaiveRun, true));
    else if (strategy === "triage") clauses.push(eq(cases.isNaiveRun, false));
    if (cause) clauses.push(eq(cases.cause, cause as FailureCause));
    if (fallback === "1") clauses.push(not(eq(cases.llmFallbacks, 0)));

    const all = db.select().from(cases)
      .where(and(...clauses))
      .orderBy(desc(cases.updatedAt)).limit(200).all();
    return NextResponse.json(all);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
