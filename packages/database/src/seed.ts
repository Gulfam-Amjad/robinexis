import type { ClientConfig, PromptVersion } from "./types.js";
import type { PlatformStore } from "./memory.js";
import { getStore } from "./store.js";
import { newId } from "./memory.js";

export const SMITH_ENGLAND_ID = "client_smith_england";
export const DEMO_CLIENT_ID = "robinexis-demo";
export const BLADES_HAIR_ID = "client_blades_hair";

const callingWindow = { tz: "Europe/London", startHour: 8, endHour: 21, skipSunday: true } as const;

export function smithEnglandSeed(): ClientConfig {
  return {
    id: SMITH_ENGLAND_ID,
    slug: "smith-england-salon",
    businessName: "Smith England",
    role: "voice receptionist",
    tone: "warm, brief, natural; one useful question at a time",
    location: "Salisbury, England",
    phone: "01722 422433",
    email: "info@smithenglandhair.co.uk",
    transferNumber: process.env.FRONT_DESK_PHONE_NUMBER || "01722422433",
    voiceId: process.env.ELEVENLABS_VOICE_ID || "L4so9SudEsIYzE9j4qlR",
    voicePipeline: "elevenlabs-convai",
    services: [
      { slug: "haircut-style", title: "Haircut & Style", durationMinutes: 45 },
      { slug: "colour", title: "Colour (Highlights/Balayage/Lowlights)", durationMinutes: 90 },
      { slug: "blow-dry", title: "Blow Dry", durationMinutes: 30 },
      { slug: "mens-cut-fade", title: "Men's Cut/Fade", durationMinutes: 30 },
      { slug: "childrens-cut", title: "Children's Cut", durationMinutes: 20 },
    ],
    staff: [],
    policies: [
      "Never invent prices or opening hours — they are not published.",
      "Never invent availability; only offer slots from check_availability.",
    ],
    publishedFacts: [
      "Award-winning family-run hair salon, 35+ years.",
      "Salon Team of the Year 2025 (British Hairdressing Business Awards).",
      "Business Director of the Year 2024 (Phil Smith).",
      "Men's Hairdresser of the Year 2022 (George Smith).",
    ],
    unknownTopics: ["opening hours", "prices", "specific stylist availability"],
    calendar: {
      provider: "calcom",
      username: "",
      credentialRef: "CALCOM_API_KEY",
    },
    calendarNoteMode: "summary",
    enabledFeatures: ["inbound", "booking", "transfer"],
    inboundNumbers: [],
    callingWindow,
    maxConcurrentCalls: 4,
    outboundRatePerHour: 20,
    firstCampaignRequiresApproval: true,
    published: false,
    serviceStatus: "incomplete",
  };
}

export function robinexisDemoSeed(): ClientConfig {
  const sandbox = process.env.TWILIO_SANDBOX_PHONE_NUMBER || "";
  return {
    id: DEMO_CLIENT_ID,
    slug: DEMO_CLIENT_ID,
    businessName: "Robinexis Demo",
    role: "voice receptionist",
    tone: "warm, brief, natural; one useful question at a time",
    location: "Demo sandbox",
    phone: sandbox || "sandbox",
    email: "demo@robinexis.invalid",
    transferNumber: process.env.FRONT_DESK_PHONE_NUMBER || "+15555550100",
    voiceId: process.env.ELEVENLABS_VOICE_ID || "L4so9SudEsIYzE9j4qlR",
    voicePipeline: "groq-gateway",
    services: [
      { slug: "15min", title: "15 min meeting", durationMinutes: 15 },
      { slug: "30min", title: "30 min meeting", durationMinutes: 30 },
    ],
    staff: [],
    policies: [
      "This is a sandbox receptionist. Never invent prices or hours.",
      "Never invent availability; only offer slots from check_availability.",
    ],
    publishedFacts: ["Robinexis Option 2 demo: Groq Whisper, Groq Llama, ElevenLabs TTS, sandbox Cal.com."],
    unknownTopics: ["opening hours", "prices"],
    calendar: {
      provider: "calcom",
      username: process.env.CALCOM_USERNAME || "admin",
      credentialRef: "CALCOM_API_KEY",
    },
    calendarNoteMode: "summary",
    enabledFeatures: ["inbound", "booking", "transfer", "outbound"],
    inboundNumbers: sandbox ? [sandbox] : [],
    outboundCallerId: sandbox || undefined,
    callingWindow,
    maxConcurrentCalls: 2,
    outboundRatePerHour: 30,
    firstCampaignRequiresApproval: false,
    published: true,
    serviceStatus: "trialing",
  };
}

export function bladesHairSeed(): ClientConfig {
  const calUser = process.env.CALCOM_USERNAME || "admin";
  const sandbox = process.env.TWILIO_SANDBOX_PHONE_NUMBER || "";
  return {
    id: BLADES_HAIR_ID,
    slug: "blades-hair",
    businessName: "Blades Hair",
    role: "voice receptionist",
    greeting:
      "Hi, you've reached Blades Hair on Cullum Street — I can get you booked in or answer any questions. What can I do for you?",
    tone: "warm, professional and easy-going, like a well-liked member of the front desk; British phrasing; one or two sentences then a question",
    location: "8 Cullum Street, London, EC3M 7JJ",
    phone: "020 7623 1994",
    email: "info@bladeshair.co.uk",
    transferNumber: process.env.FRONT_DESK_PHONE_NUMBER || "02079296680",
    voiceId: process.env.ELEVENLABS_VOICE_ID || "L4so9SudEsIYzE9j4qlR",
    voicePipeline: "groq-gateway",
    hours: "Monday to Friday, 10:00am–7:00pm. Closed weekends unless the team confirms otherwise.",
    prices:
      "All prices are FROM prices. Ladies: shampoo cut & finish from £68; blow dry short/medium/long from £39/£44/£49; highlights full/half/T-section from £135/£115/£100; colour full head/regrowth from £95/£66. Gents: shampoo cut & finish from £40; shampoo & clipper from £30; clipper cut from £28; cut & beard from £57; beard trim from £20; cut & colour from £80; colour from £50; reshade from £45. Re-style, hair up, and colour correction are priced at consultation.",
    services: [
      { slug: "15min", title: "Consultation / short visit", durationMinutes: 15 },
      { slug: "30min", title: "Standard appointment", durationMinutes: 30 },
    ],
    staff: ["Galyna", "Cristina", "Jana", "Daiva", "Denise", "Stacey", "Laima"],
    policies: [
      "Never invent availability; only offer slots from check_availability.",
      "Always say FROM before any price. Never quote a price as the exact final cost.",
      "Colour and highlights only with Galyna, Jana, or Denise. Never promise a named stylist is free.",
      "Confirm service, stylist preference, day/time, from-price, name and mobile before locking a booking.",
    ],
    publishedFacts: [
      "Blades Hair is a barbering and hairdressing salon for men and women in the City of London.",
      "Address: 8 Cullum Street, London, EC3M 7JJ.",
      "Phones: 020 7623 1994 or 020 7929 6680.",
      "Open Monday to Friday 10:00am–7:00pm. Do not assume Saturday or Sunday opening.",
      "Online booking is available 24/7 with email confirmation and a reminder two hours before.",
      "All men's treatments finish with a refreshing hot towel for the face and neck, included.",
      "Colour and highlights are with Galyna, Jana or Denise. Cuts, clipper cuts, beard trims and blow-dries can be with any of the team.",
      "The team: Galyna, Cristina, Jana, Daiva, Denise, Stacey and Laima.",
    ],
    unknownTopics: ["weekend opening", "add-on treatments and extras prices", "named stylist live availability"],
    calendar: {
      provider: "calcom",
      username: calUser,
      credentialRef: "CALCOM_API_KEY",
    },
    calendarNoteMode: "summary",
    enabledFeatures: ["inbound", "booking", "transfer", "outbound"],
    inboundNumbers: sandbox ? [sandbox] : [],
    outboundCallerId: sandbox || undefined,
    callingWindow,
    maxConcurrentCalls: 2,
    outboundRatePerHour: 20,
    firstCampaignRequiresApproval: false,
    published: true,
    serviceStatus: "trialing",
  };
}

async function publishPrompt(store: PlatformStore, client: ClientConfig, compiled: string) {
  await store.upsertClient(client);
  const latest = await store.latestPrompt(client.id);
  const prompt: PromptVersion = {
    id: newId("pv_"),
    clientId: client.id,
    version: (latest?.version ?? 0) + 1,
    compiled,
    createdAt: new Date().toISOString(),
  };
  await store.savePromptVersion(prompt);
  client.promptVersionId = prompt.id;
  await store.upsertClient(client);
  return prompt;
}

export async function seedStore(store: PlatformStore) {
  const client = smithEnglandSeed();
  const prompt = await publishPrompt(
    store,
    client,
    `Smith England inbound receptionist. Success: book, transfer, or capture a callback. Never invent hours, prices, or calendar slots.`,
  );
  const demo = robinexisDemoSeed();
  await publishPrompt(
    store,
    demo,
    `Robinexis demo receptionist on the groq-gateway pipeline. Book via sandbox Cal.com only. Never invent hours, prices, or calendar slots.`,
  );
  const blades = bladesHairSeed();
  await publishPrompt(
    store,
    blades,
    `You are the voice receptionist for Blades Hair, 8 Cullum Street, London EC3M 7JJ. Open Monday to Friday 10am–7pm. Book via check_availability then create_booking only after the caller confirms. Always say FROM before any price. Colour/highlights with Galyna, Jana or Denise only. Never invent slots, extras, or weekend hours. Capture name and mobile if you cannot book.`,
  );
  return { store, client, prompt, demo, blades };
}

async function main() {
  const store = await getStore();
  const { client, demo, blades } = await seedStore(store);
  console.log("seeded", client.slug, client.id, demo.slug, demo.id, blades.slug, blades.id);
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (!geminiKey) {
    console.warn("skip blades knowledge ingest: GEMINI_API_KEY missing");
    return;
  }
  const { GeminiEmbeddingProvider, KnowledgeService } = await import("@robinexis/knowledge");
  const knowledge = new KnowledgeService(store, new GeminiEmbeddingProvider({ apiKey: geminiKey }));
  const doc = await knowledge.index({
    clientId: blades.id,
    title: "Blades Hair services, prices, hours and team",
    sourceType: "markdown",
    sourceUri: "https://bladeshair.co.uk/",
    content: `# Blades Hair
Barbering and hairdressing for men and women. 8 Cullum Street, London EC3M 7JJ.
Phones: 020 7623 1994 or 020 7929 6680.
Hours: Monday to Friday 10:00am–7:00pm. Do not assume weekend opening.

## Team
Galyna, Cristina, Jana, Daiva, Denise, Stacey, Laima.
Colour and highlights: Galyna, Jana or Denise only.

## Ladies from-prices
Shampoo cut & finish from £68. Blow dry short/medium/long from £39/£44/£49.
Highlights full/half/T-section from £135/£115/£100. Colour full head/regrowth from £95/£66.
Re-style, hair up, colour correction: priced at consultation.

## Gents from-prices
Shampoo cut & finish from £40. Shampoo & clipper from £30. Clipper cut from £28.
Cut & beard trim from £57. Beard trim from £20. Cut & colour from £80. Colour from £50. Reshade from £45.
All men's treatments include a hot towel.

Always say FROM before quoting a price. Never invent extras or named-stylist availability.
`,
  });
  console.log("indexed knowledge", doc.id, doc.status, doc.error ?? "");
}

const arg = process.argv[1] ?? "";
if (arg.endsWith("seed.ts") || arg.endsWith("seed.js")) {
  main()
    .then(() => {
      process.exitCode = 0;
      setTimeout(() => process.exit(process.exitCode ?? 0), 250).unref();
    })
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
      setTimeout(() => process.exit(1), 250).unref();
    });
}
