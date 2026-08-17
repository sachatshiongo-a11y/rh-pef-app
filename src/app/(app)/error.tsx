"use client";

import { ErrorRetry } from "@/components/error-retry";

export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorRetry {...props} accueilHref="/accueil" />;
}
