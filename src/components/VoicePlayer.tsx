"use client";

import { useCallback, useEffect, useState } from "react";

export function VoicePlayer({ script }: { script: string }) {
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    setSupported(
      typeof window !== "undefined" &&
      "speechSynthesis" in window &&
      typeof SpeechSynthesisUtterance !== "undefined",
    );
  }, []);

  const speak = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(script);
    u.lang = "hi-IN";
    u.rate = 0.92;
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
  }, [script, supported]);

  const stop = useCallback(() => {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }, []);

  if (supported === null) return null;

  if (!supported) {
    return (
      <p className="dim" style={{ fontSize: "0.75rem", marginTop: "0.65rem" }}>
        Voice playback is not supported in this browser.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.65rem" }}>
      <button type="button" className="btn btn-ghost" onClick={speaking ? stop : speak}>
        {speaking ? "Stop playback" : "Play voice script"}
      </button>
    </div>
  );
}
