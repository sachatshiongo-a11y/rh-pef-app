import { MenuFichePdf, classeLienFiche } from "../_print/menu-fiche-pdf";

/**
 * Menu des FICHES de l'onglet Consommation, reproduites d'après les classeurs de la Direction :
 * « Rapport journalier cuisine et bar » (la semaine affichée) et « Commande journalière » (un jour
 * au choix), chacune en PDF ou en Excel. Même bouton à menu que les fiches de Légumes frais.
 * `domaine` : filtre de l'écran (Cuisine / Bar) — sans filtre, les deux fiches.
 */
export function MenuFichesConso({ semaine, jourDefaut, domaine, libelleSemaine }: { semaine: string; jourDefaut: string; domaine?: string; libelleSemaine: string }) {
  const base = `/stock/journalier/fiche?type=rapport&semaine=${semaine}${domaine ? `&domaine=${domaine}` : ""}`;
  return (
    <MenuFichePdf libelle="Fiches (PDF / Excel)">
      <div className="space-y-1.5 rounded-lg border p-2.5">
        <p className="text-sm font-medium">Rapport journalier cuisine et bar</p>
        <p className="text-xs text-muted-foreground">{libelleSemaine}</p>
        <div className="flex gap-2">
          <a href={`${base}&format=pdf`} download className={`${classeLienFiche} flex-1`}>PDF</a>
          <a href={`${base}&format=excel`} download className={`${classeLienFiche} flex-1`}>Excel</a>
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
