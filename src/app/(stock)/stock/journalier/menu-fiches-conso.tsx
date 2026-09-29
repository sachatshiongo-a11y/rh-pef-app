import { MenuFichePdf, classeLienFiche } from "../_print/menu-fiche-pdf";
import { dateLongue } from "@/lib/fiches-conso";

/**
 * Menu des FICHES de l'onglet Consommation, reproduites d'après les classeurs de la Direction :
 * « Rapport journalier cuisine et bar » (plats et boissons VENDUS, la semaine affichée),
 * « Consommation réelle du restaurant » (articles, d'après les comptages — ce que le rapport montrait
 * avant la saisie des ventes) et « Commande journalière » (un jour au choix), chacune en PDF ou en
 * Excel. Même bouton à menu que les fiches de Légumes frais.
 * `domaine` : filtre de l'écran (Cuisine / Bar) — sans filtre, les deux fiches.
 */
export function MenuFichesConso({ semaine, jourDefaut, domaine, libelleSemaine }: { semaine: string; jourDefaut: string; domaine?: string; libelleSemaine: string }) {
  const base = (type: string) => `/stock/journalier/fiche?type=${type}&semaine=${semaine}${domaine ? `&domaine=${domaine}` : ""}`;
  return (
    <MenuFichePdf libelle="Fiches (PDF / Excel)">
      <div className="space-y-1.5 rounded-lg border p-2.5">
        <p className="text-sm font-medium">Rapport journalier cuisine et bar</p>
        <p className="text-xs text-muted-foreground">Plats et boissons vendus · {libelleSemaine}</p>
        <div className="flex gap-2">
          <a href={`${base("rapport")}&format=pdf`} download className={`${classeLienFiche} flex-1`}>PDF</a>
          <a href={`${base("rapport")}&format=excel`} download className={`${classeLienFiche} flex-1`}>Excel</a>
        </div>
      </div>
      <div className="space-y-1.5 rounded-lg border p-2.5">
        <p className="text-sm font-medium">Consommation réelle du restaurant</p>
        <p className="text-xs text-muted-foreground">Articles, d&apos;après les comptages · {libelleSemaine}</p>
        <div className="flex gap-2">
          <a href={`${base("consommation")}&format=pdf`} download className={`${classeLienFiche} flex-1`}>PDF</a>
          <a href={`${base("consommation")}&format=excel`} download className={`${classeLienFiche} flex-1`}>Excel</a>
        </div>
      </div>
      {/* Formulaire GET : le fichier se télécharge sans quitter la page. */}
      <form action="/stock/journalier/fiche" method="get" className="space-y-1.5 rounded-lg border p-2.5">
        <p className="text-sm font-medium">Commande journalière</p>
        <input type="hidden" name="type" value="commande" />
        {domaine && <input type="hidden" name="domaine" value={domaine} />}
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Commande et livraison du
          <input type="date" name="date" required defaultValue={jourDefaut} className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground" />
        </label>
        <div className="flex gap-2">
          <button type="submit" name="format" value="pdf" className={`${classeLienFiche} flex-1`}>PDF</button>
          <button type="submit" name="format" value="excel" className={`${classeLienFiche} flex-1`}>Excel</button>
        </div>
      </form>
    </MenuFichePdf>
  );
}

const classeChamp = "w-full rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground";

/**
 * Menu des exports de l'onglet COMMANDE : la « Commande journalière » sur le modèle du classeur
 * (fiche cuisine, fiche bar) — un jour de la semaine affichée, ou toute la semaine en un seul
 * fichier — et, en second, le tableau brut de la saisie (tous les articles × 7 jours, total de
 * la semaine), qui n'est pas le modèle. Même bouton à menu que les fiches de l'onglet Consommation.
 * `jours` : les 7 jours de la semaine affichée ; `domaine` : filtre de l'écran (Cuisine / Bar).
 */
export function MenuFicheCommande({ semaine, jours, jourDefaut, domaine, libelleSemaine }: {
  semaine: string; jours: string[]; jourDefaut: string; domaine?: string; libelleSemaine: string;
}) {
  const dom = domaine ? `&domaine=${domaine}` : "";
  const toute = (format: string) => `/stock/journalier/fiche?type=commande&tout=1&semaine=${semaine}${dom}&format=${format}`;
  const tableau = (format: "pdf" | "excel") => `/stock/journalier/${format}?vue=commande&semaine=${semaine}${dom}`;
  return (
    <MenuFichePdf libelle="Commande journalière (PDF / Excel)">
      {/* Formulaire GET : le fichier se télécharge sans quitter la page. */}
      <form action="/stock/journalier/fiche" method="get" className="space-y-1.5 rounded-lg border p-2.5">
        <p className="text-sm font-medium">Un jour</p>
        <p className="text-xs text-muted-foreground">Fiche cuisine puis fiche bar, sur le modèle du classeur</p>
        <input type="hidden" name="type" value="commande" />
        {domaine && <input type="hidden" name="domaine" value={domaine} />}
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Commande et livraison du
          <select name="date" required defaultValue={jourDefaut} className={classeChamp}>
            {jours.map((j) => <option key={j} value={j}>{dateLongue(j)}</option>)}
          </select>
        </label>
        <div className="flex gap-2">
          <button type="submit" name="format" value="pdf" className={`${classeLienFiche} flex-1`}>PDF</button>
          <button type="submit" name="format" value="excel" className={`${classeLienFiche} flex-1`}>Excel</button>
        </div>
      </form>
      <div className="space-y-1.5 rounded-lg border p-2.5">
        <p className="text-sm font-medium">Toute la semaine</p>
        <p className="text-xs text-muted-foreground">Un seul fichier, jour par jour · {libelleSemaine}</p>
        <div className="flex gap-2">
          <a href={toute("pdf")} download className={`${classeLienFiche} flex-1`}>PDF</a>
          <a href={toute("excel")} download className={`${classeLienFiche} flex-1`}>Excel</a>
        </div>
      </div>
      <div className="space-y-1.5 rounded-lg border border-dashed p-2.5">
        <p className="text-sm font-medium">Tableau de la semaine</p>
        <p className="text-xs text-muted-foreground">Saisie brute : tous les articles, les 7 jours et le total (hors modèle)</p>
        <div className="flex gap-2">
          <a href={tableau("pdf")} download className={`${classeLienFiche} flex-1`}>PDF</a>
          <a href={tableau("excel")} download className={`${classeLienFiche} flex-1`}>Excel</a>
        </div>
      </div>
    </MenuFichePdf>
  );
}
