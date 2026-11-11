import { NextRequest, NextResponse } from "next/server";
import { CALENDAR_STAGES, calendarVisits } from "@/lib/installation-splits/views";
import { readSplits } from "@/lib/installation-splits/store";
import { projectVisits } from "@/lib/installation-splits/projection";

interface CalendarJob {
  _id: string;
  jobNumber: number;
  stage: string;
  archivedAt?: string | null;
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
      phoneSecondary?: string;
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
    total: number;
  };
}

const INSULHUB_GRAPHQL_URL = "https://api.insulhub.nz/graphql";
const CALENDAR_JOBS_QUERY = `
  query CalendarJobs($stages: [JobStage!], $skip: Int, $limit: Int) {
    jobs(stages: $stages, skip: $skip, limit: $limit) {
      total
      results {
        _id
        jobNumber
        stage
        archivedAt
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
            phoneSecondary
            streetAddress
            suburb
            city
          }
        }
        quote {
          c_total
          wall { SQM c_bagCount }
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

    const allJobs: CalendarJob[] = [];
    let total: number | null = null;
    for (let page = 0; page < 100; page++) {
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
          skip: allJobs.length,
          limit: 250,
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
    if (total === null) total = data.jobs.total;
    if (data.jobs.total !== total) throw new Error("Jobs changed while loading. Refresh the calendar.");
    if (!data.jobs.results.length && allJobs.length < total) throw new Error("Calendar results are incomplete.");
    allJobs.push(...data.jobs.results);
    if (allJobs.length >= total) break;
    }
    if (total === null || allJobs.length !== total || new Set(allJobs.map(j=>j._id)).size !== total) throw new Error("Calendar results are incomplete. Refresh before scheduling.");
    const active = allJobs.filter(job=>!job.archivedAt);
    const splits = await readSplits(active.map(j=>j._id));
    const projected = active.flatMap(job=>calendarVisits(job,splits[job._id] || null));
    const startKey = dateKeyFromIsoNz(start.toISOString());
    const endKey = dateKeyFromIsoNz(end.toISOString());
    const jobs = projected.filter(job=>{
      const key=dateKeyFromIsoNz(job.installation?.installDate);
      return key && startKey && endKey && key>=startKey && key<=endKey;
    });
    const unscheduled = active.flatMap(job=>splits[job._id] ? projectVisits(job,splits[job._id]).filter(v=>!v.installation?.installDate && v.splitVisit.state==='planned') : []);
    return NextResponse.json({ jobs, unscheduled }, {headers:{"Cache-Control":"no-store"}});
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load calendar jobs" },
      { status: 500 }
    );
  }
}
