"use client";

import { useEffect, useState } from "react";

interface Health {
  ok: boolean;
  env?: Record<string, string>;
  database?: string;
  companies?: number;
  nextStep?: string;
}

/**
 * Shown whenever a screen's data fetch fails. The failure is almost always
 * setup — env vars missing, schema not applied, nothing seeded — so this pulls
 * /api/health and prints the specific next step rather than a spinner.
 */
export default function ErrorPanel({ error, onRetry }: { error: string; onRetry?: () => void }) {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => undefined);
  }, []);

  return (
    <div className="panel p-4 m-4 max-w-2xl">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium" style={{ color: "var(--danger)" }}>
          Couldn&apos;t load
        </span>
        {onRetry && (
          <button
            onClick={onRetry}
            className="text-xs px-2 py-1 rounded ml-auto"
            style={{ background: "var(--panel-2)" }}
          >
            Retry
          </button>
        )}
      </div>

      <p className="text-sm mt-2 font-mono break-words">{error}</p>

      {health?.nextStep && (
        <div className="mt-4 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
          <p className="muted text-[10px] uppercase tracking-wide mb-1">Next step</p>
          <p className="text-sm" style={{ color: "var(--accent)" }}>
            {health.nextStep}
          </p>
        </div>
      )}

      {health?.env && (
        <div className="mt-4 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
          <p className="muted text-[10px] uppercase tracking-wide mb-1.5">Configuration</p>
          <table className="text-xs w-full">
            <tbody>
              {Object.entries(health.env).map(([key, value]) => (
                <tr key={key}>
                  <td className="muted pr-4 py-0.5 align-top">{key}</td>
                  <td
                    className="py-0.5 font-mono"
                    style={{
                      color: value.startsWith("missing") ? "var(--danger)" : "var(--muted)",
                    }}
                  >
                    {value}
                  </td>
                </tr>
              ))}
              {health.database && (
                <tr>
                  <td className="muted pr-4 py-0.5 align-top">database</td>
                  <td
                    className="py-0.5 font-mono"
                    style={{
                      color: health.database === "ok" ? "var(--muted)" : "var(--danger)",
                    }}
                  >
                    {health.database}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
