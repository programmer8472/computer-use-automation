const baseUrl = process.env.CONTACTS_BASE_URL ?? "http://127.0.0.1:4173";
const resetUrl = new URL("/admin/reset", baseUrl);

const response = await fetch(resetUrl, { method: "POST" });
if (!response.ok) {
  throw new Error(`Reset failed with HTTP ${response.status}`);
}

const result = (await response.json()) as {
  status: string;
  memberCount: number;
};
console.log(
  `Reset complete: ${result.memberCount} synthetic members available.`,
);
