import { NextRequest, NextResponse } from "next/server";
import { requireInsulhubAuth } from "@/lib/insulhub-auth";
import { ensureOverlaySchema, overlaySql } from "@/lib/overlay-db";

type ContactTemplateInput = {
  title?: string;
  channel?: "sms" | "email";
  description?: string | null;
  subject?: string | null;
  body?: string;
  sortOrder?: number | string | null;
};

const DEFAULT_TEMPLATES: Required<ContactTemplateInput>[] = [
  {
    title: "Lead follow-up",
    channel: "sms",
    description: "Quick first response for a new enquiry.",
    subject: "",
    body: "Hi {customer name}, {salesperson} from Insulmax here. When would suit for me to give you a quick call about how we might be able to help. Cheers",
    sortOrder: 10,
  },
  {
    title: "Quote booking reminder",
    channel: "sms",
    description: "Confirm an upcoming quote visit.",
    subject: "",
    body: "Hi {first name}, this is a reminder that your Insulmax quote is booked for {quote booking date}. Please let us know if that time no longer suits.",
    sortOrder: 20,
  },
  {
    title: "Lead follow-up",
    channel: "email",
    description: "First email after a lead enquiry.",
    subject: "Insulmax enquiry #{job number}",
    body: "Hi {customer name},\n\n{salesperson} from Insulmax here. When would suit for me to give you a quick call about how we might be able to help?\n\nCheers,\n{salesperson}",
    sortOrder: 10,
  },
];

function parseSortOrder(value: ContactTemplateInput["sortOrder"]) {
  if (value === "" || value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toContactTemplate(row: Record<string, unknown>) {
  return {
    id: row.id,
    title: row.title,
    channel: row.channel,
    description: row.description,
    subject: row.subject,
    body: row.body,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function seedDefaultTemplatesIfEmpty() {
  const seededRows = await overlaySql`
    SELECT value
    FROM overlay_settings
    WHERE key = 'contact_templates_seeded'
    LIMIT 1
  `;
  if (seededRows[0]) return;

  const countRows = await overlaySql`SELECT COUNT(*)::int AS count FROM contact_templates`;
  if (Number(countRows[0]?.count || 0) > 0) {
    await overlaySql`
      INSERT INTO overlay_settings (key, value)
      VALUES ('contact_templates_seeded', 'true')
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `;
    return;
  }

  for (const template of DEFAULT_TEMPLATES) {
    await overlaySql`
      INSERT INTO contact_templates (title, channel, description, subject, body, sort_order)
      VALUES (
        ${template.title},
        ${template.channel},
        ${template.description},
        ${template.subject},
        ${template.body},
        ${parseSortOrder(template.sortOrder)}
      )
    `;
  }

  await overlaySql`
    INSERT INTO overlay_settings (key, value)
    VALUES ('contact_templates_seeded', 'true')
    ON CONFLICT (key)
    DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
}

export async function GET(request: NextRequest) {
  try {
    const unauthorized = await requireInsulhubAuth(request);
    if (unauthorized) return unauthorized;

    await ensureOverlaySchema();
    await seedDefaultTemplatesIfEmpty();

    const { searchParams } = new URL(request.url);
    const channel = searchParams.get("channel");
    if (channel && !["sms", "email"].includes(channel)) {
      return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
    }

    const rows = channel
      ? await overlaySql`
          SELECT *
          FROM contact_templates
          WHERE channel = ${channel}
          ORDER BY sort_order ASC, title ASC, created_at ASC
        `
      : await overlaySql`
          SELECT *
          FROM contact_templates
          ORDER BY channel ASC, sort_order ASC, title ASC, created_at ASC
        `;

    return NextResponse.json({ templates: rows.map(toContactTemplate) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load contact templates" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const unauthorized = await requireInsulhubAuth(request);
    if (unauthorized) return unauthorized;

    await ensureOverlaySchema();

    const input = (await request.json()) as ContactTemplateInput;
    const title = input.title?.trim();
    const body = input.body?.trim();
    const channel = input.channel;

    if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });
    if (!channel || !["sms", "email"].includes(channel)) return NextResponse.json({ error: "Valid channel is required" }, { status: 400 });
    if (!body) return NextResponse.json({ error: "Body is required" }, { status: 400 });

    const rows = await overlaySql`
      INSERT INTO contact_templates (title, channel, description, subject, body, sort_order)
      VALUES (
        ${title},
        ${channel},
        ${input.description?.trim() || ""},
        ${channel === "email" ? input.subject?.trim() || "" : ""},
        ${body},
        ${parseSortOrder(input.sortOrder)}
      )
      RETURNING *
    `;

    return NextResponse.json({ template: toContactTemplate(rows[0]) }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create contact template" },
      { status: 500 }
    );
  }
}
