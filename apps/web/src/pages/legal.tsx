import { Link } from "react-router-dom";
import { PublicFooter, PublicHeader } from "../components/layout";
import { ROBINEXIS_COMPANY } from "../lib/companyLegal";

type LegalKind = "privacy" | "terms" | "gdpr" | "cookies" | "dpa";
type LegalSection = { title: string; body: readonly string[] };

const sections: Record<LegalKind, {
  title: string;
  intro: string;
  contact: string;
  items: readonly LegalSection[];
}> = {
  privacy: {
    title: "Privacy Policy",
    intro: "This policy explains how ROBINEXIS LTD collects, uses, stores and protects personal data when you visit our website, contact us, subscribe, or use our AI receptionist services.",
    contact: ROBINEXIS_COMPANY.privacyEmail,
    items: [
      { title: "1. Who we are", body: ["ROBINEXIS LTD provides management software, AI-enabled receptionist workflows, automation, consultancy and related technology services. We act as controller where we decide how and why data is processed, and as processor where we handle data on a business client's documented instructions."] },
      { title: "2. Personal data we collect", body: ["We may process names, email addresses, phone numbers, business and job details, account information, booking data, billing records, support correspondence, call metadata, transcripts or summaries where enabled, IP addresses, device information, cookies, analytics and service usage data.", "Clients may connect customer, lead, staff, CRM, calendar, messaging or call data. Clients must have the rights and lawful basis needed to provide that data."] },
      { title: "3. How we collect it", body: ["We collect data when you visit our sites, create an account, submit a form, subscribe, book a call, contact us, pay for or use the service, connect a third-party system, or work with us as a client, supplier, contractor or partner."] },
      { title: "4. Why we use it", body: ["We use data to respond to enquiries, deliver and support the service, manage accounts and subscriptions, process bookings and communications, improve reliability, secure systems, prevent misuse, keep business records and meet legal, tax and regulatory obligations."] },
      { title: "5. Lawful bases", body: ["Depending on the circumstances, we rely on contract, legitimate interests, consent, legal obligation, or the establishment and defence of legal claims. Optional marketing and non-essential cookies are used only where the required consent exists."] },
      { title: "6. Marketing", body: ["We may send product news and relevant updates where permitted. You can unsubscribe at any time. We do not sell personal data to third parties for marketing."] },
      { title: "7. Cookies and analytics", body: ["Essential technologies keep the service secure and functional. Optional analytics, functionality or advertising technologies require a clear choice where the law requires one. See our Cookie Policy for more information."] },
      { title: "8. Service providers", body: ["We may use vetted providers for cloud hosting, authentication, payments, telephony, speech and AI processing, email, CRM, calendars, messaging, analytics, monitoring and professional advice. Current core providers may include Supabase, Railway, Vercel, Stripe, Twilio, ElevenLabs, LiveKit, Deepgram, Groq and connected calendar providers.", "Providers acting for us must apply appropriate confidentiality, security and data-processing safeguards."] },
      { title: "9. International transfers", body: ["Where data is processed outside the United Kingdom, we use an available lawful safeguard such as adequacy regulations, the UK International Data Transfer Agreement, standard contractual clauses or a UK addendum."] },
      { title: "10. Retention", body: ["We keep data only as long as reasonably needed for the purpose collected, contractual commitments, security, accounting, tax and legal requirements. Call records are normally retained for the configured service period, commonly 90 days, unless a contract or legal need requires otherwise. Data is deleted, anonymised or securely disposed of when no longer required."] },
      { title: "11. Security", body: ["We use proportionate controls including tenant-scoped access, authentication, restricted privileges, encryption where appropriate, secure cloud systems, backups, logging, supplier review and incident response. No system is completely risk-free."] },
      { title: "12. Your rights", body: ["Under UK data protection law, you may have rights to information, access, correction, deletion, restriction, objection, portability, withdrawal of consent and objection to direct marketing. We may verify identity before responding.", "You may also complain to the Information Commissioner's Office."] },
      { title: "13. AI and automation", body: ["We apply data protection by design and seek to minimise personal data used by AI and automation. We do not intend to make solely automated decisions producing legal or similarly significant effects unless the use is lawful and appropriate safeguards are in place."] },
      { title: "14. Third-party links and updates", body: ["Third-party sites have their own privacy practices. We may update this policy when our services, suppliers or legal obligations change; the latest version will be published here."] },
    ],
  },
  terms: {
    title: "Terms & Conditions",
    intro: "These terms govern the ROBINEXIS LTD website and self-serve subscription service. By using the website or starting a subscription, you agree to them.",
    contact: ROBINEXIS_COMPANY.generalEmail,
    items: [
      { title: "1. About us and scope", body: ["This website and service are operated by ROBINEXIS LTD. These terms apply to website use and self-serve subscriptions. A signed order form, service agreement, proposal, statement of work or Data Processing Agreement takes priority where it conflicts with these terms."] },
      { title: "2. Website information and enquiries", body: ["Website content is general information, not professional, legal or financial advice. We try to keep it accurate but do not guarantee it is complete or suitable for every business. An enquiry does not create a client relationship or oblige us to provide services."] },
      { title: "3. Subscription, trial and payment", body: ["Starter and Pro are monthly subscriptions. A payment method is required for the three-day trial. Unless cancelled before the trial ends, Stripe will charge the selected monthly price and renew the subscription until cancelled.", "Prices exclude VAT where applicable. Price changes apply as described at checkout or in a separate notice."] },
      { title: "4. Setup and activation", body: ["Customers submit approved business details after checkout. Robinexis may review configuration before live calls are enabled. Setup timing depends on accurate information, authorised access and third-party availability."] },
      { title: "5. Cancellation", body: ["You may manage billing through the product or Stripe portal. Cancellation stops future renewal but does not normally refund the current period or erase records that must be retained for billing, security or legal purposes. Statutory rights are not affected."] },
      { title: "6. Customer responsibilities", body: ["You must provide accurate information, lawful call instructions, appropriate notices and consents, and access only to systems you are authorised to share. You are responsible for reviewing your configuration and AI-assisted outputs before relying on them."] },
      { title: "7. AI and automation", body: ["AI, speech and automation can misunderstand, omit or generate incorrect information. The service uses approved business facts and booking tools, but human review and escalation remain important. You must not use the service for unlawful, fraudulent, harmful, discriminatory, abusive or malicious activity."] },
      { title: "8. Acceptable use", body: ["You must not attempt unauthorised access, introduce malware, interfere with service performance, send spam, violate another person's rights, or use Robinexis in a way that damages users, providers, systems or reputation."] },
      { title: "9. Third-party services and availability", body: ["The service depends on third-party telephony, AI, payment, hosting, messaging and calendar platforms. We use reasonable care but do not guarantee uninterrupted, secure or error-free availability, or that a third party will accept every call, payment or booking."] },
      { title: "10. Intellectual property", body: ["Robinexis branding, software, designs and website content belong to ROBINEXIS LTD or its licensors. You retain ownership of your business and customer data and grant us the rights needed to provide the service."] },
      { title: "11. Liability", body: ["Nothing excludes liability that cannot lawfully be excluded. To the fullest extent permitted by law, we are not liable for indirect or consequential loss, loss of profit, revenue, goodwill or opportunity, third-party failures, misuse, or reliance on general website information. Paid-service liability may be further governed by a separate agreement."] },
      { title: "12. Privacy and data processing", body: ["Our Privacy Policy, Cookie Policy and Data Processing Agreement explain how personal data and client-controlled data are handled."] },
      { title: "13. Changes, law and jurisdiction", body: ["We may update these terms and will publish the current version here. These terms are governed by the laws of England and Wales, whose courts have exclusive jurisdiction."] },
    ],
  },
  gdpr: {
    title: "GDPR & Data Protection",
    intro: "This page explains Robinexis's role, safeguards and responsibilities under UK data protection law.",
    contact: ROBINEXIS_COMPANY.privacyEmail,
    items: [
      { title: "1. Controller and processor roles", body: ["We act as controller for our website, account, sales, billing and business-administration data. We act as processor where a client instructs us to handle customer, booking, CRM, messaging, scheduling or call data through the service."] },
      { title: "2. Data and purposes", body: ["Depending on the service, we process identity, contact, account, payment, booking, communication, call, technical and usage data to provide, secure, support and improve the agreed service and meet legal obligations."] },
      { title: "3. Lawful processing", body: ["Controllers are responsible for an appropriate lawful basis and required notices. Robinexis relies on contract, legitimate interests, consent, legal obligation or legal claims where applicable."] },
      { title: "4. Data protection by design", body: ["We seek to minimise data, restrict tenant access, protect credentials, use appropriate encryption and retention, review suppliers and maintain incident-response processes."] },
      { title: "5. Rights and requests", body: ["Individuals may have rights of access, correction, deletion, restriction, objection, portability and withdrawal of consent. Requests concerning client-controlled data may be referred to the relevant client as controller."] },
      { title: "6. Subprocessors and transfers", body: ["We use service providers under appropriate contractual and security controls. International transfers use a lawful UK safeguard where required. A current subprocessor list is available on request."] },
      { title: "7. Complaints", body: ["Contact us first so we can investigate. You also have the right to complain to the Information Commissioner's Office."] },
    ],
  },
  cookies: {
    title: "Cookie Policy",
    intro: "This policy explains how ROBINEXIS LTD uses cookies and similar browser technologies.",
    contact: ROBINEXIS_COMPANY.privacyEmail,
    items: [
      { title: "1. What cookies are", body: ["Cookies are small files stored on a device. Similar technologies include local storage, pixels, scripts, tags and device identifiers."] },
      { title: "2. Essential technologies", body: ["We use essential technologies where needed for authentication, security, navigation, form submission, load balancing, fraud prevention and remembering privacy choices. The service may not work correctly if these are blocked."] },
      { title: "3. Optional technologies", body: ["Analytics technologies help us understand service performance and engagement. Functionality technologies remember optional preferences. Advertising technologies may measure campaigns or personalise marketing. We do not place non-essential technologies before the consent required by law."] },
      { title: "4. Third parties", body: ["Hosting, authentication, analytics, scheduling, payment, embedded media and support providers may set technologies when their features are used. Their own policies explain their processing."] },
      { title: "5. Your choices", body: ["Where optional cookies are enabled, you can accept, reject or adjust categories through the available consent controls and browser settings. Withdrawing consent does not affect earlier lawful processing."] },
      { title: "6. Updates", body: ["We update this policy when the technologies, providers or legal requirements change. We publish verified cookie details through the consent tool rather than listing unverified template entries."] },
    ],
  },
  dpa: {
    title: "Data Processing Agreement",
    intro: "This summary explains how ROBINEXIS LTD processes personal data for business clients. A signed DPA is available on request and takes priority over this summary.",
    contact: ROBINEXIS_COMPANY.privacyEmail,
    items: [
      { title: "1. Application and instructions", body: ["Where a client is controller and Robinexis is processor, we process personal data only to provide the agreed services and on documented lawful instructions, unless law requires otherwise."] },
      { title: "2. Client responsibilities", body: ["The client must have a lawful basis, provide required notices, hold the rights needed to connect data, issue lawful instructions and limit supplied data to what is accurate and necessary."] },
      { title: "3. Robinexis responsibilities", body: ["We maintain confidentiality, proportionate security, subprocessor controls and assistance with rights requests, breaches and impact assessments. We delete or return data at the end of services unless lawful retention applies."] },
      { title: "4. Data and processing", body: ["Processing may cover names, contact details, customer and lead information, bookings, CRM records, messages, call metadata, transcripts or summaries, support records, account data and technical logs for communications, scheduling, AI workflows, analytics, security and support."] },
      { title: "5. Subprocessors and transfers", body: ["We use vetted infrastructure, AI, telephony, messaging, payment, analytics and support providers under appropriate safeguards. International transfers use an available lawful UK transfer mechanism."] },
      { title: "6. Security and incidents", body: ["Measures may include access controls, restricted privileges, authentication, encryption, backups, logging, monitoring, supplier review and incident response. We notify the relevant client without undue delay after becoming aware of a qualifying personal data breach."] },
      { title: "7. Rights, deletion and audit support", body: ["We reasonably assist the client with data-subject requests and compliance information. At the end of service, data is deleted or returned according to documented instructions unless legal, accounting, security or dispute requirements justify retention."] },
      { title: "8. Signed agreement", body: ["Clients requiring a signed DPA, processing schedule or current subprocessor list should contact the privacy team."] },
    ],
  },
} as const;

export default function LegalPage({ kind }: { kind: LegalKind }) {
  const content = sections[kind];
  return (
    <div className="public-page">
      <PublicHeader />
      <main className="legal-main" id="main-content">
        <span className="eyebrow">Robinexis legal</span>
        <h1>{content.title}</h1>
        <p className="legal-updated">Last updated {ROBINEXIS_COMPANY.policyUpdated}</p>
        <p className="legal-intro">{content.intro}</p>
        <section className="legal-company">
          <strong>{ROBINEXIS_COMPANY.legalName}</strong>
          <span>Company number {ROBINEXIS_COMPANY.companyNumber}</span>
          <span>{ROBINEXIS_COMPANY.registeredOffice}</span>
        </section>
        <div className="legal-sections">
          {content.items.map((item) => (
            <section key={item.title}>
              <h2>{item.title}</h2>
              {item.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </section>
          ))}
        </div>
        <p className="legal-contact">
          Questions? <a href={`mailto:${content.contact}`}>{content.contact}</a> or{" "}
          <Link to="/pricing">view plans</Link>.
        </p>
      </main>
      <PublicFooter />
    </div>
  );
}
