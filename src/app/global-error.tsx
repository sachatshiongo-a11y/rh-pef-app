"use client";

// Dernier filet de sécurité (erreur dans le layout racine) — doit rendre ses propres <html>/<body>.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="fr">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", margin: 0, padding: 24, textAlign: "center" }}>
        <div style={{ maxWidth: 420 }}>
          <div style={{ fontSize: 40 }}>⚠️</div>
          <h1 style={{ fontSize: 18, margin: "12px 0 4px" }}>Une erreur est survenue</h1>
          <p style={{ color: "#666", fontSize: 14 }}>Rechargez la page. Si le problème persiste, contactez la direction.</p>
          <button onClick={() => reset()} style={{ marginTop: 16, padding: "8px 16px", borderRadius: 8, border: "1px solid #ccc", background: "#f5f5f5", cursor: "pointer" }}>Recharger</button>
          {error?.digest && <p style={{ fontSize: 11, color: "#999", marginTop: 12 }}>Réf. {error.digest}</p>}
        </div>
      </body>
    </html>
  );
}
