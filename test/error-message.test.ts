import { test } from "node:test";
import assert from "node:assert/strict";
import { errorMessage } from "@/lib/errorMessage";

test("reads the description from a Razorpay SDK rejection", () => {
  const rz = { statusCode: 400, error: { code: "BAD_REQUEST_ERROR", description: "The amount must be at least INR 1.00" } };
  assert.equal(errorMessage(rz), "The amount must be at least INR 1.00");
});

test("falls back to the code, then the status", () => {
  assert.equal(errorMessage({ statusCode: 401, error: { code: "BAD_REQUEST_ERROR" } }), "BAD_REQUEST_ERROR");
  assert.equal(errorMessage({ statusCode: 502 }), "HTTP 502");
});

test("reads a normal Error and never returns undefined", () => {
  assert.equal(errorMessage(new Error("boom")), "boom");
  assert.equal(errorMessage(undefined), "Unknown error");
  assert.equal(errorMessage(null), "Unknown error");
});
