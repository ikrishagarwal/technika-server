import "dotenv/config";
import fs from "node:fs";

import { initializeFirebase, db } from "./lib/firebase";

type Member = {
  name: string;
  phone: string;
  email: string;
};

type EventEntry = {
  tiqrBookingUid?: string;
  status?: string;
  paymentUrl?: string;
  type?: string;
  isBitStudent?: boolean;
  isDelegate?: boolean;
  isAlumni?: boolean;
  members?: Member[];
};

type RegistrationDoc = {
  name?: string;
  email?: string;
  phone?: string;
  college?: string;
  events?: Record<string, EventEntry>;
};

type Row = {
  eventId: number;
  eventCode: string;
  eventName: string;
  name: string;
  email: string;
  phone: string;
  type: string;
  membersCount: number;
  members: Member[];
  paymentStatus: string;
  college: string;
  tiqrBookingUid: string;
};

const EventIdToCodeMap: Record<number, string> = {
  // Technical
  1: "hackathon",
  2: "cp",
  3: "ampere_assemble",
  4: "robo_war",
  5: "robo_soccer",
  6: "robo_race",
  7: "tall_tower",
  8: "bridge_the_gap",
  9: "multisim_mavericks",
  10: "startup_sphere",
  11: "cad_modelling",
  12: "brain_brawl",
  13: "utility_bot",

  // Cultural
  101: "solo_saga",
  102: "exuberance",
  103: "synced_showdown",
  104: "raag_unreleased",
  105: "fusion_fiesta",
  106: "musical_marvel",
  107: "ekanki",
  108: "matargasthi",
  109: "hulchul",
  111: "kavi_sammelan",
  112: "debate",
  113: "fashion_insta",

  // Cultural (new)
  115: "street_dance",
  116: "pencil_perfection",
  117: "wall_painting",

  // Frame & Focus
  118: "motion_e_magic",
  119: "capture_the_unseen",
  120: "poetry_english",
  121: "poetry_hindi",

  // ESports
  301: "bgmi",
  302: "valorant",
  303: "fifa",
  304: "tekken",
  305: "cricket",
};

function toHumanReadableEventName(eventCode: string): string {
  // Keep the underlying code unchanged; this is only for display.
  const spaced = eventCode.replace(/_/g, " ");
  return spaced
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function normalizeIndianPhone(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";

  // If caller already provided any explicit country code (e.g. +91), keep as-is.
  if (s.startsWith("+")) return s;

  // Keep only digits for normalization decisions.
  const digits = s.replace(/\D/g, "");
  if (!digits) return "";

  // If the number already starts with country code 91 (without +), add only '+'.
  if (digits.startsWith("91") && digits.length >= 12) return `+${digits}`;

  // Otherwise, prefix +91.
  return `+91 ${digits}`;
}

function printUsage() {
  // Keep this minimal and copy-paste friendly.
  console.log(
    `\nUsage:\n  pnpm tsx src/list.ts [options]\n\nOptions:\n  --out=path                  Write output to a file (default: stdout)\n  --eventId=NUMBER             Only include a specific eventId\n  --status=STRING              Only include a specific payment status (e.g. confirmed)\n  --includePending=true|false  Include pending/failed (default: true)\n\nFirebase auth:\n  Set SERVICE_ACCOUNT_KEY as a JSON string (same as server).\n`
  );
}

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const [k, ...rest] = raw.slice(2).split("=");
    const v = rest.join("=");
    if (rest.length === 0) {
      args[k] = true;
    } else if (v === "true" || v === "false") {
      args[k] = v === "true";
    } else {
      args[k] = v;
    }
  }
  return args;
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[\n\r,\"]/g.test(s)) return `"${s.replace(/\"/g, '""')}"`;
  return s;
}

function rowsToCsv(rows: Row[]): string {
  const maxMembers = rows.reduce(
    (max, row) => Math.max(max, row.members.length),
    0
  );

  const headers: string[] = [
    "eventId",
    "eventCode",
    "eventName",
    "name",
    "email",
    "phone",
    "type",
    "membersCount",
    "paymentStatus",
    "college",
    "tiqrBookingUid",
  ];

  for (let i = 1; i <= maxMembers; i++) {
    headers.push(`member${i}_name`, `member${i}_email`, `member${i}_phone`);
  }

  const lines: string[] = [];
  lines.push(headers.join(","));
  for (const row of rows) {
    const values: unknown[] = [
      row.eventId,
      row.eventCode,
      row.eventName,
      row.name,
      row.email,
      normalizeIndianPhone(row.phone),
      row.type,
      row.membersCount,
      row.paymentStatus,
      row.college,
      row.tiqrBookingUid,
    ];

    for (let i = 0; i < maxMembers; i++) {
      const member = row.members[i];
      values.push(
        member?.name || "",
        member?.email || "",
        normalizeIndianPhone(member?.phone)
      );
    }

    lines.push(values.map((v) => csvEscape(v)).join(","));
  }
  return lines.join("\n") + "\n";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printUsage();
    return;
  }

  const outPath = typeof args.out === "string" ? args.out : "";
  const eventIdFilter =
    typeof args.eventId === "string" && args.eventId.trim().length
      ? Number(args.eventId)
      : undefined;
  if (eventIdFilter !== undefined && Number.isNaN(eventIdFilter)) {
    console.error(`Invalid --eventId: ${String(args.eventId)}`);
    process.exitCode = 2;
    return;
  }

  const statusFilter =
    typeof args.status === "string" && args.status.trim().length
      ? args.status.trim()
      : undefined;

  const includePending =
    typeof args.includePending === "boolean" ? args.includePending : true;

  if (!process.env.SERVICE_ACCOUNT_KEY) {
    console.error(
      "Missing SERVICE_ACCOUNT_KEY env var (must be the full Firebase service account JSON string)."
    );
    printUsage();
    process.exitCode = 2;
    return;
  }

  initializeFirebase();

  const snap = await db.collection("event_registrations").get();
  const rows: Row[] = [];

  for (const doc of snap.docs) {
    const data = doc.data() as RegistrationDoc;
    const events = data.events || {};

    for (const [eventIdStr, entry] of Object.entries(events)) {
      const eventId = Number(eventIdStr);
      if (!Number.isFinite(eventId)) continue;

      const paymentStatus = entry?.status || "";
      if (!includePending && paymentStatus !== "confirmed") continue;
      if (statusFilter && paymentStatus !== statusFilter) continue;
      if (eventIdFilter !== undefined && eventId !== eventIdFilter) continue;

      const members = Array.isArray(entry?.members) ? entry.members : [];
      const eventCode = EventIdToCodeMap[eventId] || "";
      const eventName = eventCode ? toHumanReadableEventName(eventCode) : "";

      rows.push({
        eventId,
        eventCode,
        eventName,
        name: data.name || "",
        email: data.email || "",
        phone: normalizeIndianPhone(data.phone),
        type: entry?.type || "",
        membersCount: members.length,
        members: members.map((m) => ({
          name: String(m?.name || ""),
          email: String(m?.email || ""),
          phone: normalizeIndianPhone(m?.phone),
        })),
        paymentStatus,
        college: data.college || "",
        tiqrBookingUid: entry?.tiqrBookingUid || "",
      });
    }
  }

  // Stable ordering makes diffs / comparisons easier.
  rows.sort((a, b) => {
    if (a.eventId !== b.eventId) return a.eventId - b.eventId;
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) return byName;
    return a.email.localeCompare(b.email);
  });

  const output = rowsToCsv(rows);

  if (outPath) {
    fs.writeFileSync(outPath, output, "utf8");
    console.log(`Wrote ${rows.length} rows to ${outPath}`);
  } else {
    process.stdout.write(output);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
