"use client";

import { useCallback, useState } from "react";

export function VoicePlayer({ script }: { script: string }) {
  const [speaking, setSpeaking] = useState(false);

  const speak = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(script);
    u.lang = "hi-IN";
    u.rate = 0.92;
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
  }, [script]);

  const stop = useCallback(() => {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }, []);

  return (
    <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.65rem" }}>
      <button type="button" className="btn btn-ghost" onClick={speaking ? stop : speak}>
        {speaking ? "Stop playback" : "Play voice script"}
      </button>
    </div>
  );
}
