/**
 * Audits the CTA destinations on the published Framer marketing site.
 *
 * Framer inlines one copy of the nav, pricing block and CTA section per
 * breakpoint, so a CTA fixed only on the desktop canvas still ships broken.
 * Every copy is checked and counted here. Run before and after the Framer
 * agent applies "os/guides/Framer CTA Wiring Prompt.md".
 */

const SITE = process.argv[2] || "https://www.robinexis.com";
const APP = "https://app.robinexis.com";

// Visible CTA label -> the only destination that label may carry.
const EXPECTED = [
  { label: "Sign Up", href: `${APP}/signup` },
  { label: "Log in", href: `${APP}/login` },
  { label: "Book a call", href: `${APP}/demo/blades-hair` },
  { label: "Book a demo", href: `${APP}/demo/blades-hair` },
  { label: "Calculate my recovery", href: `${APP}/demo/blades-hair` },
  { label: "More articles", href: "./blog" },
];

// "Start free trial" appears on Starter, Pro and the bottom CTA, so its plan
// cannot be derived from the label alone. Both plan URLs are accepted.
const PLAN_CTA = {
  label: "Start free trial",
  allowed: [`${APP}/signup?plan=starter`, `${APP}/signup?plan=pro`],
};

const html = await fetch(SITE, { headers: { "user-agent": "robinexis-link-audit" } })
  .then((response) => {
    if (!response.ok) throw new Error(`${SITE} returned ${response.status}`);
    return response.text();
  });

/** Lowercase, drop arrow glyphs and punctuation, and collapse the duplicate
 * label layer Framer renders for the hover state, so "Sign Up Sign Up" and
 * "Calculate my recovery ↗" both compare cleanly against a plain label. */
function label(markup) {
  const words = markup
    .replace(/<[^>]+>/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return [...new Set(words)].join(" ");
}

const anchors = [...html.matchAll(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((match) => ({
  href: match[1],
  text: label(match[2]),
}));

const failures = [];
const report = [];

for (const cta of EXPECTED) {
  const matched = anchors.filter((anchor) => anchor.text === label(cta.label));
  const wrong = matched.filter((anchor) => anchor.href !== cta.href);
  report.push({ cta: cta.label, expected: cta.href, copies: matched.length, wrong: wrong.length });
  if (!matched.length) failures.push(`"${cta.label}" is not a link on ${SITE}`);
  for (const anchor of wrong) {
    failures.push(`"${cta.label}" points at ${anchor.href} — expected ${cta.href}`);
  }
}

const planCopies = anchors.filter((anchor) => anchor.text === label(PLAN_CTA.label));
const planWrong = planCopies.filter((anchor) => !PLAN_CTA.allowed.includes(anchor.href));
report.push({
  cta: PLAN_CTA.label,
  expected: PLAN_CTA.allowed.join(" | "),
  copies: planCopies.length,
  wrong: planWrong.length,
});
for (const anchor of planWrong) {
  failures.push(`"${PLAN_CTA.label}" points at ${anchor.href} — expected a ${APP}/signup?plan= URL`);
}

console.table(report);

const contactLinks = anchors.filter((anchor) => anchor.href === "./contact");
console.log(
  `\n${contactLinks.length} link(s) resolve to ./contact:`,
  [...new Set(contactLinks.map((anchor) => anchor.text || "(no label)"))].join(", ") || "none",
);
console.log('Only the "Contact" nav item and the footer Contact link should appear above.');

if (failures.length) {
  console.error(`\n${failures.length} problem(s):`);
  for (const failure of [...new Set(failures)]) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("\nEvery audited CTA points at its expected destination.");
