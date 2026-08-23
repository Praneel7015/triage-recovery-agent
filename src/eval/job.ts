import { runBatch } from "@/eval/persist";

export interface EvalJobStatus {
  running: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  result: { triageRunId: string; naiveRunId: string } | null;
}

const globalForEval = globalThis as typeof globalThis & {
  __triageEvalJob?: EvalJobStatus;
};

function job(): EvalJobStatus {
  if (!globalForEval.__triageEvalJob) {
    globalForEval.__triageEvalJob = {
      running: false,
      startedAt: null,
      finishedAt: null,
      error: null,
      result: null,
    };
  }
  return globalForEval.__triageEvalJob;
}

export function getEvalStatus(): EvalJobStatus {
  return { ...job() };
}

export function startEvalJob(): { started: boolean; alreadyRunning?: boolean } {
  const state = job();
  if (state.running) return { started: false, alreadyRunning: true };

  state.running = true;
  state.startedAt = Math.floor(Date.now() / 1000);
  state.finishedAt = null;
  state.error = null;
  state.result = null;

  void runBatch()
    .then((result) => {
      state.result = result;
    })
    .catch((err: Error) => {
      state.error = err.message ?? "Eval failed";
    })
    .finally(() => {
      state.running = false;
      state.finishedAt = Math.floor(Date.now() / 1000);
    });

  return { started: true };
}
