import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { cases, auditLog } from "@/db/schema";
import { eq, desc, and, not, like } from "drizzle-orm";
import { migrate } from "@/db/migrate";

migrate();

export async function GET(request: Request) {
  try {
    const url  = new URL(request.url);
    const strategy = url.searchParams.get("strategy"); // "triage" | "naive"
    const batchId  = url.searchParams.get("batchId");

    let query = db.select().from(cases).$dynamic();

    if (batchId) {
      query = query.where(eq(cases.batchId, batchId)) as any;
    } else if (strategy === "naive") {
      query = query.where(eq(cases.isNaiveRun, true)) as any;
    } else if (strategy === "triage") {
      query = query.where(eq(cases.isNaiveRun, false)) as any;
    }

    const all = (query as any).orderBy(desc(cases.updatedAt)).limit(200).all();
    return NextResponse.json(all);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
