import Link from "next/link";
import { Icone } from "@/components/icones";
import { formaterNombre } from "@/lib/montant";
import { GROUPES_ESPACE } from "./navigation";

// VUE de l'Accueil de l'espace salarié — séparée de la page (qui lit la base) pour être rendue telle
// quelle par un test, comme « Mes contrats ». Téléphone d'abord : ce qui attend un geste en tête,
// puis le prochain service, puis le solde, puis tout l'espace rangé comme le menu.

export type ProchainService = { nom: string; heureDebut: string | null; heureFin: string | null; date: Date; aujourdhui: boolean };

export function VueAccueil({
  prenom,
  contratsASigner,
  echangesARepondre,
  congesEnAttente,
  soldeConge,
  prochainService: p,
}: {
  prenom: string;
  contratsASigner: number;
  echangesARepondre: number;
  congesEnAttente: number;
  soldeConge: number;
  prochainService: ProchainService | null;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Bonjour {prenom} 👋</h1>
        <p className="text-sm text-muted-foreground">Voici votre espace personnel.</p>
      </div>

      {/* À faire : ce qui attend un geste du salarié, en tête de page. */}
      {(contratsASigner > 0 || echangesARepondre > 0) && (
        <div className="space-y-2">
          {contratsASigner > 0 && (
            <Alerte
              href="/espace/contrats"
              icone="mallette"
              titre={`${contratsASigner} contrat${contratsASigner > 1 ? "s" : ""} à signer`}
              texte="Lisez-le, puis signez-le dans « Mes contrats »."
            />
          )}
          {echangesARepondre > 0 && (
            <Alerte
              href="/espace/echanges"
              icone="echanges"
              titre={`${echangesARepondre} proposition${echangesARepondre > 1 ? "s" : ""} d'échange à accepter ou refuser`}
              texte="Un collègue vous propose d'échanger un shift."
            />
          )}
        </div>
      )}

      {/* Prochain service : l'information du jour, en pleine largeur. */}
      <Link href="/espace/planning" className="block rounded-2xl border bg-card p-4 transition hover:border-primary">
        <div className="mb-1 flex items-center gap-2 text-sm text-muted-foreground">
          <Icone nom="calendrier" className="shrink-0" /> {p?.aujourdhui ? "Aujourd'hui" : "Prochain service"}
        </div>
        {p ? (
          <>
            <p className="text-2xl font-semibold tabular-nums">
              {p.heureDebut}
              {p.heureFin ? ` – ${p.heureFin}` : ""}
            </p>
            <p className="text-sm text-muted-foreground">
              {p.nom} ·{" "}
              {p.date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}
            </p>
          </>
        ) : (
          <>
            <p className="text-2xl font-semibold">—</p>
            <p className="text-sm text-muted-foreground">Aucun service publié pour le moment.</p>
          </>
        )}
      </Link>

      <div className="grid grid-cols-2 gap-3">
        <Carte
          titre="Congés restants"
          valeur={`${formaterNombre(soldeConge, { maximumFractionDigits: 1 })} j`}
          sousTitre="jours disponibles"
          icone="parasol"
          href="/espace/conges"
        />
        <Carte
          titre="Mes demandes"
          valeur={String(congesEnAttente)}
          sousTitre={`congé${congesEnAttente > 1 ? "s" : ""} en attente de réponse`}
          icone="valider"
          href="/espace/conges"
        />
      </div>

      {/* Tout l'espace, rangé comme le menu : mêmes groupes, mêmes mots. */}
      {GROUPES_ESPACE.map((g) => (
        <section key={g.titre}>
          <h2 className="mb-2 text-base font-semibold">{g.titre}</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {g.liens.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="flex min-h-24 flex-col gap-2 rounded-xl border bg-card p-3 transition hover:border-primary hover:bg-accent"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icone nom={l.icone} taille={18} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium leading-snug">{l.label}</span>
                  <span className="block text-xs text-muted-foreground">{l.desc}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Alerte({ href, icone, titre, texte }: { href: string; icone: string; titre: string; texte: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900 transition hover:border-amber-400"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100"><Icone nom={icone} /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{titre}</span>
        <span className="block text-xs">{texte}</span>
      </span>
      <Icone nom="chevronDroit" className="shrink-0" />
    </Link>
  );
}

function Carte({ titre, valeur, sousTitre, icone, href }: { titre: string; valeur: string; sousTitre: string; icone: string; href: string }) {
  return (
    <Link href={href} className="rounded-2xl border bg-card p-4 transition hover:border-primary">
      <div className="mb-1 flex items-center gap-2 text-sm text-muted-foreground">
        <Icone nom={icone} className="shrink-0" /> {titre}
      </div>
      <div className="text-2xl font-semibold tabular-nums">{valeur}</div>
      <div className="text-xs text-muted-foreground">{sousTitre}</div>
    </Link>
  );
}
