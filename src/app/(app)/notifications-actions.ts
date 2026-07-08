"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";

/** Marque comme lues les notifications d'un espace (RH ou STOCK). */
export async function marquerNotificationsLues(domaine: "RH" | "STOCK" = "RH") {
  await verifySession();
  const dom = domaine === "STOCK" ? "STOCK" : "RH";
  await prisma.notification.updateMany({ where: { domaine: dom, lu: false }, data: { lu: true } });
  revalidatePath("/", "layout");
}
