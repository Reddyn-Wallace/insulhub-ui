import { NextRequest, NextResponse } from "next/server";

interface CalendarJob {
  _id: string;
  jobNumber: number;
  stage: string;
  notes?: string | null;
  installation?: {
    installDate?: string | null;
    installNote?: string | null;
    installStatus?: string | null;
    checkSheetSignedAsComplete?: boolean | null;
  };
  installerChecksheet?: {
    _id?: string | null;
    complete?: boolean | null;
  } | null;
  client?: {
    contactDetails?: {
      name?: string;
      email?: string;
      phoneMobile?: string;
      streetAddress?: string;
      suburb?: string;
      city?: string;
    };
  };
  quote?: {
    c_total?: number | null;
    wall?: { SQM?: number | null };
    ceiling?: { SQM?: number | null };
  };
}

interface JobsData {
  jobs: {
    results: CalendarJob[];
  };
}

const INSULHUB_GRAPHQL_URL = "https://api.insulhub.nz/graphql";
const CALENDAR_STAGES = ["SCHEDULED", "INSTALLATION", "INVOICE", "COMPLETED"];
const CALENDAR_JOBS_QUERY = `
  query CalendarJobs($stages: [JobStage!], $skip: Int, $limit: Int, $installStartDate: DateTimeISO, $installEndDate: DateTimeISO) {
    jobs(stages: $stages, skip: $skip, limit: $limit, installStartDate: $installStartDate, installEndDate: $installEndDate) {
      results {
        _id
        jobNumber
        stage
        notes
        installation {
          installDate
          installNote
          installStatus
          checkSheetSignedAsComplete
        }
        installerChecksheet {
          _id
          complete
        }
        client {
          contactDetails {
            name
            email
            phoneMobile
            streetAddress
            suburb
            city
          }
        }
        quote {
          c_total
          wall { SQM }
          ceiling { SQM }
        }
      }
    }
  }
`;

function tokenFromRequest(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return request.headers.get("x-access-token") || "";
}

function dateKeyFromIsoNz(iso?: string | null) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function validIsoDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const start = validIsoDate(searchParams.get("start"));
    const end = validIsoDate(searchParams.get("end"));
    if (!start || !end || start > end) {
      return NextResponse.json({ error: "Valid start and end query params are required" }, { status: 400 });
    }

    const token = tokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const response = await fetch(INSULHUB_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-access-token": token,
      },
      body: JSON.stringify({
        query: CALENDAR_JOBS_QUERY,
        variables: {
          stages: CALENDAR_STAGES,
          skip: 0,
          limit: 5000,
          installStartDate: start.toISOString(),
          installEndDate: end.toISOString(),
        },
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json({ error: "Failed to load calendar jobs" }, { status: response.status });
    }

    const json = await response.json();
    if (json.errors?.length) {
      const message = json.errors[0]?.message || "Failed to load calendar jobs";
      const status = message.toLowerCase().includes("unauthorized") || message.toLowerCase().includes("unauthenticated")
        ? 401
        : 502;
      return NextResponse.json(
        { error: message },
        { status }
      );
    }

    const data = json.data as JobsData;
    const startKey = dateKeyFromIsoNz(start.toISOString());
    const endKey = dateKeyFromIsoNz(end.toISOString());
    const jobs = (data.jobs.results || []).filter((job) => {
      const key = dateKeyFromIsoNz(job.installation?.installDate);
      return !!key && !!startKey && !!endKey && key >= startKey && key <= endKey;
    });

    return NextResponse.json({ jobs });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load calendar jobs" },
      { status: 500 }
    );
  }
}
