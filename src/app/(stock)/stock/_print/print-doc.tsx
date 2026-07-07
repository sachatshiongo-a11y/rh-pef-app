import { ImprimerBtn } from "./imprimer-btn";

// Document imprimable réutilisable (logo Pâtes en Folie + tableau), pour l'export PDF des onglets
// via l'impression du navigateur. Léger — évite react-pdf serveur (OOM Render sur gros volumes).
export function PrintDoc({
  titre,
  sousTitre,
  entete,
  lignes,
  aligneDroite = [],
}: {
  titre: string;
  sousTitre?: string;
  entete: string[];
  lignes: (string | number)[][];
  aligneDroite?: number[]; // index de colonnes alignées à droite
}) {
  const cellStyle = (i: number) => (aligneDroite.includes(i) ? { textAlign: "right" as const } : undefined);
  return (
    <div>
      <style>{`
        @media print { aside, .no-print { display: none !important; } main { overflow: visible !important; } @page { margin: 12mm; } }
        .doc table { width: 100%; border-collapse: collapse; }
        .doc th, .doc td { border: 0.5pt solid #cbb89a; padding: 3px 7px; font-size: 11px; text-align: left; }
        .doc th { background: #f5ecd9; font-weight: 700; }
      `}</style>

      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{titre}</h1>
        <ImprimerBtn />
      </div>

      <div className="doc space-y-4">
        <div className="flex items-center gap-3 border-b pb-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-pates-en-folie.png" alt="Pâtes en Folie" style={{ height: 44, width: "auto" }} />
          <div>
            <h2 className="text-lg font-semibold">{titre}</h2>
            <p className="text-sm text-muted-foreground">TOLYA SARL{sousTitre ? ` · ${sousTitre}` : ""} · {lignes.length} ligne(s)</p>
          </div>
        </div>
        <table>
          <thead>
            <tr>{entete.map((h, i) => <th key={i} style={cellStyle(i)}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {lignes.map((l, r) => (
              <tr key={r}>{l.map((c, i) => <td key={i} style={cellStyle(i)}>{c === "" || c === null || c === undefined ? "" : c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
