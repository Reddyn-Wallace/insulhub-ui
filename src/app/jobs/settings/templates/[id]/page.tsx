import { redirect } from "next/navigation";
import TemplateEditor from "../TemplateEditor";

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const legacy = id.match(/^quote-followup-(sms|email)-[12]$/);
  if (legacy) redirect(`/jobs/settings?channel=${legacy[1]}`);
  return <TemplateEditor templateId={id} />;
}
