const { onSchedule }        = require("firebase-functions/v2/scheduler");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { defineSecret }      = require("firebase-functions/params");
const { initializeApp }     = require("firebase-admin/app");
const { getFirestore }      = require("firebase-admin/firestore");
const https                 = require("https");

initializeApp();
const db = getFirestore();

// ─── Secrets ──────────────────────────────────────────────────────────────────
const TELEGRAM_BOT_TOKEN = defineSecret("TELEGRAM_BOT_TOKEN");
const TELEGRAM_CHAT_ID   = defineSecret("TELEGRAM_CHAT_ID");

// ─── Schedule Data (mirrors HTML app — 3-week perfectly balanced) ─────────────
const MEMBERS = ["Vamsi", "Baggu", "Deepak", "Sriman", "Mohan", "Sahith"];
const DAYS    = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

const SCHEDULE_WEEKS = [
  [ // Week 1 — Easy week: Deepak & Sahith
    { cooking:[0,1], cleaning:[2,3], rest:[4,5] },
    { cooking:[2,3], cleaning:[4,5], rest:[0,1] },
    { cooking:[4,5], cleaning:[0,1], rest:[2,3] },
    { cooking:[0,2], cleaning:[4,3], rest:[1,5] },
    { cooking:[1,5], cleaning:[0,2], rest:[4,3] },
    { cooking:[4,3], cleaning:[1,5], rest:[0,2] },
    { cooking:[0,4], cleaning:[1,3], rest:[2,5] },
  ],
  [ // Week 2 — Easy week: Sriman & Mohan
    { cooking:[0,2], cleaning:[1,4], rest:[3,5] },
    { cooking:[1,4], cleaning:[3,5], rest:[0,2] },
    { cooking:[3,5], cleaning:[0,2], rest:[1,4] },
    { cooking:[1,3], cleaning:[2,5], rest:[0,4] },
    { cooking:[2,5], cleaning:[0,4], rest:[1,3] },
    { cooking:[0,4], cleaning:[1,3], rest:[2,5] },
    { cooking:[1,2], cleaning:[0,5], rest:[3,4] },
  ],
  [ // Week 3 — Easy week: Vamsi & Baggu
    { cooking:[3,5], cleaning:[0,4], rest:[1,2] },
    { cooking:[0,5], cleaning:[2,4], rest:[1,3] },
    { cooking:[1,2], cleaning:[3,5], rest:[0,4] },
    { cooking:[3,4], cleaning:[1,5], rest:[0,2] },
    { cooking:[2,5], cleaning:[0,3], rest:[1,4] },
    { cooking:[0,1], cleaning:[2,4], rest:[3,5] },
    { cooking:[3,4], cleaning:[1,2], rest:[0,5] },
  ],
];

// Anchor in IST: 2026-03-02 00:00:00 IST = 2026-03-01T18:30:00.000Z
const ANCHOR_MONDAY = new Date('2026-03-01T18:30:00.000Z');

function getTodaySchedule() {
  const now = new Date();

  // Get current date components in IST
  const istDate = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const y = istDate.getFullYear(), m = istDate.getMonth(), d = istDate.getDate();

  // IST midnight expressed in UTC (IST = UTC+5:30, so subtract 5.5 hours)
  const todayIST    = new Date(Date.UTC(y, m, d) - 5.5 * 60 * 60 * 1000);
  const msPerWeek   = 7 * 24 * 60 * 60 * 1000;
  const msPer3Weeks = 3 * msPerWeek;
  const msIntoCycle = ((todayIST - ANCHOR_MONDAY) % msPer3Weeks + msPer3Weeks) % msPer3Weeks;
  const weekIdx  = Math.floor(msIntoCycle / msPerWeek);
  const jsDay    = istDate.getDay();
  const dayIdx   = (jsDay + 6) % 7;
  const day      = SCHEDULE_WEEKS[weekIdx][dayIdx];
  return {
    weekNum:  weekIdx + 1,
    dayName:  DAYS[dayIdx],
    cooking:  day.cooking.map(i  => MEMBERS[i]),
    cleaning: day.cleaning.map(i => MEMBERS[i]),
    rest:     day.rest.map(i     => MEMBERS[i]),
  };
}

function getDutyLabel(cycleCount) {
  const p = cycleCount % 3;
  if (p === 0) return "🍳 Cooking";
  if (p === 1) return "🧹 House Cleaning + Dishes";
  return "😴 Rest Day";
}

// ─── Send Telegram message ────────────────────────────────────────────────────
function sendTelegram(token, chatId, text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      chat_id:    chatId,
      text:       text,
      parse_mode: "Markdown",
    });
    const req = https.request({
      hostname: "api.telegram.org",
      path:     `/bot${token}/sendMessage`,
      method:   "POST",
      headers:  { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        const parsed = JSON.parse(data);
        if (parsed.ok) {
          console.log("✅ Telegram message sent to chat", chatId);
          resolve(parsed);
        } else {
          console.error("❌ Telegram error:", parsed);
          reject(new Error(parsed.description));
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function getCurrentState() {
  const doc = await db.collection("tracker").doc("state").get();
  return doc.exists ? doc.data() : null;
}

// ─── 1. Daily Morning Reminder — 7:30 AM IST ──────────────────────────────────
exports.dailyMorningReminder = onSchedule(
  {
    schedule: "30 7 * * *",
    region:   "asia-south1",
    timeZone: "Asia/Kolkata",
    secrets:  [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID],
  },
  async () => {
    const schedule = getTodaySchedule();
    const today    = new Date().toLocaleDateString("en-IN", {
      weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata",
    });

    const message =
      `🏠 *TNGO Roomies — Daily Reminder*\n\n` +
      `📅 *${today}* · Week ${schedule.weekNum}\n\n` +
      `🍳 *Cooking:* ${schedule.cooking.join(" & ")}\n` +
      `🧹 *Cleaning \\+ Dishes:* ${schedule.cleaning.join(" & ")}\n` +
      `😴 *Rest:* ${schedule.rest.join(" & ")}\n\n` +
      `Open the app:\nhttps://flatactivityplanner.web.app/`;

    console.log("📨 Sending daily reminder:\n", message);

    await sendTelegram(
      TELEGRAM_BOT_TOKEN.value(),
      TELEGRAM_CHAT_ID.value(),
      message
    );
  }
);

// ─── 2. Notify group when someone marks dustbin duty Done (max 1 per day) ─────
exports.onDutyMarkedDone = onDocumentUpdated(
  {
    document: "tracker/state",
    region:   "asia-south1",
    secrets:  [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID],
  },
  async (event) => {
    const before = event.data.before.data();
    const after  = event.data.after.data();

    // Only fire when lastCompletedBy actually changes
    if (before.lastCompletedBy === after.lastCompletedBy) return;
    if (!after.lastCompletedBy) return;

    // ── Throttle: only 1 notification per day ──────────────────────────────
    const todayIST = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // "YYYY-MM-DD"
    const notifyDoc = await db.collection("tracker").doc("notifications").get();
    if (notifyDoc.exists && notifyDoc.data().lastNotifiedDate === todayIST) {
      console.log(`⏭ Notification already sent today (${todayIST}), skipping.`);
      return;
    }

    // ── Build message ───────────────────────────────────────────────────────
    const completedBy = after.lastCompletedBy;
    const queue       = JSON.parse(after.queue || "[]");
    const nextPerson  = queue.length > 0 ? queue[0].name : null;

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toLocaleDateString("en-IN", {
      weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata"
    });

    const message = nextPerson
      ? `🗑️ *${completedBy}* cleared the dustbin today\!

` +
        `📅 *Tomorrow is ${nextPerson}'s turn*
` +
        `🗓 ${tomorrowStr}

` +
        `🏠 TNGO Roomies`
      : `🗑️ *${completedBy}* cleared the dustbin today\!

` +
        `✅ Everyone has completed this cycle\!

` +
        `🏠 TNGO Roomies`;

    // ── Send & record the date ──────────────────────────────────────────────
    await sendTelegram(
      TELEGRAM_BOT_TOKEN.value(),
      TELEGRAM_CHAT_ID.value(),
      message
    );

    await db.collection("tracker").doc("notifications").set({
      lastNotifiedDate: todayIST,
      lastNotifiedBy:   completedBy,
      sentAt:           new Date().toISOString()
    });

    console.log(`✅ Notification sent for ${completedBy}, date locked to ${todayIST}`);
  }
);