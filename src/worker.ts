/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

interface Env {
  INFOCAL_DB: D1Database;
  CLIENT_TOKEN: string;
  ADMIN_TOKEN: string;
}

/* ===== Types ===== */
type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

/* ===== Typed HTTP Errors ===== */
class HttpError extends Error { constructor(public status:number, msg:string){super(msg); this.name=new.target.name;} }
class BadRequestError extends HttpError { constructor(msg="Bad Request"){super(400,msg);} }
class UnauthorizedError extends HttpError { constructor(msg="Unauthorized"){super(401,msg);} }
class InternalError extends HttpError { constructor(msg="Internal Server Error"){super(500,msg);} }
class StealthBlockedError extends HttpError { constructor(msg=""){super(200,msg);} }

/* Constants */
const SECONDS_IN_HOUR = 3600;
const SECONDS_IN_DAY = SECONDS_IN_HOUR * 24;
const SECONDS_IN_MONTH = 31 * SECONDS_IN_DAY;

//! Block list to block request by known ip (e.g. for abuse prevention)
const IP_BLOCK_LIST = [
  "203.0.113.0",    // example, IANA reserved for documentation and test
  "255.255.255.255" // example, IANA reserved broadcast destination
];

/* ===== Entry ===== */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await router(request, env);
    } catch (err: any) {
      // Do not log blocked requests (to prevent log flooding)
      if (err instanceof StealthBlockedError) {
        return jsonOkResponse();
      }

      // Log other errors
      console.error(err);
      if (err.message.includes("SQLITE_CONSTRAINT")) {
        return jsonResponse({ error: "Bad Request (constraint violation)" }, 400);
      } else if (err instanceof HttpError) {
        return jsonResponse({ error: err.message }, err.status);
      } else if (hasAuthToken(request, env.ADMIN_TOKEN)) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return jsonResponse({ error: "Internal Server Error", detail: msg }, 500);
      } else {
        return jsonResponse({ error: "Internal Server Error" }, 500);
      }
    }
  },
} satisfies ExportedHandler<Env>;

/* ===== Router with split auth ===== */
async function router(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const clientIp = request.headers.get("cf-connecting-ip");

  // support ip blocking
  requireNotBlocked(clientIp);

  // check auth env is initialized
  if (!env.CLIENT_TOKEN || !env.ADMIN_TOKEN) throw new InternalError();

  // Device routes (client auth)
  if (path === "/heartbeat" && method === "POST") { requireAuthToken(request, env.CLIENT_TOKEN); return heartbeat(request, env); }

  // Admin routes (admin auth)
  if (path === "/count"   && method === "GET")  { requireAuthToken(request, env.ADMIN_TOKEN); return count(request, env); }
  if (path === "/list"    && method === "GET")  { requireAuthToken(request, env.ADMIN_TOKEN); return list(request, env); }
  if (path === "/metrics" && method === "GET")  { requireAuthToken(request, env.ADMIN_TOKEN); return metrics(request, env); }

  throw new BadRequestError();
}

/* ===== Routes ===== */

//! Client heartbeat endpoint
//! Used for collecting anonymized device usage analytics (device family, firmware version, software version, etc.)
//!
//! POST /heartbeat?uid=...&part=...[&fw=...&sw=]
//!     uid     (required)unique identifier
//!     part    (required)part number
//!     fw      firmware version
//!     sw      software version
async function heartbeat(request: Request, env: Env): Promise<Response> {
  // read cloudflare metadata
  const cf = (request as any).cf;
  const country = cf?.country || null;

  // read from query params
  const url = new URL(request.url);
  const uid = (url.searchParams.get("uid") || "").toString().trim();
  const part = (url.searchParams.get("part") || "").toString().trim();
  const fw = (url.searchParams.get("fw") || "").toString().trim() || null;
  const sw = (url.searchParams.get("sw") || "").toString().trim() || null;
  if (!uid) throw new BadRequestError("uid is required");
  if (!part) throw new BadRequestError("part is required");

  const now = unix_time();

  // insert or update statement
  const stmt = `
    INSERT INTO heartbeats (unique_id, first_seen, last_seen, part_num, fw_version, sw_version, country)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    ON CONFLICT(unique_id) DO UPDATE SET
      last_seen = excluded.last_seen,
      part_num = excluded.part_num,
      fw_version = excluded.fw_version,
      sw_version = excluded.sw_version,
      country = excluded.country
  `;
  await env.INFOCAL_DB.prepare(stmt).bind(uid, now, now, part, fw, sw, country).run();

  return jsonOkResponse();
}

//! Count the number of devices seen recently
//!
//! GET /count?window=3600&format=csv
//!     window    (optional) time window to filter on last seen heartbeat; default=(1 day)
//!     format    (optional) response format (json|csv); default=json
async function count(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const windowSec = minMax( getIntOrDefault(url.searchParams.get("window"), SECONDS_IN_DAY), 1, SECONDS_IN_MONTH);
  const now = unix_time();
  const since = now - windowSec;
  const format = getFormat(url);

  const { results } = await env.INFOCAL_DB
    .prepare(`SELECT COUNT(*) AS active FROM heartbeats WHERE last_seen >= ?1`)
    .bind(since)
    .all<{ active: number }>();

  const active = results?.[0]?.active ?? 0;

  if (format === "csv") {
    const header = "timestamp,window,active\n";
    const line = `${now},${windowSec},${active}\n`;
    return csvResponse(header, line);
  } else {
    return jsonResponse({ since, window:windowSec, active });
  }
}

//! List the devices seen recently
//!
//! GET /list?window=3600&format=csv
//!     window    time window to filter on last seen heartbeat; default=(1 day)
//!     format    (optional) response format (json|csv); default=json
async function list(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const windowSec = minMax( getIntOrDefault(url.searchParams.get("window"), SECONDS_IN_DAY), 1, SECONDS_IN_MONTH);
  const since = unix_time() - windowSec;
  const format = getFormat(url);

  const { results } = await env.INFOCAL_DB
    .prepare(
      `SELECT
          unique_id,
          first_seen,
          last_seen,
          part_num,
          COALESCE(fw_version, 'Unknown') AS fw_version,
          COALESCE(sw_version, 'Unknown') AS sw_version,
          COALESCE(country, 'Unknown') AS country
       FROM heartbeats
       WHERE last_seen >= ?1
       ORDER BY last_seen DESC`
    )
    .bind(since)
    .all<{
      unique_id: string;
      first_seen: number;
      last_seen: number;
      part_num: string;
      fw_version: string;
      sw_version: string;
      country:string | null;
    }>();

  const devices = results ?? [];

  if (format === "csv") {
    const header = "unique_id,first_seen,last_seen,part_num,fw_version,sw_version,country\n";
    const lines = devices.map(d =>
      [
        csvEscape(d.unique_id),
        d.first_seen,
        d.last_seen,
        csvEscape(d.part_num),
        csvEscape(d.fw_version),
        csvEscape(d.sw_version),
        csvEscape(d.country)
      ].join(",")
    ).join("\n");
    return csvResponse(header, lines);
  } else {
    return jsonResponse({ devices: results ?? [], windowSec });
  }
}


//! Summarize the devices seen recently, grouped by part number and firmware version
//!
//! GET /metrics?window=3600&groups=part_num,fw_version&format=csv
//!     window    (optional) time window to filter on last seen heartbeat; default=(1 day)
//!     group[s]  (optional) comma-delimited list of metric(s) to group by (part_num,fw_version,sw_version,country); default=part_num; max=3
//!     format    (optional) response format (json|csv); default=json
async function metrics(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const windowSec = minMax( getIntOrDefault(url.searchParams.get("window"), SECONDS_IN_DAY), 1, SECONDS_IN_MONTH);
  const now = unix_time()
  const since = now - windowSec;
  const format = getFormat(url);
  const groups = getGroups(url);

  // Build SQL parts
  const cols = groups.map(g => `COALESCE(${g}, 'Unknown') AS ${g}`);
  const groupCols = groups.join(", ");

  const sql = `
      SELECT ${cols.join(", ")}, COUNT(*) AS count
      FROM heartbeats
      WHERE last_seen >= ?1
      GROUP BY ${groupCols}
      ORDER BY count DESC, ${groupCols};
    `;

  const { results } = await env.INFOCAL_DB.prepare(sql).bind(since).all<{
    part_num: string;
    fw_version: string;
    sw_version: string;
    count: number;
  }>() ?? [];

  const totalActive = results.reduce((s, r) => s + (r.count || 0), 0);

  if (format === "csv") {
    const columns = [...groups, "count"];
    const header = columns.join(",") + "\n";
    const lines = results
      .map((r: any) =>
        columns
          .map((k) => (k === "count" ? String(r.count) : csvEscape(r[k])))
          .join(",")
      )
      .join("\n");

    return csvResponse(header, lines);
  }

  return jsonResponse({ window:windowSec, timestamp:now, totalActive, results });
}

// ---------- utils ----------

function unique<T>(array: T[]): T[] {
  return [...new Set(array)];
}

function unix_time(): number {
  return Math.floor(Date.now() / 1000);
}

function getFormat(url: URL): string {
  const format = (url.searchParams.get("format") || "json").toLowerCase();
  if (!["json", "csv"].includes(format)) throw new BadRequestError("invalid format");
  return format;
}

function getGroups(url:URL): string[] {
  const groupline = (url.searchParams.get("group") || url.searchParams.get("groups") || "part_num").toLowerCase();
  const allgroups = unique(groupline.split(",").map(s => s.trim()));

  for (const g of allgroups) {
    if (!["part_num", "fw_version", "sw_version", "country"].includes(g)) throw new BadRequestError("invalid groups");
  }
  return allgroups;
}

function getIntOrDefault(raw: string | null, fallback: number) : number {
  const n = (raw) ? parseInt(raw, 10) : NaN;
  return (Number.isNaN(n)) ? fallback : n;
}

function minMax(n: number, min: number, max: number) : number {
  return Math.min(max, Math.max(min, n));
}

//! Send response, and ensure proxies do not try to cache request
//! no-store: don’t write it to disk anywhere.
//! no-cache + must-revalidate: defend against intermediate caches.
function csvResponse(header: string, lines: string): Response | PromiseLike<Response> {
  return new Response(header + lines, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    }
  });
}

//! Send response, and ensure proxies do not try to cache request
//! no-store: don’t write it to disk anywhere.
//! no-cache + must-revalidate: defend against intermediate caches.
function jsonResponse(data: Record<string, JsonValue>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

//! Send response, and ensure proxies do not try to cache request
//! no-store: don’t write it to disk anywhere.
//! no-cache + must-revalidate: defend against intermediate caches.
function jsonOkResponse(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

function csvEscape(s: unknown): string {
  const v = (s ?? "").toString();
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function hasAuthToken(request: Request, expected: string): Boolean {
  const headerName = "X-Auth";
  const provided = request.headers.get(headerName);
  return (provided == expected);
}

function requireAuthToken(request: Request, expected: string): void {
  if (!hasAuthToken(request, expected)) throw new UnauthorizedError();
}

function requireNotBlocked(ip: string | null) {
  if (ip && IP_BLOCK_LIST.includes(ip)) {
    throw new StealthBlockedError(`Blocked IP: ${ip}`);
  }
}
