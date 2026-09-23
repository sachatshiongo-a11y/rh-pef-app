// Le message d'un compte qui n'est pas lié à une fiche employé : on ne pointe que pour soi, et
// « soi » est la fiche liée au compte. Partagé par l'écran « Pointer » et le chemin `/scan`.
export function CompteNonLie() {
  return (
    <div className="rounded-2xl border border-dashed bg-card p-6 text-sm text-muted-foreground">
      Votre compte n&apos;est pas encore lié à une fiche employé. Demandez à la Direction de faire le lien
      (Paramètres → Utilisateurs) pour pouvoir pointer vos heures.
    </div>
  );
}
