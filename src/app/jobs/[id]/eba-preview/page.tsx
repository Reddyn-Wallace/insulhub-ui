"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function EbaPreviewRedirectPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id || "";

  useEffect(() => {
    router.replace(id ? `/jobs/${id}/eba` : "/jobs");
  }, [id, router]);

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10 text-sm text-gray-600">
      Redirecting to the current EBA form...
    </main>
  );
}
