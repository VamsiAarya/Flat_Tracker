const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const twilio = require("twilio");

initializeApp();
const db = getFirestore();

// ─── Secrets (stored in Google Secret Manager) ────────────────────────────────
const TWILIO_ACCOUNT_SID   = defineSecret("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN    = defineSecret("TWILIO_AUTH_TOKEN");
const TWILIO_WHATSAPP_FROM = defineSecret("TWILIO_WHATSAPP_FROM");

// ─── Schedule Data (mirrors the HTML app exactly) ─────────────────────────────
const MEMBERS = ["Vamsi", "Baggu", "Deepak", "Sriman", "Mohan", "Sahith"];

const SCHEDULE_WEEKS = [
  [
    { cooking: [0,1], cleaning: [2,3], rest: [4,5] },  // Mon
    { cooking: [2,4], cleaning: [0,5], rest: [1,3] },  // Tue
    { cooking: [3,5], cleaning: [1,4], rest: [0,2] },  // Wed
    { cooking: [0,1], cleaning: [3,5], rest: [2,4] },  // Thu
    { cooking: [2,3], cleaning: [0,4], rest: [1,5] },  // Fri
    { cooking: [4,5], cleaning: [2,3], rest: [0,1] },  // Sat
    { cooking: [0,4], cleaning: [1,5], rest: [2,3] },  // Sun
  ],
  [
    { cooking: [2,3], cleaning: [4,5], rest: [0,1] },  // Mon
    { cooking: [4,0], cleaning: [2,1], rest: [3,5] },  // Tue
    { cooking: [5,1], cleaning: [3,0], rest: [2,4] },  // Wed
    { cooking: [4,3], cleaning: [2,1], rest: [5,0] },  // Thu
    { cooking: [0,5], cleaning: [2,3], rest: [4,1] },  // Fri
    { cooking: [0,1], cleaning: [4,5], rest: [2,3] },  // Sat
    { cooking: [2,5], cleaning: [0,1], rest: [3,4] },  // Sun
  ]
];

// Anchor Monday — must match the HTML app
const ANCHOR_MONDAY = new Date('2026-03-02T00:00:00.000Z');

// Returns today's full schedule with member names
function getTodaySchedule() {
  const now = new Date();
  // Get today's date in IST
  const istString = now.toLocaleString("en-CA", { timeZone: "Asia/Kolkata" });
  const todayIST = new Date(istString.split(",")[0] + "T00:00:00.000Z");

  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const weeksSinceAnchor = Math.floor((todayIST - ANCHOR_MONDAY) / msPerWeek);
  const weekIdx = ((weeksSinceAnchor % 2) + 2) % 2;

  // JS getDay(): 0=Sun, 1=Mon ... convert to 0=Mon, 6=Sun
  const jsDay = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })).getDay();
  const dayIdx = (jsDay + 6) % 7;

  const day = SCHEDULE_WEEKS[weekIdx][dayIdx];

  return {
    weekNum:  weekIdx + 1,
    cooking:  day.cooking.map(i => MEMBERS[i]),
    cleaning: day.cleaning.map(i => MEMBERS[i]),
    rest:     day.rest.map(i => MEMBERS[i]),
  };
}

function getDutyLabel(cycleCount) {
  const pattern = cycleCount % 3;
  if (pattern === 0) return "🍳 Cooking";
  if (pattern === 1) return "🧹 House Cleaning + Dishes";
  return "😴 Rest Day";
}

// ─── Fetch all roomies ─────────────────────────────────────────────────────────
async function getMembers() {
  const snapshot = await db.collection("roomies").get();
  if (snapshot.empty) {
    console.warn("⚠️ No documents found in roomies collection.");
    return [];
  }
  const members = [];
  snapshot.forEach((doc) => {
    const data = doc.data();
    if (data.name && data.mobile) {
      if (data.notifications === false) {
        console.log(`🔕 Skipping ${data.name} — notifications disabled.`);
      } else {
        // notifications: true OR field not set → defaults to receiving messages
        members.push({ name: data.name, mobile: data.mobile });
      }
    } else {
      console.warn(`⚠️ Doc ${doc.id} missing name or mobile — skipping.`);
    }
  });
  console.log(`✅ Loaded ${members.length} members:`, members.map(m => m.name));
  return members;
}

async function getCurrentState() {
  const doc = await db.collection("tracker").doc("state").get();
  return doc.exists ? doc.data() : null;
}

// ─── Broadcast to all members ──────────────────────────────────────────────────
async function broadcastToAll(members, message, sid, token, from) {
  const client = twilio(sid, token);

  const results = await Promise.allSettled(
    members.map((member) =>
      client.messages.create({
        from: `whatsapp:${from}`,
        to:   `whatsapp:${member.mobile}`,
        body: message,
      })
    )
  );

  results.forEach((result, i) => {
    if (result.status === "rejected") {
      console.error(`❌ Failed → ${members[i].name}:`, result.reason);
    } else {
      console.log(`✅ Sent → ${members[i].name}`);
    }
  });
}

// ─── 1. Daily Morning Reminder — 7:30 AM IST ──────────────────────────────────
exports.dailyMorningReminder = onSchedule(
  {
    schedule: "30 7 * * *",
    timeZone: "Asia/Kolkata",
    secrets:  [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM],
  },
  async () => {
    const members = await getMembers();
    if (!members.length) {
      console.error("❌ No members found.");
      return;
    }

    // Get today's full schedule from the schedule table
    const schedule = getTodaySchedule();

    const today = new Date().toLocaleDateString("en-IN", {
      weekday: "long",
      day:     "numeric",
      month:   "long",
      timeZone: "Asia/Kolkata",
    });

    // Build full schedule message
    const message =
      `🏠 *TNGO Roomies — Daily Reminder*\n\n` +
      `📅 *${today}* · Week ${schedule.weekNum}\n\n` +
      `🍳 *Cooking:* ${schedule.cooking.join(" & ")}\n` +
      `🧹 *Cleaning + Dishes:* ${schedule.cleaning.join(" & ")}\n` +
      `😴 *Rest:* ${schedule.rest.join(" & ")}\n\n` +
      `Open the app:\n` +
      `https://flatactivityplanner.web.app/`;

    console.log("📨 Sending message:\n", message);
    await broadcastToAll(
      members,
      message,
      TWILIO_ACCOUNT_SID.value(),
      TWILIO_AUTH_TOKEN.value(),
      TWILIO_WHATSAPP_FROM.value()
    );
  }
);

// ─── 2. Notify all when someone marks duty as Done ────────────────────────────
exports.onDutyMarkedDone = onDocumentUpdated(
  {
    document: "tracker/state",
    secrets:  [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM],
  },
  async (event) => {
    const before = event.data.before.data();
    const after  = event.data.after.data();

    // Only fire when lastCompletedBy actually changes (Done button was pressed)
    if (before.lastCompletedBy === after.lastCompletedBy) return;
    if (!after.lastCompletedBy) return;

    const members = await getMembers();
    if (!members.length) return;

    const completedBy = after.lastCompletedBy;
    const queue       = JSON.parse(after.queue || "[]");
    const nextPerson  = queue.length > 0 ? queue[0].name : "—";
    const nextDuty    = getDutyLabel(after.cycleCount ?? 0);

    const message =
      `🗑️ *${completedBy}* just emptied the dust bin!\n\n` +
      `🔜 *Next up: ${nextPerson}*\n\n` +
      `🏠 TNGO Roomies`;

    await broadcastToAll(
      members,
      message,
      TWILIO_ACCOUNT_SID.value(),
      TWILIO_AUTH_TOKEN.value(),
      TWILIO_WHATSAPP_FROM.value()
    );
  }
);