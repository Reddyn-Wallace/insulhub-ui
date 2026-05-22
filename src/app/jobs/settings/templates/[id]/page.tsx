import TemplateEditor from "../TemplateEditor";

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TemplateEditor templateId={id} />;
}
