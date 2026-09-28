// Liste figée des légumes frais : celle de la fiche « Achat de légumes Marché » remise par la
// Direction (classeur fiche-inventaire-legumes.xlsx, feuille « Achat légumes », 2026-09-28) —
// 38 lignes, même ordre, mêmes unités. « Menthe » n'a pas d'unité sur la fiche : elle reste sans.
//
// Les achats déjà enregistrés gardent leur libellé en texte libre : cette liste ne sert qu'à
// proposer un choix à la saisie, à dresser la fiche d'achat imprimable et à nommer les lignes
// de la commande journalière du restaurant (CommandeLegumeResto, clé = libellé EXACT).
// C'est pour cette dernière raison que « Lemons / Citrons-verts » garde son espacement : la
// fiche écrit « Lemons/ Citrons-verts », mais renommer ferait disparaître de la grille de
// commande les quantités déjà saisies sous l'ancien libellé. La fiche d'achat, elle, rapproche
// les libellés sans tenir compte des espaces, de la casse ni des accents.
export const LEGUMES: { nom: string; unite: string }[] = [
  { nom: "Ail", unite: "Kg" },
  { nom: "Ananas", unite: "Pièce" },
  { nom: "Aubergine", unite: "Kg" },
  { nom: "Basilic", unite: "Botte" },
  { nom: "Carottes", unite: "Kg" },
  { nom: "Céléri", unite: "Pièce" },
  { nom: "Ciboulettes", unite: "Bottes" },
  { nom: "Citron jaune", unite: "Kg" },
  { nom: "Citron local", unite: "Kg" },
  { nom: "Concombre", unite: "Kg" },
  { nom: "Courgettes", unite: "Kg" },
  { nom: "Épinard", unite: "Kg" },
  { nom: "Feuilles de Laurier", unite: "Kg" },
  { nom: "Gingembre", unite: "Kg" },
  { nom: "Haricot vert", unite: "Kg" },
  { nom: "Jus de Citron", unite: "Unité" },
  { nom: "Lemons / Citrons-verts", unite: "Kg" }, // fiche : « Lemons/ Citrons-verts » (voir plus haut)
  { nom: "Mangue", unite: "Pièce" },
  { nom: "Maracuja", unite: "Pièce" },
  { nom: "Menthe", unite: "" },
  { nom: "Oignons", unite: "Kg" },
  { nom: "Orange", unite: "Kg" },
  { nom: "Pastèque", unite: "Pièce" },
  { nom: "Persil", unite: "Botte" },
  { nom: "Piments", unite: "Ekolo" },
  { nom: "Poireaux", unite: "Kg" },
  { nom: "Poivron Jaune et rouge", unite: "Kg" },
  { nom: "Poivron vert", unite: "Kg" },
  { nom: "Pomme", unite: "Kg" },
  { nom: "Pommes de terre", unite: "Kg" },
  { nom: "Salade Lolo", unite: "Kg" },
  { nom: "Thym", unite: "Botte" },
  { nom: "Tomates fraiches", unite: "Kg" },
  { nom: "Cubes", unite: "Pièce" },
  { nom: "Cerise en boîte", unite: "Boîte" },
  { nom: "Tomates cerises", unite: "Kg" },
  { nom: "Tomates séchées", unite: "Boîte" },
  { nom: "Feuilles de menthe", unite: "Boîte" },
];
