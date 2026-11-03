import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { cases, auditLog, campaignSteps } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { migrate } from "@/db/migrate";
import { siblingCaseId } from "@/lib/markRecovered";

migrate();

export const dynamic = "force-dynamic";

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

    const counterpartId = siblingCaseId(id);
    let counterpart: Record<string, unknown> | null = null;
    if (counterpartId) {
      const cc = db.select().from(cases).where(eq(cases.id, counterpartId)).get();
      if (cc) {
        const cSteps = db.select().from(campaignSteps)
          .where(eq(campaignSteps.caseId, counterpartId))
          .orderBy(asc(campaignSteps.day), asc(campaignSteps.stepIndex))
          .all();
        const cTrail = db.select().from(auditLog)
          .where(eq(auditLog.caseId, counterpartId))
          .orderBy(asc(auditLog.ts))
          .all();
        const violations = cTrail.filter((e) => e.event === "compliance_violation").length;
        counterpart = {
          id: cc.id,
          isNaiveRun: cc.isNaiveRun,
          actionTaken: cc.actionTaken,
          status: cc.status,
          stopCode: cc.stopCode,
          cause: cc.cause,
          recoveredAmountPaise: cc.recoveredAmountPaise,
          campaignSteps: cSteps,
          violationCount: violations,
        };
      }
    }

    return NextResponse.json({
      ...c,
      auditTrail: trail,
      campaignSteps: steps,
      counterpartId,
      counterpart,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
