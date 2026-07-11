import Link from "next/link";
import { Fragment } from "react";

/**
 * Fil d'Ariane des pages profondes : « Bons de commande › 004/PEF/JUIL/26 ».
 * Le dernier segment (page courante) n'est pas cliquable.
 */
export function FilAriane({ segments }: { segments: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Fil d'Ariane" className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
      {segments.map((s, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden className="select-none">›</span>}
          {s.href ? (
            <Link href={s.href} className="rounded outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring">
              {s.label}
            </Link>
          ) : (
            <span aria-current="page" className="max-w-[16rem] truncate font-medium text-foreground">{s.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
