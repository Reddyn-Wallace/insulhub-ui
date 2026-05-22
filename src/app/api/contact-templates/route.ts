import { NextRequest, NextResponse } from "next/server";
import { requireInsulhubAuth } from "@/lib/insulhub-auth";
import { ensureOverlaySchema, overlaySql } from "@/lib/overlay-db";

type ContactTemplateInput = {
  title?: string;
  channel?: "sms" | "email" | "calendar";
  description?: string | null;
  subject?: string | null;
  body?: string;
  sortOrder?: number | string | null;
};

const VALID_CHANNELS = ["sms", "email", "calendar"] as const;

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

const DEFAULT_CALENDAR_TEMPLATES: Required<ContactTemplateInput>[] = [
  {
    title: "Internal booking message",
    channel: "calendar",
    description: "Wall install from inside the home.",
    subject: "{address} - Insulmax installation",
    body: "Hi {first name},\n\nOur install team will be with you on {install date} at {install time} to insulate. They will require access to power.\n\nCOUNCIL COMPLIANCE - will be submitted once you have confirmed your install date.\n\nWellington City Council clients - be advised when we send the paperwork through to council they will send you a Simpli log-on - fine to accept. They will also send you the invoice when this is processed, please do not pay this, as we sort this and it can take a while for a refund to come back to you.\n\nINTERNAL WORK - Please allow a 1m clearance from the walls being insulated - NOTE all internal work only has the first skim of plaster.\n\nAny questions, please ring Olivia 04 242 0771",
    sortOrder: 10,
  },
  {
    title: "External booking message",
    channel: "calendar",
    description: "Wall install from outside the home.",
    subject: "{address} - Insulmax installation",
    body: "Hi {first name},\n\nOur install team will be with you on {install date} at {install time}. They will require access to power.\n\nCOUNCIL COMPLIANCE - will be submitted once you have confirmed your install date.\n\nWellington City Council clients - be advised when we send the paperwork through to council they will send you a Simpli log-on - fine to accept. They will also send you the invoice when this is processed, please do not pay this, as we sort this and it can take a while for a refund to come back to you.\n\nEXTERNAL WORK - for health and safety reasons the team require access to the inside of the home for the bathroom and thermal imaging purposes, if this is ok.\n\nPlease ensure all items away from home ie: shoes, pot plants, bikes etc to make it easier for installers to get around.\n\nIf top coat being done, please supply 2L self priming top coat of your house colour eg: Resene Lumberside, and let our team know on arrival.\n\nThis install is also weather dependent so if it is wet on the day, we will need to reschedule.\n\nAny questions, please ring Olivia 04 242 0771",
    sortOrder: 20,
  },
  {
    title: "Both booking message",
    channel: "calendar",
    description: "Install may be inside or outside depending on weather.",
    subject: "{address} - Insulmax installation",
    body: "Hi {first name},\n\nWe will confirm whether you want us to insulate from inside or outside the day before depending on what the weather is doing.\n\nOur install team will be with you on {install date} at {install time} to insulate. They will require access to power.\n\nCOUNCIL COMPLIANCE - will be submitted once you have confirmed your install date.\n\nWellington City Council clients - be advised when we send the paperwork through to council they will send you a Simpli log-on - fine to accept. They will also send you the invoice when this is processed, please do not pay this, as we sort this and it can take a while for a refund to come back to you.\n\nIF EXTERNAL WORK - for health and safety reasons the team require access to the inside of the home for the bathroom and thermal imaging purposes, if this is ok.\n\nPlease ensure all items away from home ie: shoes, pot plants, bikes etc to make it easier for installers to get around.\n\nIf top coat being done, please supply 2L self priming top coat of your house colour eg: Resene Lumberside, and let our team know on arrival.\n\nThis install is also weather dependent so if it is wet on the day, we will need to reschedule.\n\nIF INTERNAL WORK - Please allow a 1m clearance from the walls being insulated - NOTE all internal work only has the first skim of plaster.\n\nAny questions, please ring Olivia 04 242 0771",
    sortOrder: 30,
  },
  {
    title: "Internal or external choice",
    channel: "calendar",
    description: "Ask the customer to choose inside or outside.",
    subject: "{address} - Insulmax installation option",
    body: "Please let us know whether you would like our team to insulate from inside or outside.",
    sortOrder: 40,
  },
  {
    title: "Ceiling booking message",
    channel: "calendar",
    description: "Ceiling insulation preparation note.",
    subject: "{address} - Insulmax ceiling installation",
    body: "Hi {first name},\n\nPlease make sure that all rooms being insulated are as clear as possible. The team will cover any furniture that is around.\n\nAny questions, please ring Olivia 04 242 0771",
    sortOrder: 50,
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

async function seedCalendarTemplatesIfMissing() {
  const seededRows = await overlaySql`
    SELECT value
    FROM overlay_settings
    WHERE key = 'calendar_templates_seeded'
    LIMIT 1
  `;
  if (seededRows[0]) return;

  for (const template of DEFAULT_CALENDAR_TEMPLATES) {
    const existingRows = await overlaySql`
      SELECT id
      FROM contact_templates
      WHERE channel = 'calendar' AND title = ${template.title}
      LIMIT 1
    `;
    if (existingRows[0]) continue;

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
    VALUES ('calendar_templates_seeded', 'true')
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
    await seedCalendarTemplatesIfMissing();

    const { searchParams } = new URL(request.url);
    const channel = searchParams.get("channel");
    if (channel && !VALID_CHANNELS.includes(channel as typeof VALID_CHANNELS[number])) {
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
    if (!channel || !VALID_CHANNELS.includes(channel)) return NextResponse.json({ error: "Valid channel is required" }, { status: 400 });
    if (!body) return NextResponse.json({ error: "Body is required" }, { status: 400 });

    const rows = await overlaySql`
      INSERT INTO contact_templates (title, channel, description, subject, body, sort_order)
      VALUES (
        ${title},
        ${channel},
        ${input.description?.trim() || ""},
        ${channel === "email" || channel === "calendar" ? input.subject?.trim() || "" : ""},
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
