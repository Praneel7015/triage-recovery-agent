import { NextResponse } from "next/server";
import { runBatch } from "@/eval/persist";

export async function POST() {
  try {
    const result = await runBatch();
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
