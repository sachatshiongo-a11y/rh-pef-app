"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";

/** Marque toutes les notifications comme lues (réservé à la Direction). */
export async function marquerNotificationsLues() {
  const user = await verifySession();
  if (user.role !== "ADMIN") return;
  await prisma.notification.updateMany({ where: { lu: false }, data: { lu: true } });
  revalidatePath("/", "layout");
}
