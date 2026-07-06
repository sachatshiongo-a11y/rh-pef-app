"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";

const BUCKET = "employes";
const TYPES_OK: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** Upload d'une photo d'employé vers Supabase Storage (bucket public) + mise à jour de photoUrl. */
export async function uploadPhotoEmploye(employeeId: string, formData: FormData) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return;
  const ext = TYPES_OK[file.type];
  if (!ext) throw new Error("Format non supporté (PNG, JPG ou WEBP).");
  if (file.size > 5 * 1024 * 1024) throw new Error("Photo trop lourde (max 5 Mo).");

  const path = `${employeeId}-${Date.now()}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const res = await fetch(`${base}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": file.type,
      "x-upsert": "true",
    },
    body: bytes,
  });
  if (!res.ok) throw new Error("Échec de l'upload de la photo.");

  const publicUrl = `${base}/storage/v1/object/public/${BUCKET}/${path}`;
  await prisma.employee.update({ where: { id: employeeId }, data: { photoUrl: publicUrl } });

  revalidatePath(`/employes/${employeeId}`);
  revalidatePath("/employes");
}
