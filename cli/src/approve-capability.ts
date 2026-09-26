import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  approveCapability,
  verifyApprovedCapability,
} from "@computer-use/compiler";

const arguments_ = parseArguments(process.argv.slice(2));
const draft = JSON.parse(
  await readFile(arguments_.capability, "utf8"),
) as unknown;
const approved = approveCapability(draft, arguments_.approvedBy);
const verification = verifyApprovedCapability(approved);
if (!verification.valid) {
  throw new Error(verification.reason);
}

await mkdir(dirname(arguments_.out), { recursive: true });
await writeFile(arguments_.out, `${JSON.stringify(approved, null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx",
});
process.stdout.write(`Approved capability written to ${arguments_.out}\n`);

function parseArguments(values: string[]): {
  capability: string;
  approvedBy: string;
  out: string;
} {
  const parsed = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (name?.startsWith("--") !== true || value === undefined) {
      throw new Error("Arguments must be supplied as --name value pairs");
    }
    parsed.set(name.slice(2), value);
  }
  const capability = parsed.get("capability");
  const approvedBy = parsed.get("approved-by");
  if (capability === undefined || approvedBy === undefined) {
    throw new Error(
      "Usage: npm run capability:approve -- --capability <draft.json> --approved-by <reviewer> [--out <approved.json>]",
    );
  }
  return {
    capability,
    approvedBy,
    out: parsed.get("out") ?? "capabilities/contact-update.approved.json",
  };
}
