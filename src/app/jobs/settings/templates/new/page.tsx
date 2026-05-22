import TemplateEditor from "../TemplateEditor";

export default async function NewTemplatePage({ searchParams }: { searchParams: Promise<{ channel?: string }> }) {
  const params = await searchParams;
  return <TemplateEditor initialChannel={params.channel} />;
}
