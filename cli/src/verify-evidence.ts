import { join } from "node:path";

import { verifySubmissionEvidence } from "./evidence-verifier.js";

const rootDirectory = join(process.cwd(), "evidence", "submission");
const verification = await verifySubmissionEvidence(rootDirectory);

for (const packageName of verification.packages) {
  process.stdout.write(`PASS ${packageName}\n`);
}
if (!verification.valid) {
  for (const error of verification.errors) {
    process.stderr.write(`FAIL ${error}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Verified ${verification.packages.length} evidence packages; manifest digests and privacy scan passed.\n`,
  );
}
