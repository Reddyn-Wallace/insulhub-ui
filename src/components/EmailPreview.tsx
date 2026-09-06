"use client";
export default function EmailPreview({ html }: { html: string }) {
  // Gmail signatures are HTML. Isolate them from the CRM, scripts, forms and top-level navigation.
  const document = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{font:14px/1.5 Arial,sans-serif;overflow-wrap:anywhere;margin:12px;color:#1f2937}img{max-width:100%;height:auto}</style></head><body>${html}</body></html>`;
  return <iframe title="Email preview" sandbox="" referrerPolicy="no-referrer" srcDoc={document} className="h-64 w-full rounded-lg border bg-white" />;
}
