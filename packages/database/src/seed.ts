import type { ClientConfig, PromptVersion } from "./types.js";
import type { PlatformStore } from "./memory.js";
import { getStore } from "./store.js";
import { newId } from "./memory.js";

export const SMITH_ENGLAND_ID = "client_smith_england";
export const DEMO_CLIENT_ID = "robinexis-demo";

const callingWindow = { tz: "Europe/London", startHour: 8, endHour: 21, skipSunday: true } as const;

export function smithEnglandSeed(): ClientConfig {
  const production = Boolean(process.env.RAILWAY_ENVIRONMENT);
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
    published: !production,
    serviceStatus: production ? "incomplete" : "trialing",
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
      username: "admin",
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
  return { store, client, prompt, demo };
}

async function main() {
  const store = await getStore();
  const { client, demo } = await seedStore(store);
  console.log("seeded", client.slug, client.id, demo.slug, demo.id);
}

const arg = process.argv[1] ?? "";
if (arg.endsWith("seed.ts") || arg.endsWith("seed.js")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
