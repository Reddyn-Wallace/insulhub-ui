import { redirect } from "next/navigation";

export default function RetiredPartnerOperationsPage() {
  redirect("/jobs/settings?section=partners");
}
