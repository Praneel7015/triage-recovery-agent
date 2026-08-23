"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface RazorpayOrderPayload {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  description: string;
  caseId: string;
}

interface Props {
  caseId: string;
  onSuccess: () => void;
}

declare global {
  interface Window {
    Razorpay: new (opts: Record<string, unknown>) => { open(): void };
  }
}

export function RazorpayCheckoutButton({ caseId, onSuccess }: Props) {
  const [status, setStatus] = useState<"idle" | "loading" | "open" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const scriptLoaded = useRef(false);

  // Load checkout.js once.
  useEffect(() => {
    if (scriptLoaded.current || document.getElementById("rzp-checkout-script")) {
      scriptLoaded.current = true;
      return;
    }
    const s = document.createElement("script");
    s.id  = "rzp-checkout-script";
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    document.body.appendChild(s);
    scriptLoaded.current = true;
  }, []);

  const openCheckout = useCallback(async () => {
    setStatus("loading");
    setError(null);

    try {
      const r = await fetch("/api/live/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId }),
      });
      const data: { ok?: boolean; error?: string } & Partial<RazorpayOrderPayload> = await r.json();

      if (!r.ok || !data.ok) {
        setError(data.error ?? "Could not create order");
        setStatus("error");
        return;
      }

      if (!window.Razorpay) {
        setError("Razorpay checkout script not loaded yet. Try again in a moment.");
        setStatus("error");
        return;
      }

      setStatus("open");

      const rzp = new window.Razorpay({
        key: data.keyId,
        order_id: data.orderId,
        amount: data.amount,
        currency: data.currency,
        name: "Triage Recovery",
        description: data.description,
        prefill: {
          name:    data.customerName,
          email:   data.customerEmail,
          contact: data.customerPhone,
        },
        notes: { case_id: data.caseId },
        theme: { color: "#99b17b" },
        modal: {
          ondismiss: () => setStatus("idle"),
        },
        handler: async (response: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          try {
            const confirm = await fetch("/api/live/confirm", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                caseId: data.caseId,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              }),
            });
            const result = await confirm.json();
            if (!result.ok) throw new Error(result.error ?? "Confirmation failed");
            setStatus("success");
            onSuccess();
          } catch (e: any) {
            setError(e.message ?? "Payment confirmed by Razorpay but our server could not verify it.");
            setStatus("error");
          }
        },
      });

      rzp.open();
    } catch (e: any) {
      setError(e.message ?? "Checkout failed");
      setStatus("error");
    }
  }, [caseId, onSuccess]);

  if (status === "success") {
    return (
      <p style={{ fontSize: "0.85rem", color: "var(--ink)", fontWeight: 600 }}>
        Payment received — case marked recovered.
      </p>
    );
  }

  return (
    <div>
      <button
        type="button"
        className="btn btn-primary"
        onClick={openCheckout}
        disabled={status === "loading" || status === "open"}
      >
        {status === "loading" ? "Preparing checkout…" : status === "open" ? "Complete payment in the window" : "Pay now"}
      </button>
      {error && (
        <p style={{ color: "var(--mint)", fontSize: "0.8rem", marginTop: "0.65rem" }}>{error}</p>
      )}
    </div>
  );
}
