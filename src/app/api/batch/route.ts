import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { batchRuns } from "@/db/schema";
import { desc } from "drizzle-orm";
import { migrate } from "@/db/migrate";

migrate();

export async function GET() {
  try {
    const runs = db.select().from(batchRuns).orderBy(desc(batchRuns.createdAt)).limit(20).all();
    return NextResponse.json(runs);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
