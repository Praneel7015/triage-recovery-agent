import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { cases, auditLog } from "@/db/schema";
import { eq } from "drizzle-orm";
import { migrate } from "@/db/migrate";

migrate();

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const c = db.select().from(cases).where(eq(cases.id, id)).get();
    if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const trail = db.select().from(auditLog)
      .where(eq(auditLog.caseId, id))
      .orderBy(auditLog.ts)
      .all();

    return NextResponse.json({ ...c, auditTrail: trail });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
