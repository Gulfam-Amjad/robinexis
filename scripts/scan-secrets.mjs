import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const patterns = [
  { name: "Firecrawl API key", regex: /\bfc-[A-Za-z0-9_-]{24,}\b/g },
  { name: "Stripe secret key", regex: /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/g },
  { name: "GitHub token", regex: /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/g },
  { name: "Groq API key", regex: /\bgsk_[A-Za-z0-9]{20,}\b/g },
  { name: "Resend API key", regex: /\bre_[A-Za-z0-9_]{20,}\b/g },
  { name: "AWS access key", regex: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { name: "Private key", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
];

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" },
)
  .split(/\r?\n/)
  .filter(Boolean);

const findings = [];
for (const file of files) {
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(content)) findings.push(`${file}: ${pattern.name}`);
  }
}

if (findings.length) {
  console.error("Secret scan failed:\n" + findings.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}
console.log(`Secret scan passed (${files.length} files checked).`);
