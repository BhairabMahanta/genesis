#!/usr/bin/env node
/**
 * Seeds a demo account and a ready-to-annotate Assamese WSD workspace through the running API.
 *
 *   pnpm seed:demo                 # API at http://localhost:8099 (override with API_URL)
 *
 * Safe to re-run: it logs in if the account exists and skips a workspace it already created.
 * Development only. The password below is public.
 *
 * The sense glosses are drafts for demonstration. Verify them against Hemkosh before real use.
 */
const API = process.env.API_URL ?? `http://localhost:${process.env.API_PORT ?? 8099}`;
const WEB = process.env.WEB_URL ?? `http://localhost:${process.env.WEB_PORT ?? 3000}`;

const DEMO = {
  username: "demo",
  email: "demo@genesis.local",
  password: "Demo@12345",
  firstName: "Demo",
  lastName: "Annotator",
};
const WORKSPACE = "Hemkosh WSD Demo (Assamese)";

const DOCS = [
  {
    name: "asm_wsd_demo_01.txt",
    text: [
      "মানুহজনে বহু কাল ধৰি এই গাঁওখনত বাস কৰি আছে।",
      "কাল আমি নগৰলৈ যাম।",
      "তেওঁ মুখ ধুই ভাত খালে।",
      "বাঘটোৱে মুখ মেলি গৰ্জন কৰিলে।",
      "চৰাইজনী ডাল এৰি উৰি গ'ল।",
      "আমাৰ ঘৰত দুপৰীয়া ডাল, শাক আৰু ভাত আছিল।",
    ].join(" "),
  },
  {
    name: "asm_wsd_demo_02.txt",
    text: [
      "এই কাপোৰৰ ৰং বৰ সুন্দৰ।",
      "ৰঙালী বিহুৰ দিনা গাঁৱত বৰ ৰং-ৰস হ'ল।",
      "বৰ আহি পালে, সকলোৱে বৰক বৰণ কৰিলে।",
      "এইখন বৰ নদী।",
    ].join(" "),
  },
];

const SENSES = [
  { word: "কাল", senseLabel: "সময়/যুগ", gloss: "নিৰ্দিষ্ট সময়ৰ ব্যাপ্তি বা যুগ।", examples: "বহু কাল ধৰি" },
  { word: "কাল", senseLabel: "গতকাল / কাইলৈ", gloss: "ইয়াৰ আগৰ দিন বা পিছৰ দিন।", examples: "কাল আমি নগৰলৈ যাম" },
  { word: "মুখ", senseLabel: "মুখমণ্ডল", gloss: "মানুহৰ মূৰৰ সন্মুখৰ অংশ।", examples: "তেওঁ মুখ ধুই ভাত খালে" },
  { word: "মুখ", senseLabel: "মুখগহ্বৰ", gloss: "খাদ্য গ্ৰহণ আৰু কথা কোৱাৰ অংগ।", examples: "বাঘটোৱে মুখ মেলি গৰ্জন কৰিলে" },
  { word: "ডাল", senseLabel: "শাখা", gloss: "গছৰ কাণ্ডৰ পৰা ওলোৱা শাখা।", examples: "চৰাইজনী ডাল এৰি উৰি গ'ল" },
  { word: "ডাল", senseLabel: "দাইল", gloss: "শিম জাতীয় শুকান শস্যৰ দাইল।", examples: "ঘৰত ডাল, শাক আৰু ভাত আছিল" },
  { word: "ৰং", senseLabel: "বৰ্ণ", gloss: "বস্তুৰ ৰং বা বৰ্ণ।", examples: "এই কাপোৰৰ ৰং বৰ সুন্দৰ" },
  { word: "ৰং", senseLabel: "আনন্দ", gloss: "আমোদ-প্ৰমোদ, উৎসৱৰ আনন্দ।", examples: "গাঁৱত বৰ ৰং-ৰস হ'ল" },
  { word: "বৰ", senseLabel: "ডাঙৰ", gloss: "আকাৰ বা পৰিমাণত ডাঙৰ।", examples: "এইখন বৰ নদী" },
  { word: "বৰ", senseLabel: "বিয়াৰ বৰ", gloss: "বিয়াত কইনাৰ স্বামী হ'বলৈ থকা পুৰুষ।", examples: "বৰ আহি পালে" },
];

async function api(path, init = {}, token) {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(API + path, { ...init, headers });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}
const post = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const health = await api("/api/health").catch(() => null);
if (health?.status !== 200) {
  console.error(`API not reachable at ${API}. Start it first: docker compose up -d --build`);
  process.exit(1);
}

// Signup returns an error when the account exists; login below covers both cases.
await api("/api/auth/signup", post(DEMO));
const login = await api("/api/auth/login", post({ usernameOrEmail: DEMO.username, password: DEMO.password }));
if (login.status !== 200) {
  console.error(`Could not log in as "${DEMO.username}" (${login.status}). The account may exist with a different password.`);
  process.exit(1);
}
const token = login.body.data.accessToken;

const existing = await api("/api/workspaces", {}, token);
let workspace = existing.body.data.find((w) => w.name === WORKSPACE);
if (workspace) {
  console.log(`Workspace "${WORKSPACE}" already exists, nothing to seed.`);
} else {
  const created = await api("/api/workspaces", post({ name: WORKSPACE, description: "Assamese ambiguous-word demo. Glosses are drafts.", annotationType: "WSD" }), token);
  workspace = created.body.data;
  const base = `/api/workspaces/${workspace.id}`;

  for (const doc of DOCS) {
    const form = new FormData();
    form.append("file", new File([doc.text], doc.name, { type: "text/plain" }));
    const up = await fetch(`${API}${base}/documents`, { method: "POST", body: form, headers: { Authorization: `Bearer ${token}` } });
    if (!up.ok) throw new Error(`Upload of ${doc.name} failed (${up.status})`);
  }
  // Tokenization is asynchronous; wait until every document is ready for the editor.
  for (let i = 0; i < 100; i++) {
    const docs = (await api(`${base}/documents`, {}, token)).body.data;
    if (docs.length === DOCS.length && docs.every((d) => d.processingStatus === "COMPLETED")) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  const imported = await api(`${base}/wsd/import`, post({ entries: SENSES }), token);
  console.log(`Created "${WORKSPACE}": ${DOCS.length} documents, ${imported.body.data.inserted} senses.`);
}

console.log(`
Demo login
  username: ${DEMO.username}   (or email: ${DEMO.email})
  password: ${DEMO.password}
Open ${WEB}, sign in, then open the "${WORKSPACE}" workspace -> editor.`);
