import { NextResponse } from "next/server";
import { getEvalStatus, startEvalJob } from "@/eval/job";

export async function GET() {
  return NextResponse.json(getEvalStatus());
}

export async function POST() {
  try {
    const result = startEvalJob();
    if (result.alreadyRunning) {
      return NextResponse.json({ ok: true, ...getEvalStatus(), message: "Eval already running" });
    }
    return NextResponse.json({
      ok: true,
      ...getEvalStatus(),
      message: "Batch eval started. This takes ~10 minutes for 168 cases with LLM enabled.",
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
