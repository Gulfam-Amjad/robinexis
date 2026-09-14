import { Link } from "react-router-dom";
import { PublicHeader } from "../components/layout";

const sections = {
  privacy: {
    title: "Privacy policy",
    updated: "13 September 2026",
    intro: "This policy explains how Robinexis handles account, business and call data when providing its AI receptionist service.",
    items: [
      ["What we collect", "Account identity, business configuration, booking information, call metadata and conversation records needed to operate and improve the service."],
      ["Why we use it", "To provide the contracted service, secure accounts, process payments, support customers, prevent abuse and meet legal obligations."],
      ["Service providers", "Robinexis uses Supabase, Railway, Vercel, Stripe, ElevenLabs, Twilio and connected calendar providers as subprocessors where required."],
      ["Retention and security", "Access is tenant-scoped. Call records are retained for the configured service period, normally 90 days, unless a different contractual or legal period applies."],
      ["Your choices", "You may request access, correction, export or deletion by emailing hello@robinexis.com. Some records must be retained for billing, security or legal reasons."],
    ],
  },
  terms: {
    title: "Service terms",
    updated: "13 September 2026",
    intro: "These terms describe the current Robinexis subscription and operator-assisted setup service.",
    items: [
      ["Subscription", "Starter and Pro are monthly subscriptions. A payment method is required for the three-day trial; billing starts when the trial ends unless cancelled through Stripe."],
      ["Setup and activation", "Customers submit approved business details after checkout. Robinexis reviews and completes activation before live calls are enabled."],
      ["Customer responsibilities", "Customers must provide accurate business information, lawful call instructions, appropriate consent and calendar access they are authorised to share."],
      ["Availability", "Robinexis uses reasonable care to provide the service but does not guarantee uninterrupted telephony, third-party platforms or booking availability."],
      ["Support and cancellation", "Manage billing through the product or contact hello@robinexis.com. Cancellation affects future renewal and does not erase records that must be retained."],
    ],
  },
} as const;

export default function LegalPage({ kind }: { kind: keyof typeof sections }) {
  const content = sections[kind];
  return (
    <div className="public-page">
      <PublicHeader />
      <main className="legal-main" id="main-content">
        <span className="eyebrow">Robinexis legal</span>
        <h1>{content.title}</h1>
        <p className="legal-updated">Last updated {content.updated} · Draft for solicitor review</p>
        <p className="legal-intro">{content.intro}</p>
        <div className="legal-sections">
          {content.items.map(([title, body]) => (
            <section key={title}>
              <h2>{title}</h2>
              <p>{body}</p>
            </section>
          ))}
        </div>
        <p className="legal-contact">
          Questions? <a href="mailto:hello@robinexis.com">Email Robinexis</a> or{" "}
          <Link to="/pricing">view plans</Link>.
        </p>
      </main>
    </div>
  );
}
