import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { cases } from "@/db/schema";
import { eq, desc, and, not } from "drizzle-orm";
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

    let query = db.select().from(cases).$dynamic();

    const clauses = [];
    if (batchId) clauses.push(eq(cases.batchId, batchId));
    else if (strategy === "naive") clauses.push(eq(cases.isNaiveRun, true));
    else if (strategy === "triage") clauses.push(eq(cases.isNaiveRun, false));
    if (cause) clauses.push(eq(cases.cause, cause as any));
    if (fallback === "1") clauses.push(not(eq(cases.llmFallbacks, 0)));

    if (clauses.length === 1) {
      query = query.where(clauses[0]) as any;
    } else if (clauses.length > 1) {
      query = query.where(and(...clauses)) as any;
    }

    const all = (query as any).orderBy(desc(cases.updatedAt)).limit(200).all();
    return NextResponse.json(all);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
