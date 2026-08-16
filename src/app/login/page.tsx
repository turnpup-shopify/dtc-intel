"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });

    setBusy(false);
    if (res.ok) {
      router.push("/review");
      router.refresh();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Login failed");
    }
  }

  return (
    <div className="flex items-center justify-center" style={{ minHeight: "70vh" }}>
      <form onSubmit={submit} className="panel p-6 w-80 flex flex-col gap-3">
        <h1 className="text-sm font-semibold">Swipe file</h1>
        <input
          type="password"
          autoFocus
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <p className="text-xs" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="text-sm py-2 rounded font-medium disabled:opacity-50"
          style={{ background: "var(--accent)", color: "#08130e" }}
        >
          {busy ? "Checking…" : "Enter"}
        </button>
      </form>
    </div>
  );
}
