import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { spawn } from "child_process";
import path from "path";

const Input = z.object({
  pairs: z.array(z.tuple([z.string(), z.string()])).max(200),
});

function spawnPython(scriptPath: string, stdinJson: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const python = process.platform === "win32" ? "python" : "python3";
    const child = spawn(python, [scriptPath], {
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`contact extractor exited ${code}: ${stderr.slice(0, 500)}`));
      } else {
        resolve(stdout);
      }
    });
    child.stdin.write(stdinJson);
    child.stdin.end();
  });
}

export const runContactExtraction = createServerFn({ method: "POST" })
  .inputValidator(Input)
  .handler(async ({ data }) => {
    // process.cwd() is the customer/ directory (set via ecosystem.config.cjs cwd: '.')
    const script = path.join(process.cwd(), "run_contact_extractor.py");
    const raw = await spawnPython(script, JSON.stringify({ pairs: data.pairs }));
    let parsed: { contacts?: unknown[]; error?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`contact extractor returned non-JSON: ${raw.slice(0, 300)}`);
    }
    if (parsed.error) throw new Error(parsed.error);
    return { contacts: (parsed.contacts ?? []) as Record<string, string>[] };
  });
