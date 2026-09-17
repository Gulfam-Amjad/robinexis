import { ArrowLeft, ExternalLink, MapPin, Phone, Sparkles } from "lucide-react";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Logo } from "../components/layout";
import { ReceptionistCall } from "../components/ReceptionistCall";
import { BLADES_RECEPTIONIST_DEMO } from "../lib/receptionistDemo";
import { canAccessProduct } from "../lib/routing";
import { selectedPlan } from "../lib/supabase";
import { useSession } from "../state";

export default function BladesReceptionistDemoPage() {
  const { actor } = useSession();
  const plan = selectedPlan();
  const accountAction = actor
    ? {
        to: canAccessProduct(actor) ? "/dashboard" : `/billing${plan ? `?plan=${plan}` : ""}`,
        label: canAccessProduct(actor) ? "Open dashboard" : "Choose a plan",
      }
    : { to: "/login", label: "Log in" };

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Meet Sophie | Blades Hair AI Receptionist by Robinexis";
    let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const created = !robots;
    if (!robots) {
      robots = document.createElement("meta");
      robots.name = "robots";
      document.head.appendChild(robots);
    }
    const previousRobots = robots.content;
    robots.content = "noindex,nofollow";
    return () => {
      document.title = previousTitle;
      if (created) robots?.remove();
      else if (robots) robots.content = previousRobots;
    };
  }, []);

  return (
    <div className="receptionist-demo-page">
      <a className="skip-link" href="#receptionist-demo">Skip to voice demo</a>
      <header className="demo-header">
        <Logo />
        <div className="demo-header-label">
          <span />
          <p>Interactive client demo</p>
        </div>
        <div className="demo-header-actions">
          <Link className="button button-primary button-sm" to={accountAction.to}>{accountAction.label}</Link>
          <a className="button button-secondary button-sm" href={`tel:${BLADES_RECEPTIONIST_DEMO.phone}`}>
            <Phone size={14} /> Call the phone line
          </a>
        </div>
      </header>

      <main id="receptionist-demo">
        <section className="demo-hero-copy">
          <div>
            <span className="demo-kicker"><Sparkles size={14} /> Powered by Robinexis</span>
            <h1>Meet Sophie, the AI receptionist for <em>Blades Hair.</em></h1>
            <p>
              Ask a question, interrupt naturally, or book an appointment. Sophie answers with the
              salon&apos;s voice and checks the live demo diary while you talk.
            </p>
          </div>
          <div className="demo-salon-facts">
            <span><MapPin /> {BLADES_RECEPTIONIST_DEMO.location}</span>
            <span><Phone /> {BLADES_RECEPTIONIST_DEMO.phoneDisplay}</span>
          </div>
        </section>

        <ReceptionistCall showShare />

        <section className="demo-proof-strip" aria-label="Demo capabilities">
          <article><strong>Fast, natural conversation</strong><span>Built for interruptions, pauses and real callers.</span></article>
          <article><strong>Salon-trained answers</strong><span>Services, team, opening hours and FROM prices.</span></article>
          <article><strong>Real booking actions</strong><span>Checks availability and confirms appointments while you speak.</span></article>
        </section>
      </main>

      <footer className="demo-footer">
        <div>
          <Logo light />
          <p>AI receptionists that answer, help and book.</p>
        </div>
        <div>
          <Link to="/"><ArrowLeft /> Back to Robinexis</Link>
          <a href="mailto:hello@robinexis.com">Build one for your business <ExternalLink /></a>
        </div>
      </footer>
    </div>
  );
}
