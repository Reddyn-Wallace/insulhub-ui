import { redirect } from "next/navigation";

export default function LegacyFollowupTemplates() {
  redirect("/jobs/settings?channel=sms");
}
