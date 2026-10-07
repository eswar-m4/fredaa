import fs from "node:fs";
import path from "node:path";
import type { Estimate, IntentFamily, JobRecord, Requirement } from "@/lib/freda/types";

const JOBS_PATH = path.join(process.cwd(), "data", "jobs.json");

function readJobs(): JobRecord[] {
  try {
    const raw = fs.readFileSync(JOBS_PATH, "utf8");
    return JSON.parse(raw) as JobRecord[];
  } catch {
    return [];
  }
}

function writeJobs(jobs: JobRecord[]) {
  fs.mkdirSync(path.dirname(JOBS_PATH), { recursive: true });
  fs.writeFileSync(JOBS_PATH, JSON.stringify(jobs, null, 2));
}

export function listJobs(): JobRecord[] {
  return readJobs().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createJob(input: {
  title: string;
  requirement: Requirement;
  family: IntentFamily;
  estimate: Estimate;
}): JobRecord {
  const jobs = readJobs();
  const stamp = new Date();
  const ymd = stamp.toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  const job: JobRecord = {
    id: `AF-${ymd}-${suffix}`,
    createdAt: stamp.toISOString(),
    status: "Pending Onboarding",
    title: input.title,
    requirement: input.requirement,
    family: input.family,
    estimate: input.estimate,
    origin: "Ask Freda",
  };
  jobs.push(job);
  writeJobs(jobs);
  return job;
}
