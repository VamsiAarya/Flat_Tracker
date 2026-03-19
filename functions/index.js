const { onSchedule }        = require("firebase-functions/v2/scheduler");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { defineSecret }      = require("firebase-functions/params");
const { initializeApp }     = require("firebase-admin/app");
const { getFirestore }      = require("firebase-admin/firestore");
const { google }            = require("googleapis");
const https                 = require("https");

initializeApp();
const db = getFirestore();

// ─── Secrets ───────────────────────────────────────────────────────────────────
const TELEGRAM_BOT_TOKEN = defineSecret("TELEGRAM_BOT_TOKEN");
const TELEGRAM_CHAT_ID   = defineSecret("TELEGRAM_CHAT_ID");
const GEMINI_API_KEY     = defineSecret("GEMINI_API_KEY");

// ─── Schedule Data — MUST stay in sync with index.html ────────────────────────
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

// Anchor: 2026-03-02 00:00 IST = 2026-03-01T18:30:00.000Z
const ANCHOR_MONDAY = new Date('2026-03-01T18:30:00.000Z');
const MS_PER_WEEK   = 7 * 24 * 60 * 60 * 1000;
const MS_PER_CYCLE  = 3 * MS_PER_WEEK;

// ─── Veg/Non-Veg keyword classifier for festivals ─────────────────────────────
const VEG_FESTIVAL_KEYWORDS = [
  "sankranti", "ugadi", "rama navami", "hanuman", "ganesh", "chaturthi",
  "navratri", "diwali", "deepavali", "kartika", "ekadashi", "pournami",
  "amavasya", "janmashtami", "buddha", "mahavir", "pongal", "onam",
  "shivaratri", "holi", "raksha", "teej", "durga"
];
const NONVEG_FESTIVAL_KEYWORDS = [
  "christmas", "independence", "republic", "gandhi", "ambedkar",
  "dussehra", "eid", "bakrid", "muharram"
];

function isVegFestival(holidayName) {
  const name = holidayName.toLowerCase();
  if (NONVEG_FESTIVAL_KEYWORDS.some(k => name.includes(k))) return false;
  if (VEG_FESTIVAL_KEYWORDS.some(k => name.includes(k))) return true;
  return true; // default to veg if unsure
}

// ─── Core: Get schedule for ANY date — identical logic to index.html ───────────
function getScheduleForDate(date) {
  const istDate     = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const y = istDate.getFullYear(), m = istDate.getMonth(), d = istDate.getDate();
  const istMidnight = new Date(Date.UTC(y, m, d) - 5.5 * 60 * 60 * 1000);
  const msIntoCycle = ((istMidnight - ANCHOR_MONDAY) % MS_PER_CYCLE + MS_PER_CYCLE) % MS_PER_CYCLE;
  const weekIdx     = Math.floor(msIntoCycle / MS_PER_WEEK);
  const dayIdx      = (istDate.getDay() + 6) % 7;
  const day         = SCHEDULE_WEEKS[weekIdx][dayIdx];
  return {
    weekNum:  weekIdx + 1,
    dayName:  DAYS[dayIdx],
    cooking:  day.cooking.map(i  => MEMBERS[i]),
    cleaning: day.cleaning.map(i => MEMBERS[i]),
    rest:     day.rest.map(i     => MEMBERS[i]),
  };
}

// ─── Firestore: active roomies ─────────────────────────────────────────────────
async function getActiveRoomies() {
  const snap = await db.collection("roomies").where("active", "==", true).get();
  return snap.docs.map(d => d.data());
}

// People who avoid non-veg on a given day
function getVegOnlyPeople(roomies, dayName) {
  return roomies
    .filter(r => r.vegDays && r.vegDays.includes(dayName))
    .map(r => r.name);
}

// People whose birthday is today (MM-DD format stored in Firestore)
function getTodayBirthdays(roomies, dateObj) {
  const istDate  = new Date(dateObj.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const todayMMDD = String(istDate.getMonth() + 1).padStart(2, "0") + "-" +
                    String(istDate.getDate()).padStart(2, "0");
  return roomies
    .filter(r => r.birthday === todayMMDD)
    .map(r => r.name);
}

// ─── Firestore: recipe history (last 7 lunch dishes) ──────────────────────────
async function getRecentLunchDishes() {
  const doc = await db.collection("schedule").doc("recipeHistory").get();
  if (!doc.exists) return [];
  return (doc.data().dishes || []).map(d => typeof d === "string" ? d : d.name);
}

async function saveRecentLunchDish(recipe) {
  const doc     = await db.collection("schedule").doc("recipeHistory").get();
  const existing = doc.exists ? (doc.data().dishes || []) : [];
  const updated  = [...existing, {
    name:      recipe.name,
    date:      new Date().toISOString(),
    nutrition: recipe.nutrition || null,
  }].slice(-7);
  await db.collection("schedule").doc("recipeHistory").set({
    dishes: updated, updatedAt: new Date().toISOString(),
  });
  console.log(`📝 Lunch history saved: ${recipe.name}`);
}

// ─── Firestore: pre-workout history (last 7 suggestions) ──────────────────────
async function getRecentPreWorkoutDishes() {
  const doc = await db.collection("schedule").doc("preWorkoutHistory").get();
  return doc.exists ? (doc.data().dishes || []) : [];
}

async function saveRecentPreWorkoutDish(dishName) {
  const recent  = await getRecentPreWorkoutDishes();
  const updated = [...recent, dishName].slice(-7);
  await db.collection("schedule").doc("preWorkoutHistory").set({
    dishes: updated, updatedAt: new Date().toISOString(),
  });
  console.log(`📝 Pre-workout history saved: ${dishName}`);
}

// ─── Google Calendar: check Indian holidays for a given date ──────────────────
async function getFestivalForDate(dateObj) {
  try {
    const calendar   = google.calendar({ version: "v3" });
    const auth       = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
    });
    const authClient = await auth.getClient();

    // Indian Holidays public calendar ID
    const calendarId = "en.indian#holiday@group.v.calendar.google.com";

    // Check the full day in IST
    const istDate    = new Date(dateObj.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const y = istDate.getFullYear(), m = istDate.getMonth(), d = istDate.getDate();
    const timeMin    = new Date(Date.UTC(y, m, d) - 5.5 * 60 * 60 * 1000).toISOString();
    const timeMax    = new Date(Date.UTC(y, m, d + 1) - 5.5 * 60 * 60 * 1000).toISOString();

    const response = await calendar.events.list({
      auth:           authClient,
      calendarId,
      timeMin,
      timeMax,
      singleEvents:   true,
      orderBy:        "startTime",
    });

    const events = response.data.items || [];
    if (events.length > 0) {
      const name     = events[0].summary;
      const vegOnly  = isVegFestival(name);
      console.log(`🎉 Festival found: ${name} | vegOnly: ${vegOnly}`);
      return { name, vegOnly };
    }
    return null;
  } catch(e) {
    console.error("❌ Google Calendar error:", e.message);
    return null;
  }
}

// ─── Gemini API call ───────────────────────────────────────────────────────────
function callGemini(apiKey, prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.9, topP: 0.95, maxOutputTokens: 1024 },
    });
    const req = https.request({
      hostname: "generativelanguage.googleapis.com",
      path:     `/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      method:   "POST",
      headers:  {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const parsed  = JSON.parse(data);
          const text    = parsed.candidates?.[0]?.content?.parts?.[0]?.text || "";
          const cleaned = text.replace(/```json|```/g, "").trim();
          resolve(JSON.parse(cleaned));
        } catch(e) {
          console.error("❌ Gemini parse error:", data);
          reject(new Error("Failed to parse Gemini response"));
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ─── Gemini prompt: lunch recipe ──────────────────────────────────────────────
function buildLunchPrompt(dayName, vegOnlyPeople, recentDishes, festival) {
  const isVegDay = festival?.vegOnly || vegOnlyPeople.length > 0;

  let dietaryLine;
  if (festival) {
    dietaryLine = festival.vegOnly
      ? `Tomorrow is ${festival.name} — a special Indian festival. The meal MUST be strictly vegetarian and should be a traditional festive dish from Andhra Pradesh associated with this occasion.`
      : `Tomorrow is ${festival.name}. There are no strict dietary restrictions for this festival so the meal can be vegetarian or non-vegetarian.`;
  } else if (vegOnlyPeople.length > 0) {
    dietaryLine = `Tomorrow is ${dayName}. ${vegOnlyPeople.join(" & ")} do not eat non-veg, so the meal MUST be strictly vegetarian.`;
  } else {
    dietaryLine = `Tomorrow is ${dayName}. No dietary restrictions so the meal can be vegetarian or non-vegetarian.`;
  }

  const avoidLine = recentDishes.length > 0
    ? `\n- Do NOT suggest any of these recently cooked dishes: ${recentDishes.join(", ")}`
    : "";

  return `You are an Indian recipe assistant for 6 roommates in Hyderabad.

${dietaryLine}

STRICT RULES:
- Suggest exactly ONE lunch recipe
- Must be an authentic dish from Andhra Pradesh cuisine specifically
- Practical dish — basic kitchen equipment, 60 mins max
- Quantities for exactly 6 people${avoidLine}
- prepTonight: ONLY things genuinely needed the night before (soaking, marinating, thawing). Empty array [] if nothing needed.
- nutrition: estimated per serving values

Respond ONLY in this exact JSON format, no extra text, no markdown:
{
  "name": "",
  "type": "Vegetarian or Non-Vegetarian",
  "region": "Andhra Pradesh",
  "cookingTime": "",
  "ingredients": ["item — quantity"],
  "steps": ["step 1", "step 2"],
  "prepTonight": [],
  "nutrition": {
    "calories": "",
    "protein":  "",
    "carbs":    "",
    "fats":     ""
  }
}`;
}

// ─── Gemini prompt: pre-workout meal ──────────────────────────────────────────
function buildPreWorkoutPrompt(recentDishes) {
  const avoidLine = recentDishes.length > 0
    ? `\n- Do NOT suggest any of these recent suggestions: ${recentDishes.join(", ")}`
    : "";

  return `You are a fitness nutrition assistant for 6 roommates in Hyderabad, India.

Suggest ONE pre-workout meal that is:
- Quick to prepare — under 10 minutes
- Light on the stomach but high in energy
- Made from common Indian household ingredients
- Suitable for eating 30-45 minutes before a workout
- General Indian cuisine (not region specific)${avoidLine}

Respond ONLY in this exact JSON format, no extra text, no markdown:
{
  "name": "",
  "readyIn": "",
  "energyLevel": "High or Medium",
  "ingredients": ["item — quantity per person"],
  "whyItWorks": "",
  "tip": ""
}`;
}

// ─── Format: lunch recipe block ───────────────────────────────────────────────
function formatLunchBlock(recipe, festival) {
  const typeEmoji   = recipe.type === "Vegetarian" ? "🟢" : "🍗";
  const ingredients = recipe.ingredients.map(i => `• ${i}`).join("\n");
  const steps       = recipe.steps.map((s, idx) => `${idx + 1}\\. ${s}`).join("\n");

  const festivalHeader = festival
    ? `🎉 *${festival.name} Special\\!*\n`
    : "";

  let block =
    `🍽 *Tomorrow's Lunch Suggestion*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `${festivalHeader}` +
    `🥘 *${recipe.name}*\n` +
    `${typeEmoji} ${recipe.type}  |  ⏱ ${recipe.cookingTime}  |  👥 6 people\n\n` +
    `🛒 *Ingredients:*\n${ingredients}\n\n` +
    `📋 *Steps:*\n${steps}`;

  // Nutrition
  if (recipe.nutrition) {
    const n = recipe.nutrition;
    block +=
      `\n\n💪 *Nutrition \\(per serving\\):*\n` +
      `• Calories: ${n.calories}\n` +
      `• Protein: ${n.protein}\n` +
      `• Carbs: ${n.carbs}\n` +
      `• Fats: ${n.fats}`;
  }

  // Overnight prep
  if (recipe.prepTonight && recipe.prepTonight.length > 0) {
    const prepLines = recipe.prepTonight.map(p => `• ${p}`).join("\n");
    block += `\n\n⚠️ *Prep Tonight:*\n${prepLines}`;
  }

  return block;
}

// ─── Format: pre-workout block ────────────────────────────────────────────────
function formatPreWorkoutBlock(meal) {
  const energyEmoji = meal.energyLevel === "High" ? "⚡" : "🔋";
  const ingredients = meal.ingredients.map(i => `• ${i}`).join("\n");

  return (
    `🏋️ *Pre\\-Workout Meal Suggestion*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🥗 *${meal.name}*\n` +
    `${energyEmoji} Energy: ${meal.energyLevel}  |  ⏱ Ready in: ${meal.readyIn}\n\n` +
    `🛒 *What you need \\(per person\\):*\n${ingredients}\n\n` +
    `✅ *Why it works:*\n${meal.whyItWorks}\n\n` +
    `💡 *Tip:* ${meal.tip}\n\n` +
    `🏃 Have this 30\\-45 mins before your workout\\!`
  );
}

// ─── Send Telegram message ─────────────────────────────────────────────────────
function sendTelegram(token, chatId, text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" });
    const req  = https.request({
      hostname: "api.telegram.org",
      path:     `/bot${token}/sendMessage`,
      method:   "POST",
      headers:  {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        const parsed = JSON.parse(data);
        if (parsed.ok) { console.log("✅ Telegram sent"); resolve(parsed); }
        else { console.error("❌ Telegram error:", parsed); reject(new Error(parsed.description)); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ─── 1. Pre-Workout Suggestion — 6:00 AM IST ──────────────────────────────────
exports.preWorkoutSuggestion = onSchedule(
  {
    schedule: "0 6 * * *",
    timeZone: "Asia/Kolkata",
    region:   "asia-south1",
    secrets:  [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, GEMINI_API_KEY],
  },
  async () => {
    console.log("🏋️ Fetching pre-workout suggestion...");

    // Fetch recent pre-workout suggestions to avoid repeats
    const recentDishes = await getRecentPreWorkoutDishes();
    console.log(`🔄 Avoid repeating: ${recentDishes.join(", ") || "none"}`);

    // Call Gemini
    let meal = null;
    try {
      meal = await callGemini(GEMINI_API_KEY.value(), buildPreWorkoutPrompt(recentDishes));
      console.log(`🥗 Pre-workout meal: ${meal.name}`);
    } catch(e) {
      console.error("❌ Gemini failed:", e.message);
    }

    // Build message
    const message = meal
      ? `🌅 *TNGO Roomies — Good Morning\\!*\n\n` + formatPreWorkoutBlock(meal)
      : `🌅 *TNGO Roomies — Good Morning\\!*\n\n🏋️ Pre\\-workout suggestion unavailable today\\.`;

    await sendTelegram(TELEGRAM_BOT_TOKEN.value(), TELEGRAM_CHAT_ID.value(), message);

    // Save to history
    if (meal) await saveRecentPreWorkoutDish(meal.name);

    console.log("✅ Pre-workout suggestion sent");
  }
);

// ─── 2. Daily Morning Reminder — 7:30 AM IST ──────────────────────────────────
exports.dailyMorningReminder = onSchedule(
  {
    schedule: "30 7 * * *",
    timeZone: "Asia/Kolkata",
    region:   "asia-south1",
    secrets:  [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID],
  },
  async () => {
    const now      = new Date();
    const schedule = getScheduleForDate(now);
    const todayStr = now.toLocaleDateString("en-IN", {
      weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata",
    });

    // Birthday check
    const roomies   = await getActiveRoomies();
    const birthdays = getTodayBirthdays(roomies, now);
    const birthdayLine = birthdays.length > 0
      ? `\n\n🎂 *Happy Birthday ${birthdays.join(" & ")}\\!* 🎉\nSurprise them with their favourite dish today\\!`
      : "";

    const message =
      `🏠 *TNGO Roomies — Daily Reminder*\n\n` +
      `📅 *${todayStr}* · Week ${schedule.weekNum}\n\n` +
      `🍳 *Cooking:* ${schedule.cooking.join(" & ")}\n` +
      `🧹 *Cleaning \\+ Dishes:* ${schedule.cleaning.join(" & ")}\n` +
      `😴 *Rest:* ${schedule.rest.join(" & ")}` +
      birthdayLine +
      `\n\n🌐 https://flatactivityplanner\\.web\\.app/`;

    console.log("📨 Sending morning reminder...");
    await sendTelegram(TELEGRAM_BOT_TOKEN.value(), TELEGRAM_CHAT_ID.value(), message);
  }
);

// ─── 3. Evening Recipe Suggestion — 10:00 PM IST ──────────────────────────────
exports.eveningRecipeSuggestion = onSchedule(
  {
    schedule: "0 22 * * *",
    timeZone: "Asia/Kolkata",
    region:   "asia-south1",
    secrets:  [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, GEMINI_API_KEY],
  },
  async () => {
    // ── Step 1: Tomorrow's date and schedule ──────────────────────────────
    const tomorrow    = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const schedule    = getScheduleForDate(tomorrow); // same as UI — guaranteed sync
    const tomorrowStr = tomorrow.toLocaleDateString("en-IN", {
      weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata",
    });
    console.log(`📅 Tomorrow: ${tomorrowStr} | Cooks: ${schedule.cooking.join(" & ")} | Week ${schedule.weekNum}`);

    // ── Step 2: Veg preferences + festival check (run in parallel) ────────
    const [roomies, festival] = await Promise.all([
      getActiveRoomies(),
      getFestivalForDate(tomorrow),
    ]);

    const vegPeople = getVegOnlyPeople(roomies, schedule.dayName);
    const isVegDay  = festival?.vegOnly || vegPeople.length > 0;
    console.log(`🎉 Festival: ${festival ? festival.name : "None"}`);
    console.log(`🥗 Veg only: ${isVegDay ? (vegPeople.join(", ") || "Festival override") : "No"}`);

    // ── Step 3: Recent lunch dishes ───────────────────────────────────────
    const recentDishes = await getRecentLunchDishes();
    console.log(`🔄 Avoid: ${recentDishes.join(", ") || "none"}`);

    // ── Step 4: Gemini recipe ─────────────────────────────────────────────
    let recipe = null;
    try {
      recipe = await callGemini(
        GEMINI_API_KEY.value(),
        buildLunchPrompt(schedule.dayName, vegPeople, recentDishes, festival)
      );
      console.log(`🍽 Recipe: ${recipe.name} (${recipe.type})`);
    } catch(e) {
      console.error("❌ Gemini failed:", e.message);
    }

    // ── Step 5: Build Telegram message ────────────────────────────────────
    const festivalBadge = festival
      ? `🎉 *${festival.name}* tomorrow\\!\n`
      : "";
    const vegLine = isVegDay
      ? `🥗 Veg day \\(${festival?.vegOnly ? festival.name : vegPeople.join(", ")} → veg only\\)`
      : `🍗 Non\\-veg allowed tomorrow`;

    let message =
      `🌙 *TNGO Roomies — Tomorrow's Plan*\n\n` +
      `📅 *${tomorrowStr}* · Week ${schedule.weekNum}\n` +
      `${festivalBadge}\n` +
      `👨‍🍳 *Cooks:* ${schedule.cooking.join(" & ")}\n` +
      `🧹 *Cleaning \\+ Dishes:* ${schedule.cleaning.join(" & ")}\n` +
      `😴 *Rest:* ${schedule.rest.join(" & ")}\n` +
      `${vegLine}\n\n`;

    message += recipe
      ? formatLunchBlock(recipe, festival)
      : `🍽 *Recipe suggestion unavailable tonight\\. Check tomorrow morning\\!*`;

    message += `\n\n🌐 https://flatactivityplanner\\.web\\.app/`;

    // ── Step 6: Send + save history ───────────────────────────────────────
    await sendTelegram(TELEGRAM_BOT_TOKEN.value(), TELEGRAM_CHAT_ID.value(), message);
    if (recipe) await saveRecentLunchDish(recipe);

    console.log("✅ Evening recipe suggestion sent");
  }
);

// ─── 4. Dustbin duty notification (max 1 per day) ─────────────────────────────
exports.onDutyMarkedDone = onDocumentUpdated(
  {
    document: "tracker/state",
    region:   "asia-south1",
    secrets:  [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID],
  },
  async (event) => {
    const before = event.data.before.data();
    const after  = event.data.after.data();

    if (before.lastCompletedBy === after.lastCompletedBy) return;
    if (!after.lastCompletedBy) return;

    // ── Throttle: 1 per day ────────────────────────────────────────────────
    const todayIST  = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const notifyDoc = await db.collection("tracker").doc("notifications").get();
    if (notifyDoc.exists && notifyDoc.data().lastNotifiedDate === todayIST) {
      console.log(`⏭ Already notified today (${todayIST}), skipping.`);
      return;
    }

    // ── Build and send message ─────────────────────────────────────────────
    const completedBy = after.lastCompletedBy;
    const queue       = JSON.parse(after.queue || "[]");
    const nextPerson  = queue.length > 0 ? queue[0].name : null;

    const tomorrow    = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toLocaleDateString("en-IN", {
      weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata",
    });

    const message = nextPerson
      ? `🗑️ *${completedBy}* cleared the dustbin today\\!\n\n` +
        `📅 *Tomorrow is ${nextPerson}'s turn*\n` +
        `🗓 ${tomorrowStr}\n\n` +
        `🏠 TNGO Roomies`
      : `🗑️ *${completedBy}* cleared the dustbin today\\!\n\n` +
        `✅ Everyone has completed this cycle\\!\n\n` +
        `🏠 TNGO Roomies`;

    await sendTelegram(TELEGRAM_BOT_TOKEN.value(), TELEGRAM_CHAT_ID.value(), message);

    await db.collection("tracker").doc("notifications").set({
      lastNotifiedDate: todayIST,
      lastNotifiedBy:   completedBy,
      sentAt:           new Date().toISOString(),
    });

    console.log(`✅ Dustbin notification sent for ${completedBy}, locked to ${todayIST}`);
  }
);