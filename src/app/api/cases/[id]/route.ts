import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { cases, auditLog, campaignSteps } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { migrate } from "@/db/migrate";

migrate();

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const c = db.select().from(cases).where(eq(cases.id, id)).get();
    if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const trail = db.select().from(auditLog)
      .where(eq(auditLog.caseId, id))
      .orderBy(asc(auditLog.ts))
      .all();

    const steps = db.select().from(campaignSteps)
      .where(eq(campaignSteps.caseId, id))
      .orderBy(asc(campaignSteps.day), asc(campaignSteps.stepIndex))
      .all();

    return NextResponse.json({ ...c, auditTrail: trail, campaignSteps: steps });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
