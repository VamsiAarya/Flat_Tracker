/**
 * @fileoverview TNGO Roomies — Firebase Cloud Functions
 *
 * Triggers:
 *   1. preWorkoutSuggestion    — 06:00 AM IST daily
 *   2. dailyMorningReminder    — 07:30 AM IST daily
 *   3. eveningRecipeSuggestion — 10:00 PM IST daily
 *   4. onDutyMarkedDone        — Firestore trigger on tracker/state
 *
 * External dependencies:
 *   - Telegram Bot API          (notifications)
 *   - Cloudflare Workers AI     (Llama 3.1 8B — recipe & pre-workout suggestions)
 *   - Google Calendar API       (Indian holiday detection)
 *   - Firebase Firestore        (state, history, roomies)
 *
 * Change log:
 *
 *   v2.1.0 — FIX-1  sendTelegram: removed double-escaping of already-escaped
 *                   MarkdownV2 text. Old code called escapeMarkdownV2(text)
 *                   inside sendTelegram even though every caller pre-escaped
 *                   all dynamic fields. This produced malformed MarkdownV2,
 *                   Telegram returned HTTP 400, the function threw, and the
 *                   UI showed "Sync failed".
 *
 *            FIX-2  safeParseJSON: added typeof check so native Firestore
 *                   Arrays are returned directly instead of being passed to
 *                   JSON.parse (which always throws on an Array, causing
 *                   silent fallback to [] and nextPerson always being null
 *                   in onDutyMarkedDone).
 *
 *            FIX-3  Removed duplicate safeParseJSON definition (was declared
 *                   twice — once before Section 10 and once at end of file).
 *
 *            FIX-4  Reordered sections: Utility Helpers (10) now precede
 *                   Cloud Functions (11) for logical dependency order.
 *
 *   v2.2.0 — FIX-5  buildLunchPrompt: tightened dietary constraint wording.
 *                   "do not eat non-veg" → "avoid non-veg on <dayName>s"
 *                   so the AI cannot misread the constraint as optional.
 *
 *            FIX-6  buildLunchPrompt: added explicit FORBIDDEN / ALLOWED
 *                   category lists to stop the AI suggesting desserts
 *                   (kheer, halwa, payasam), South Indian breakfasts
 *                   (idli, dosa, upma, pesarattu), or snacks (vada, bajji).
 *                   Extended cuisine scope from "Andhra Pradesh" to
 *                   "Andhra Pradesh or Telangana" to allow dal fry, sambar
 *                   rice, biriyanis, one-pot cooker dishes, etc.
 *
 *            FIX-7  getTomorrowDate: now computes tomorrow from IST midnight
 *                   (via getISTComponents) instead of UTC day + 1, eliminating
 *                   the UTC/IST day-boundary edge case near midnight.
 *
 * Test suite: test.js — 66 tests, 0 failures.
 *
 * @author TNGO Roomies
 * @version 2.2.0
 */

"use strict";

// ─── Node / Firebase imports ──────────────────────────────────────────────────
const { onSchedule }        = require("firebase-functions/v2/scheduler");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { defineSecret }      = require("firebase-functions/params");
const { initializeApp }     = require("firebase-admin/app");
const { getFirestore }      = require("firebase-admin/firestore");
const { google }            = require("googleapis");
const https                 = require("https");

// ─── App initialisation ───────────────────────────────────────────────────────
initializeApp();
const db = getFirestore();

// ─── Secret definitions ───────────────────────────────────────────────────────
const TELEGRAM_BOT_TOKEN = defineSecret("TELEGRAM_BOT_TOKEN");
const TELEGRAM_CHAT_ID   = defineSecret("TELEGRAM_CHAT_ID");
const CF_API_TOKEN       = defineSecret("CF_API_TOKEN");
const CF_ACCOUNT_ID      = defineSecret("CF_ACCOUNT_ID");

// =============================================================================
// SECTION 1 — CONSTANTS & CONFIGURATION
// =============================================================================

/** @type {string[]} Roommate names ordered by scheduleIndex */
const MEMBERS = Object.freeze([
  "Vamsi", "Baggu", "Deepak", "Sriman", "Mohan", "Sahith",
]);

/** @type {string[]} Day names Mon–Sun (index 0 = Monday) */
const DAYS = Object.freeze([
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
]);

/**
 * 3-week balanced cooking schedule.
 * Each entry: { cooking: number[], cleaning: number[], rest: number[] }
 * Numbers are indices into MEMBERS array.
 *
 * Distribution: every person gets exactly 7 cook / 7 clean / 7 rest days.
 * Workload per week: max 5 active days, min 2 rest days per person.
 * Easy week (workload 4) rotation: Week1=Deepak&Sahith, Week2=Sriman&Mohan, Week3=Vamsi&Baggu
 *
 * ⚠️  IMPORTANT: Must stay in sync with the scheduleWeeks array in index.html
 */
const SCHEDULE_WEEKS = Object.freeze([
  [ // ── Week 1 ── Easy: Deepak (idx 2) & Sahith (idx 5) ─────────────────────
    { cooking: [0, 1], cleaning: [2, 3], rest: [4, 5] }, // Monday
    { cooking: [2, 3], cleaning: [4, 5], rest: [0, 1] }, // Tuesday
    { cooking: [4, 5], cleaning: [0, 1], rest: [2, 3] }, // Wednesday
    { cooking: [0, 2], cleaning: [4, 3], rest: [1, 5] }, // Thursday
    { cooking: [1, 5], cleaning: [0, 2], rest: [4, 3] }, // Friday
    { cooking: [4, 3], cleaning: [1, 5], rest: [0, 2] }, // Saturday
    { cooking: [0, 4], cleaning: [1, 3], rest: [2, 5] }, // Sunday
  ],
  [ // ── Week 2 ── Easy: Sriman (idx 3) & Mohan (idx 4) ──────────────────────
    { cooking: [0, 2], cleaning: [1, 4], rest: [3, 5] }, // Monday
    { cooking: [1, 4], cleaning: [3, 5], rest: [0, 2] }, // Tuesday
    { cooking: [3, 5], cleaning: [0, 2], rest: [1, 4] }, // Wednesday
    { cooking: [1, 3], cleaning: [2, 5], rest: [0, 4] }, // Thursday
    { cooking: [2, 5], cleaning: [0, 4], rest: [1, 3] }, // Friday
    { cooking: [0, 4], cleaning: [1, 3], rest: [2, 5] }, // Saturday
    { cooking: [1, 2], cleaning: [0, 5], rest: [3, 4] }, // Sunday
  ],
  [ // ── Week 3 ── Easy: Vamsi (idx 0) & Baggu (idx 1) ───────────────────────
    { cooking: [3, 5], cleaning: [0, 4], rest: [1, 2] }, // Monday
    { cooking: [0, 5], cleaning: [2, 4], rest: [1, 3] }, // Tuesday
    { cooking: [1, 2], cleaning: [3, 5], rest: [0, 4] }, // Wednesday
    { cooking: [3, 4], cleaning: [1, 5], rest: [0, 2] }, // Thursday
    { cooking: [2, 5], cleaning: [0, 3], rest: [1, 4] }, // Friday
    { cooking: [0, 1], cleaning: [2, 4], rest: [3, 5] }, // Saturday
    { cooking: [3, 4], cleaning: [1, 2], rest: [0, 5] }, // Sunday
  ],
]);

/**
 * Schedule cycle anchor — 2026-03-02 00:00 IST.
 * Expressed in UTC: IST is UTC+5:30, so subtract 5.5 hours.
 * ⚠️  IMPORTANT: Must stay in sync with anchorMonday in index.html
 */
const SCHEDULE_ANCHOR = Object.freeze(new Date("2026-03-01T18:30:00.000Z"));
const MS_PER_DAY      = 24 * 60 * 60 * 1000;
const MS_PER_WEEK     = 7  * MS_PER_DAY;
const MS_PER_CYCLE    = 3  * MS_PER_WEEK;
const IST_OFFSET_MS   = 5.5 * 60 * 60 * 1000; // UTC+5:30

/** Google Calendar ID for Indian public holidays */
const INDIAN_HOLIDAYS_CALENDAR_ID = "en.indian#holiday@group.v.calendar.google.com";

/** Cloudflare Workers AI model — free 10k requests/day, no quota issues */
const AI_MODEL = "@cf/meta/llama-3.1-8b-instruct";

/** AI generation config shared by all prompt calls */
const AI_GENERATION_CONFIG = Object.freeze({
  temperature: 0.9,
  topP:        0.95,
  max_tokens:  1024,
});

/** App URL included in all Telegram messages */
const APP_URL = "https://flatactivityplanner.web.app/";

/** Maximum recipe/pre-workout history entries to retain */
const MAX_HISTORY_ENTRIES = 7;

/**
 * Festival keywords that imply vegetarian-only meals.
 * If a Google Calendar holiday name contains any of these, vegOnly = true.
 */
const VEG_FESTIVAL_KEYWORDS = Object.freeze([
  "sankranti", "ugadi", "rama navami", "hanuman", "ganesh", "chaturthi",
  "navratri", "diwali", "deepavali", "kartika", "ekadashi", "pournami",
  "amavasya", "janmashtami", "buddha", "mahavir", "pongal", "onam",
  "shivaratri", "holi", "raksha", "teej", "durga",
]);

/**
 * Festival keywords that do NOT imply vegetarian-only meals.
 * Checked first; if matched, vegOnly = false regardless of VEG_FESTIVAL_KEYWORDS.
 */
const NONVEG_FESTIVAL_KEYWORDS = Object.freeze([
  "christmas", "independence", "republic", "gandhi", "ambedkar",
  "dussehra", "eid", "bakrid", "muharram",
]);

// Firestore collection / document paths — single place to update if schema changes
const FS = Object.freeze({
  ROOMIES:            "roomies",
  TRACKER_STATE:      "tracker/state",
  TRACKER_NOTIF:      "tracker/notifications",
  RECIPE_HISTORY:     "schedule/recipeHistory",
  PREWORKOUT_HISTORY: "schedule/preWorkoutHistory",
});

// ─── Common function config ───────────────────────────────────────────────────
const FUNCTION_CONFIG = Object.freeze({
  region:   "asia-south1",
  timeZone: "Asia/Kolkata",
});

// =============================================================================
// SECTION 2 — STRUCTURED LOGGER
// =============================================================================

/**
 * Structured logger — prefixes every message with ISO timestamp, level, and
 * function context. Keeps all log lines parseable by Cloud Logging.
 *
 * Usage:
 *   const log = createLogger("myFunction");
 *   log.info("Something happened", { key: "value" });
 *   log.error("Something failed", error);
 *
 * @param {string} context  Name of the calling function / module
 * @returns {{ debug, info, warn, error, separator }} Logger instance
 */
function createLogger(context) {
  const timestamp = () => new Date().toISOString();

  const write = (level, message, meta = null) => {
    const entry = {
      timestamp: timestamp(),
      level,
      context,
      message,
      ...(meta !== null && { meta }),
    };
    const output = JSON.stringify(entry);
    if (level === "ERROR" || level === "WARN") {
      console.error(output);
    } else {
      console.log(output);
    }
  };

  return {
    debug:     (msg, meta) => write("DEBUG", msg, meta),
    info:      (msg, meta) => write("INFO",  msg, meta),
    warn:      (msg, meta) => write("WARN",  msg, meta),
    error:     (msg, meta) => write("ERROR", msg, meta),
    separator: ()          => console.log("─".repeat(60)),
  };
}

// =============================================================================
// SECTION 3 — DATE & SCHEDULE HELPERS
// =============================================================================

/**
 * Returns the IST date components for a given UTC Date.
 *
 * @param {Date} date
 * @returns {{ istDate: Date, year: number, month: number, day: number, jsDay: number, mmdd: string }}
 */
function getISTComponents(date) {
  const istDate = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  return {
    istDate,
    year:  istDate.getFullYear(),
    month: istDate.getMonth(),   // 0-indexed
    day:   istDate.getDate(),
    jsDay: istDate.getDay(),     // 0=Sun, 6=Sat
    mmdd:  `${String(istDate.getMonth() + 1).padStart(2, "0")}-${String(istDate.getDate()).padStart(2, "0")}`,
  };
}

/**
 * Computes the duty schedule for any given date.
 * Uses identical logic to the UI (index.html) — guaranteed to stay in sync.
 *
 * @param {Date} date  The date to compute the schedule for
 * @returns {{ weekNum: number, dayName: string, cooking: string[], cleaning: string[], rest: string[] }}
 */
function getScheduleForDate(date) {
  const log = createLogger("getScheduleForDate");
  const { year, month, day, jsDay, mmdd } = getISTComponents(date);

  // Express IST midnight as UTC for arithmetic with the UTC anchor
  const istMidnightUTC = new Date(Date.UTC(year, month, day) - IST_OFFSET_MS);
  const msIntoCycle    = ((istMidnightUTC - SCHEDULE_ANCHOR) % MS_PER_CYCLE + MS_PER_CYCLE) % MS_PER_CYCLE;
  const weekIdx        = Math.floor(msIntoCycle / MS_PER_WEEK);
  const dayIdx         = (jsDay + 6) % 7; // convert Sun=0 → Mon=0

  const daySchedule = SCHEDULE_WEEKS[weekIdx][dayIdx];
  const result = {
    weekNum:  weekIdx + 1,
    dayName:  DAYS[dayIdx],
    cooking:  daySchedule.cooking.map(i  => MEMBERS[i]),
    cleaning: daySchedule.cleaning.map(i => MEMBERS[i]),
    rest:     daySchedule.rest.map(i     => MEMBERS[i]),
  };

  log.info("Schedule computed", {
    inputDate: date.toISOString(),
    istDate:   `${year}-${mmdd}`,
    weekIdx,
    dayIdx,
    result,
  });

  return result;
}

/**
 * Returns the formatted date string for Telegram messages.
 * Example: "Friday, 20 March"
 *
 * @param {Date} date
 * @returns {string}
 */
function formatDateIST(date) {
  return date.toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata",
  });
}

/**
 * Returns a Firestore DocumentReference from a "collection/docId" path string.
 * Avoids repeated .split("/") across all DAL functions.
 *
 * @param {string} fsPath  e.g. "schedule/recipeHistory"
 * @returns {FirebaseFirestore.DocumentReference}
 */
function getFirestoreRef(fsPath) {
  const [col, docId] = fsPath.split("/");
  return db.collection(col).doc(docId);
}

/**
 * Returns a Date object representing tomorrow's date in IST.
 *
 * FIX-7: Previously used setDate(d.getDate() + 1) which operates on UTC and
 * can return the wrong IST date when the function runs within 5.5 hours of UTC
 * midnight. Now derives tomorrow from the IST calendar date explicitly.
 *
 * @returns {Date}
 */
function getTomorrowDate() {
  const now = new Date();
  const { year, month, day } = getISTComponents(now);
  // Construct IST midnight of tomorrow, expressed as a UTC Date
  return new Date(Date.UTC(year, month, day + 1) - IST_OFFSET_MS);
}

// =============================================================================
// SECTION 4 — FIRESTORE DATA ACCESS LAYER
// =============================================================================

/**
 * Fetches all active roommates from Firestore.
 * @returns {Promise<Array<{ name: string, vegDays: string[], birthday: string, active: boolean }>>}
 */
async function getActiveRoomies() {
  const log = createLogger("getActiveRoomies");
  log.info("Fetching active roomies from Firestore");

  const snap    = await db.collection(FS.ROOMIES).where("active", "==", true).get();
  const roomies = snap.docs.map(d => d.data());

  log.info("Active roomies fetched", {
    count: roomies.length,
    names: roomies.map(r => r.name),
  });

  return roomies;
}

/**
 * Returns names of roommates who avoid non-veg on the given day.
 *
 * @param {Array<{ name: string, vegDays: string[] }>} roomies
 * @param {string} dayName  e.g. "Monday"
 * @returns {string[]}
 */
function getVegOnlyPeople(roomies, dayName) {
  const log       = createLogger("getVegOnlyPeople");
  const vegPeople = roomies
    .filter(r => Array.isArray(r.vegDays) && r.vegDays.includes(dayName))
    .map(r => r.name);

  log.info("Veg-only check complete", { dayName, vegPeople });
  return vegPeople;
}

/**
 * Returns names of roommates whose birthday is today (uses MM-DD format in Firestore).
 *
 * @param {Array<{ name: string, birthday: string }>} roomies
 * @param {Date} date
 * @returns {string[]}
 */
function getTodayBirthdays(roomies, date) {
  const log       = createLogger("getTodayBirthdays");
  const { mmdd }  = getISTComponents(date);
  const birthdays = roomies.filter(r => r.birthday === mmdd).map(r => r.name);

  log.info("Birthday check complete", { todayMMDD: mmdd, birthdays });
  return birthdays;
}

/**
 * Fetches the last N lunch dish names from Firestore history.
 * @returns {Promise<string[]>}
 */
async function getRecentLunchDishes() {
  const log = createLogger("getRecentLunchDishes");
  log.info("Fetching lunch recipe history");

  const ref = getFirestoreRef(FS.RECIPE_HISTORY);
  const doc = await ref.get();

  if (!doc.exists) {
    log.info("No lunch history found — first run");
    return [];
  }

  const dishes = (doc.data().dishes || []).map(d => (typeof d === "string" ? d : d.name));
  log.info("Lunch history fetched", { count: dishes.length, dishes });
  return dishes;
}

/**
 * Appends a new lunch recipe to history, keeping only the last MAX_HISTORY_ENTRIES.
 *
 * @param {{ name: string, nutrition?: object }} recipe
 * @returns {Promise<void>}
 */
async function saveRecentLunchDish(recipe) {
  const log      = createLogger("saveRecentLunchDish");
  const ref      = getFirestoreRef(FS.RECIPE_HISTORY);
  const doc      = await ref.get();
  const existing = doc.exists ? (doc.data().dishes || []) : [];

  const now     = new Date();
  const updated = [
    ...existing,
    { name: recipe.name, date: now.toISOString(), nutrition: recipe.nutrition || null },
  ].slice(-MAX_HISTORY_ENTRIES);

  await ref.set({ dishes: updated, updatedAt: now.toISOString() });
  log.info("Lunch history saved", { savedName: recipe.name, totalEntries: updated.length });
}

/**
 * Fetches the last N pre-workout dish names from Firestore history.
 * @returns {Promise<string[]>}
 */
async function getRecentPreWorkoutDishes() {
  const log    = createLogger("getRecentPreWorkoutDishes");
  log.info("Fetching pre-workout history");

  const ref    = getFirestoreRef(FS.PREWORKOUT_HISTORY);
  const doc    = await ref.get();
  const dishes = doc.exists ? (doc.data().dishes || []) : [];

  log.info("Pre-workout history fetched", { count: dishes.length, dishes });
  return dishes;
}

/**
 * Appends a new pre-workout suggestion to history, keeping last MAX_HISTORY_ENTRIES.
 *
 * @param {string} dishName
 * @returns {Promise<void>}
 */
async function saveRecentPreWorkoutDish(dishName) {
  const log     = createLogger("saveRecentPreWorkoutDish");
  const recent  = await getRecentPreWorkoutDishes();
  const updated = [...recent, dishName].slice(-MAX_HISTORY_ENTRIES);

  await getFirestoreRef(FS.PREWORKOUT_HISTORY).set({
    dishes:    updated,
    updatedAt: new Date().toISOString(),
  });

  log.info("Pre-workout history saved", { savedName: dishName, totalEntries: updated.length });
}

/**
 * Checks whether a Done notification has already been sent today.
 * @returns {Promise<boolean>}
 */
async function hasSentNotificationToday() {
  const log      = createLogger("hasSentNotificationToday");
  const now      = new Date();
  const todayIST = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const doc      = await getFirestoreRef(FS.TRACKER_NOTIF).get();

  const alreadySent = doc.exists && doc.data().lastNotifiedDate === todayIST;
  log.info("Notification throttle check", { todayIST, alreadySent });
  return alreadySent;
}

/**
 * Records that a Done notification was sent today.
 *
 * @param {string} completedBy  Name of the person who completed duty
 * @returns {Promise<void>}
 */
async function recordNotificationSent(completedBy) {
  const log      = createLogger("recordNotificationSent");
  const now      = new Date();
  const todayIST = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

  await getFirestoreRef(FS.TRACKER_NOTIF).set({
    lastNotifiedDate: todayIST,
    lastNotifiedBy:   completedBy,
    sentAt:           now.toISOString(),
  });

  log.info("Notification record saved", { completedBy, todayIST });
}

// =============================================================================
// SECTION 5 — GOOGLE CALENDAR (FESTIVAL DETECTION)
// =============================================================================

/**
 * Determines whether a festival name implies a vegetarian-only meal.
 * Non-veg keywords are checked first; returns false if matched.
 * Defaults to true (veg) when keyword is unrecognised.
 *
 * @param {string} holidayName
 * @returns {boolean}
 */
function classifyFestivalAsVeg(holidayName) {
  const lower = holidayName.toLowerCase();
  if (NONVEG_FESTIVAL_KEYWORDS.some(k => lower.includes(k))) return false;
  if (VEG_FESTIVAL_KEYWORDS.some(k => lower.includes(k)))    return true;
  return true; // conservative default
}

/**
 * Queries the Indian Holidays Google Calendar for events on a given date.
 * Returns null on any error (non-fatal — schedule proceeds without festival data).
 *
 * @param {Date} date
 * @returns {Promise<{ name: string, vegOnly: boolean } | null>}
 */
async function getFestivalForDate(date) {
  const log = createLogger("getFestivalForDate");
  log.info("Initialising Google Calendar client");

  try {
    const auth       = new google.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/calendar.readonly"] });
    const authClient = await auth.getClient();
    log.info("Google auth client obtained successfully");

    const { year, month, day } = getISTComponents(date);
    const timeMin = new Date(Date.UTC(year, month, day)     - IST_OFFSET_MS).toISOString();
    const timeMax = new Date(Date.UTC(year, month, day + 1) - IST_OFFSET_MS).toISOString();

    log.info("Querying Google Calendar", { calendarId: INDIAN_HOLIDAYS_CALENDAR_ID, timeMin, timeMax });

    const calendar = google.calendar({ version: "v3" });
    const response = await calendar.events.list({
      auth:         authClient,
      calendarId:   INDIAN_HOLIDAYS_CALENDAR_ID,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy:      "startTime",
    });

    const events = response.data.items || [];
    log.info("Google Calendar response received", { eventCount: events.length });

    if (events.length === 0) {
      log.info("No festival found for this date");
      return null;
    }

    const name    = events[0].summary;
    const vegOnly = classifyFestivalAsVeg(name);
    log.info("Festival detected", { name, vegOnly });
    return { name, vegOnly };

  } catch (err) {
    log.error("Google Calendar query failed — proceeding without festival data", {
      message: err.message,
      stack:   err.stack,
    });
    return null;
  }
}

// =============================================================================
// SECTION 6 — AI CLIENT (Cloudflare Workers AI — free 10k req/day)
// =============================================================================

/**
 * Sends a prompt to Cloudflare Workers AI and returns the parsed JSON response.
 * Uses Cloudflare REST API — free 10,000 neurons/day, no approval or credit card needed.
 *
 * Endpoint: POST https://api.cloudflare.com/client/v4/accounts/{id}/ai/run/{model}
 *
 * @param {string} apiToken   Cloudflare API token with Workers AI read permission
 * @param {string} accountId  Cloudflare account ID
 * @param {string} prompt     Full prompt string
 * @returns {Promise<object>} Parsed JSON object from model response
 */
function callAI(apiToken, accountId, prompt) {
  const log = createLogger("callAI");
  log.info("Sending request to Cloudflare Workers AI", { model: AI_MODEL, promptLength: prompt.length });

  return new Promise((resolve, reject) => {
    const requestBody = JSON.stringify({
      messages: [
        {
          role:    "system",
          content: "You are a helpful assistant. Always respond with valid JSON only. No markdown, no explanation, no code fences.",
        },
        {
          role:    "user",
          content: prompt,
        },
      ],
      ...AI_GENERATION_CONFIG,
    });

    const options = {
      hostname: "api.cloudflare.com",
      path:     `/client/v4/accounts/${accountId}/ai/run/${AI_MODEL}`,
      method:   "POST",
      headers:  {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(requestBody),
        "Authorization":  `Bearer ${apiToken}`,
      },
    };

    const req = https.request(options, (res) => {
      let rawData = "";
      res.on("data", chunk => { rawData += chunk; });
      res.on("end", () => {
        log.info("Cloudflare AI response received", { statusCode: res.statusCode, bodyLength: rawData.length });

        try {
          const parsed = JSON.parse(rawData);

          // Cloudflare wraps response in { success, result: { response } }
          if (!parsed.success) {
            log.error("Cloudflare AI returned an error", { errors: parsed.errors });
            return reject(new Error(`Cloudflare AI error: ${JSON.stringify(parsed.errors)}`));
          }

          const rawText = parsed.result?.response || "";
          log.debug("AI raw text", { preview: rawText.substring(0, 200) });

          // Strip markdown code fences if model wraps response in ```json ... ```
          const cleanedText = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
          const result      = JSON.parse(cleanedText);

          log.info("AI response parsed successfully", { keys: Object.keys(result) });
          resolve(result);

        } catch (parseErr) {
          log.error("Failed to parse AI response", { rawData, parseError: parseErr.message });
          reject(new Error(`AI parse error: ${parseErr.message}`));
        }
      });
    });

    req.on("error", (err) => {
      log.error("Cloudflare AI HTTP request failed", { message: err.message });
      reject(err);
    });

    req.write(requestBody);
    req.end();
  });
}

// =============================================================================
// SECTION 7 — PROMPT BUILDERS
// =============================================================================

/**
 * Builds the AI prompt for an Andhra / Telangana lunch recipe suggestion.
 *
 * FIX-5: Dietary constraint wording tightened — "avoid non-veg on <dayName>s"
 *        instead of "do not eat non-veg" to leave no ambiguity for the model.
 *
 * FIX-6: Added explicit FORBIDDEN / ALLOWED category lists so the model cannot
 *        suggest desserts (kheer, halwa, payasam), South Indian breakfast items
 *        (idli, dosa, upma, pesarattu), or snacks (vada, bajji). Extended
 *        cuisine scope to "Andhra Pradesh or Telangana" so dal fry, biriyanis,
 *        one-pot cooker rice dishes and sambar rice are all valid suggestions.
 *
 * @param {string}   dayName       e.g. "Tuesday"
 * @param {string[]} vegOnlyPeople Names of people avoiding non-veg that day
 * @param {string[]} recentDishes  Dish names to avoid (repeat prevention)
 * @param {{ name: string, vegOnly: boolean } | null} festival
 * @returns {string}
 */
function buildLunchPrompt(dayName, vegOnlyPeople, recentDishes, festival) {
  let dietaryContext;
  if (festival) {
    dietaryContext = festival.vegOnly
      ? `Tomorrow is ${festival.name}, a major Indian festival. The meal MUST be strictly vegetarian and should be a traditional festive dish from Andhra Pradesh or Telangana associated with ${festival.name}.`
      : `Tomorrow is ${festival.name}. No strict dietary restriction for this festival — the meal can be vegetarian or non-vegetarian.`;
  } else if (vegOnlyPeople.length > 0) {
    // FIX-5: explicit "avoid non-veg on <dayName>s" phrasing — harder for AI to ignore
    dietaryContext = `Tomorrow is ${dayName}. ${vegOnlyPeople.join(" & ")} avoid non-veg on ${dayName}s, so the meal MUST be strictly vegetarian.`;
  } else {
    dietaryContext = `Tomorrow is ${dayName}. No dietary restrictions — the meal can be vegetarian or non-vegetarian.`;
  }

  const avoidClause = recentDishes.length > 0
    ? `\n- Do NOT suggest any of these recently made dishes: ${recentDishes.join(", ")}`
    : "";

  // FIX-6: explicit FORBIDDEN / ALLOWED categories + Telangana scope
  return `You are a lunch recipe assistant for ${MEMBERS.length} Telugu-speaking roommates sharing a flat in Hyderabad, India.

${dietaryContext}

YOUR TASK: Suggest exactly ONE lunch recipe that the roommates will cook and eat for lunch.

STRICT CUISINE RULES — read carefully:
- ONLY suggest authentic lunch dishes from Andhra Pradesh or Telangana cuisine
- ALLOWED dish categories:
  * Rice-based mains: biriyani, pulao, one-pot pressure cooker rice dishes, tamarind rice (pulihora), lemon rice, curd rice
  * Curries (kura): chicken curry, mutton curry, egg curry, paneer curry, vegetable curry, drumstick curry, bendakaya fry
  * Dal varieties (pappu): tomato pappu, spinach pappu, raw mango pappu, toor dal, moong dal
  * Sambar or rasam served with rice
  * Dry side dishes (vepudu): potato fry, raw banana fry, cluster beans fry
  * Roti or paratha paired with a curry or dal
- FORBIDDEN — do NOT suggest these under any circumstances:
  * Desserts or sweets: kheer, halwa, payasam, gulab jamun, laddu, pongal (sweet), bobbatlu
  * Breakfast items: idli, dosa, upma, poha, pesarattu, uttapam, medu vada, pongal (breakfast)
  * Snacks or starters: vada, bajji, bonda, samosa, pakora, punugulu
  * Any dish that is not a proper lunch meal${avoidClause}
- Practical for a basic home kitchen — max 60 minutes total
- All quantities must be scaled for exactly ${MEMBERS.length} people
- "prepTonight": list ONLY steps genuinely needed the night before (soaking lentils/rice overnight, marinating meat). Use [] if nothing needs advance prep.
- "nutrition": per-serving estimates only

Respond ONLY with this exact JSON structure — no markdown, no commentary, no code fences:
{
  "name": "",
  "type": "Vegetarian or Non-Vegetarian",
  "region": "Andhra Pradesh or Telangana",
  "cookingTime": "",
  "ingredients": ["ingredient — quantity"],
  "steps": ["step 1", "step 2"],
  "prepTonight": [],
  "nutrition": { "calories": "", "protein": "", "carbs": "", "fats": "" }
}`;
}

/**
 * Builds the AI prompt for a pre-workout meal suggestion.
 *
 * @param {string[]} recentDishes  Recently suggested dishes to avoid
 * @returns {string}
 */
function buildPreWorkoutPrompt(recentDishes) {
  const avoidClause = recentDishes.length > 0
    ? `\n- Do NOT repeat any of these recent suggestions: ${recentDishes.join(", ")}`
    : "";

  return `You are a sports nutrition assistant for ${MEMBERS.length} roommates in Hyderabad, India.

Suggest ONE pre-workout meal that is:
- Ready in under 10 minutes
- Light on the stomach but high in sustainable energy
- Made from common Indian household ingredients
- Suitable to eat 30–45 minutes before a workout
- General Indian cuisine (not region-specific)${avoidClause}

Respond ONLY with this JSON — no markdown, no commentary, no code fences:
{
  "name": "",
  "readyIn": "",
  "energyLevel": "High or Medium",
  "ingredients": ["ingredient — quantity per person"],
  "whyItWorks": "",
  "tip": ""
}`;
}

// =============================================================================
// SECTION 8 — TELEGRAM MESSAGE FORMATTERS
// =============================================================================

/**
 * Escapes special characters for Telegram MarkdownV2.
 * Backslash is escaped first to prevent double-escaping on subsequent replacements.
 * Characters: _ * [ ] ( ) ~ ` > # + - = | { } . !
 *
 * ⚠️  Call this ONLY on raw dynamic content (AI-generated text, names, dates).
 *     Never call it on a fully-built MarkdownV2 message string — sendTelegram
 *     does NOT re-escape its input (see FIX-1).
 *
 * @param {string} text
 * @returns {string}
 */
function escapeMarkdownV2(text) {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/([_*[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

/**
 * Formats a lunch recipe object into a MarkdownV2 Telegram message block.
 * All dynamic/AI-generated content is escaped via escapeMarkdownV2.
 *
 * @param {{ name, type, cookingTime, ingredients, steps, nutrition, prepTonight }} recipe
 * @param {{ name: string } | null} festival
 * @returns {string}
 */
function formatLunchRecipeBlock(recipe, festival) {
  const typeEmoji = recipe.type === "Vegetarian" ? "🟢" : "🍗";

  const escapedName        = escapeMarkdownV2(recipe.name);
  const escapedType        = escapeMarkdownV2(recipe.type);
  const escapedCookingTime = escapeMarkdownV2(recipe.cookingTime);
  const ingredients        = recipe.ingredients.map(i => `• ${escapeMarkdownV2(i)}`).join("\n");
  const steps              = recipe.steps.map((s, i) => `${i + 1}\\. ${escapeMarkdownV2(s)}`).join("\n");

  const festivalHeader = festival ? `🎉 *${escapeMarkdownV2(festival.name)} Special\\!*\n` : "";

  let block =
    `🍽 *Tomorrow's Lunch Suggestion*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `${festivalHeader}` +
    `🥘 *${escapedName}*\n` +
    `${typeEmoji} ${escapedType}  \\|  ⏱ ${escapedCookingTime}  \\|  👥 ${MEMBERS.length} people\n\n` +
    `🛒 *Ingredients:*\n${ingredients}\n\n` +
    `📋 *Steps:*\n${steps}`;

  if (recipe.nutrition) {
    const n = recipe.nutrition;
    block +=
      `\n\n💪 *Nutrition \\(per serving\\):*\n` +
      `• Calories: ${escapeMarkdownV2(n.calories)}\n` +
      `• Protein: ${escapeMarkdownV2(n.protein)}\n` +
      `• Carbs: ${escapeMarkdownV2(n.carbs)}\n` +
      `• Fats: ${escapeMarkdownV2(n.fats)}`;
  }

  if (Array.isArray(recipe.prepTonight) && recipe.prepTonight.length > 0) {
    const prepLines = recipe.prepTonight.map(p => `• ${escapeMarkdownV2(p)}`).join("\n");
    block += `\n\n⚠️ *Prep Tonight:*\n${prepLines}`;
  }

  return block;
}

/**
 * Formats a pre-workout meal object into a MarkdownV2 Telegram message block.
 * All dynamic/AI-generated content is escaped via escapeMarkdownV2.
 *
 * @param {{ name, readyIn, energyLevel, ingredients, whyItWorks, tip }} meal
 * @returns {string}
 */
function formatPreWorkoutBlock(meal) {
  const energyEmoji = meal.energyLevel === "High" ? "⚡" : "🔋";
  const ingredients = meal.ingredients.map(i => `• ${escapeMarkdownV2(i)}`).join("\n");

  return (
    `🏋️ *Pre\\-Workout Meal Suggestion*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🥗 *${escapeMarkdownV2(meal.name)}*\n` +
    `${energyEmoji} ${escapeMarkdownV2(meal.energyLevel)} energy  \\|  ⏱ ${escapeMarkdownV2(meal.readyIn)}\n\n` +
    `🛒 *Ingredients \\(per person\\):*\n${ingredients}\n\n` +
    `✅ *Why it works:*\n${escapeMarkdownV2(meal.whyItWorks)}\n\n` +
    `💡 *Tip:* ${escapeMarkdownV2(meal.tip)}\n\n` +
    `🏃 Have this 30–45 mins before your workout\\!`
  );
}

// =============================================================================
// SECTION 9 — TELEGRAM TRANSPORT
// =============================================================================

/**
 * Sends a MarkdownV2-formatted message to the configured Telegram group.
 * Throws on HTTP error or Telegram API error.
 *
 * ⚠️  FIX-1: This function does NOT escape the incoming text.
 *     All callers pre-escape every dynamic field using escapeMarkdownV2() before
 *     building their message strings. Calling escapeMarkdownV2(text) here would
 *     double-escape every backslash and special character, causing Telegram to
 *     return HTTP 400 "can't parse entities" — which surfaces as "Sync failed"
 *     in the UI. The text parameter must be passed through as-is.
 *
 * @param {string} token   Bot token
 * @param {string} chatId  Chat ID (negative number for groups)
 * @param {string} text    MarkdownV2-formatted message body (pre-escaped by caller)
 * @returns {Promise<object>} Telegram API response
 */
function sendTelegram(token, chatId, text) {
  const log = createLogger("sendTelegram");
  log.info("Sending Telegram message", { chatId, messageLength: text.length });

  return new Promise((resolve, reject) => {
    // FIX-1: Pass text directly — do NOT call escapeMarkdownV2(text) here.
    const body    = JSON.stringify({ chat_id: chatId, text, parse_mode: "MarkdownV2" });
    const options = {
      hostname: "api.telegram.org",
      path:     `/bot${token}/sendMessage`,
      method:   "POST",
      headers:  {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let rawData = "";
      res.on("data", chunk => { rawData += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(rawData);
          if (parsed.ok) {
            log.info("Telegram message sent successfully", { messageId: parsed.result?.message_id });
            resolve(parsed);
          } else {
            log.error("Telegram API returned error", {
              errorCode:    parsed.error_code,
              description:  parsed.description,
              fullResponse: parsed,
            });
            reject(new Error(`Telegram error ${parsed.error_code}: ${parsed.description}`));
          }
        } catch (parseErr) {
          log.error("Failed to parse Telegram response", { rawData, parseError: parseErr.message });
          reject(parseErr);
        }
      });
    });

    req.on("error", (err) => {
      log.error("Telegram HTTP request failed", { message: err.message });
      reject(err);
    });

    req.write(body);
    req.end();
  });
}

// =============================================================================
// SECTION 10 — UTILITY HELPERS
// =============================================================================

/**
 * Safely parses a value that may be a JSON string or already a native JS type.
 *
 * FIX-2 & FIX-3: Previously declared twice and only handled string inputs.
 * A native Firestore Array passed to JSON.parse() always throws, causing
 * safeParseJSON to silently return [] — so nextPerson in onDutyMarkedDone
 * was permanently null and the "next turn" line never appeared.
 *
 * Behaviour after fix:
 *   - null / undefined  → return fallback
 *   - non-string value  → return raw directly (handles native Firestore Arrays/objects)
 *   - valid JSON string → return parsed value
 *   - invalid JSON str  → log warning, return fallback
 *
 * @template T
 * @param {*}  raw       Raw value from Firestore (Array, string, null, etc.)
 * @param {T}  fallback  Returned when raw is absent or unparseable
 * @returns {T | *}
 */
function safeParseJSON(raw, fallback) {
  if (raw === null || raw === undefined) return fallback;
  // FIX-2: native JS type (Array, object, number…) — return directly
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    createLogger("safeParseJSON").warn("JSON parse failed — using fallback", { raw });
    return fallback;
  }
}

// =============================================================================
// SECTION 11 — CLOUD FUNCTIONS
// =============================================================================

/**
 * Cloud Function 1: Pre-Workout Suggestion
 * Schedule: 06:00 AM IST daily
 * Sends an AI-generated Indian pre-workout meal suggestion to the Telegram group.
 */
exports.preWorkoutSuggestion = onSchedule(
  {
    schedule: "0 6 * * *",
    timeZone: FUNCTION_CONFIG.timeZone,
    region:   FUNCTION_CONFIG.region,
    secrets:  [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, CF_API_TOKEN, CF_ACCOUNT_ID],
  },
  async () => {
    const log = createLogger("preWorkoutSuggestion");
    log.separator();
    log.info("Function started", { triggeredAt: new Date().toISOString() });

    try {
      // ── Step 1: Load history ─────────────────────────────────────────────
      const recentDishes = await getRecentPreWorkoutDishes();

      // ── Step 2: Call AI ──────────────────────────────────────────────────
      let meal = null;
      try {
        meal = await callAI(CF_API_TOKEN.value(), CF_ACCOUNT_ID.value(), buildPreWorkoutPrompt(recentDishes));
        log.info("Pre-workout meal received from AI", {
          name:        meal.name,
          energyLevel: meal.energyLevel,
          readyIn:     meal.readyIn,
        });
      } catch (aiErr) {
        log.error("AI call failed — sending fallback message", { error: aiErr.message });
      }

      // ── Step 3: Build and send message ───────────────────────────────────
      const message = meal
        ? `🌅 *TNGO Roomies — Good Morning\\!*\n\n` + formatPreWorkoutBlock(meal)
        : `🌅 *TNGO Roomies — Good Morning\\!*\n\n🏋️ Pre\\-workout suggestion unavailable today\\.`;

      await sendTelegram(TELEGRAM_BOT_TOKEN.value(), TELEGRAM_CHAT_ID.value(), message);

      // ── Step 4: Persist to history (only on success) ─────────────────────
      if (meal) await saveRecentPreWorkoutDish(meal.name);

      log.info("Function completed successfully");
    } catch (err) {
      log.error("Unhandled error in preWorkoutSuggestion", { message: err.message, stack: err.stack });
      throw err;
    } finally {
      log.separator();
    }
  }
);

/**
 * Cloud Function 2: Daily Morning Reminder
 * Schedule: 07:30 AM IST daily
 * Sends today's cooking/cleaning/rest schedule to the group.
 * Also checks for birthdays and appends a wish if applicable.
 */
exports.dailyMorningReminder = onSchedule(
  {
    schedule: "30 7 * * *",
    timeZone: FUNCTION_CONFIG.timeZone,
    region:   FUNCTION_CONFIG.region,
    secrets:  [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID],
  },
  async () => {
    const log = createLogger("dailyMorningReminder");
    log.separator();
    log.info("Function started", { triggeredAt: new Date().toISOString() });

    try {
      const now            = new Date();
      const schedule       = getScheduleForDate(now);
      const todayFormatted = formatDateIST(now);

      const roomies   = await getActiveRoomies();
      const birthdays = getTodayBirthdays(roomies, now);

      const birthdayLine = birthdays.length > 0
        ? `\n\n🎂 *Happy Birthday ${escapeMarkdownV2(birthdays.join(" & "))}\\!* 🎉\nSurprise them with their favourite dish today\\!`
        : "";

      const message =
        `🏠 *TNGO Roomies — Daily Reminder*\n\n` +
        `📅 *${escapeMarkdownV2(todayFormatted)}* · Week ${schedule.weekNum}\n\n` +
        `🍳 *Cooking:* ${escapeMarkdownV2(schedule.cooking.join(" & "))}\n` +
        `🧹 *Cleaning \\+ Dishes:* ${escapeMarkdownV2(schedule.cleaning.join(" & "))}\n` +
        `😴 *Rest:* ${escapeMarkdownV2(schedule.rest.join(" & "))}` +
        birthdayLine +
        `\n\n🌐 [Open the app](${APP_URL})`;

      log.info("Morning reminder built", {
        date:      todayFormatted,
        week:      schedule.weekNum,
        cooking:   schedule.cooking,
        birthdays,
      });

      await sendTelegram(TELEGRAM_BOT_TOKEN.value(), TELEGRAM_CHAT_ID.value(), message);
      log.info("Function completed successfully");
    } catch (err) {
      log.error("Unhandled error in dailyMorningReminder", { message: err.message, stack: err.stack });
      throw err;
    } finally {
      log.separator();
    }
  }
);

/**
 * Cloud Function 3: Evening Recipe Suggestion
 * Schedule: 10:00 PM IST daily
 * Sends tomorrow's schedule + AI-generated Andhra/Telangana lunch recipe to the group.
 * Includes festival detection, veg/non-veg dietary logic, nutrition, overnight prep.
 *
 * ⚠️  Uses getScheduleForDate(tomorrow) — identical to UI logic — cook names always match.
 */
exports.eveningRecipeSuggestion = onSchedule(
  {
    schedule: "0 22 * * *",
    timeZone: FUNCTION_CONFIG.timeZone,
    region:   FUNCTION_CONFIG.region,
    secrets:  [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, CF_API_TOKEN, CF_ACCOUNT_ID],
  },
  async () => {
    const log = createLogger("eveningRecipeSuggestion");
    log.separator();
    log.info("Function started", { triggeredAt: new Date().toISOString() });

    try {
      // ── Step 1: Compute tomorrow's schedule ───────────────────────────────
      const tomorrow    = getTomorrowDate();  // FIX-7: IST-aware
      const schedule    = getScheduleForDate(tomorrow);
      const tomorrowStr = formatDateIST(tomorrow);

      log.info("Tomorrow's schedule resolved", {
        date:     tomorrowStr,
        week:     schedule.weekNum,
        dayName:  schedule.dayName,
        cooking:  schedule.cooking,
        cleaning: schedule.cleaning,
      });

      // ── Step 2: Fetch roomies + festival in parallel ───────────────────────
      const [roomies, festival] = await Promise.all([
        getActiveRoomies(),
        getFestivalForDate(tomorrow),
      ]);

      const vegPeople = getVegOnlyPeople(roomies, schedule.dayName);
      const isVegDay  = Boolean(festival?.vegOnly) || vegPeople.length > 0;

      log.info("Dietary context resolved", {
        festival:  festival?.name ?? null,
        isVegDay,
        vegPeople,
      });

      // ── Step 3: Fetch history to avoid repeats ────────────────────────────
      const recentDishes = await getRecentLunchDishes();

      // ── Step 4: Get recipe from AI ────────────────────────────────────────
      let recipe = null;
      try {
        recipe = await callAI(
          CF_API_TOKEN.value(),
          CF_ACCOUNT_ID.value(),
          buildLunchPrompt(schedule.dayName, vegPeople, recentDishes, festival)
        );
        log.info("Recipe received from AI", {
          name:           recipe.name,
          type:           recipe.type,
          cookingTime:    recipe.cookingTime,
          hasPrepTonight: Array.isArray(recipe.prepTonight) && recipe.prepTonight.length > 0,
          hasNutrition:   Boolean(recipe.nutrition),
        });
      } catch (aiErr) {
        log.error("AI call failed — sending fallback message", { error: aiErr.message });
      }

      // ── Step 5: Build Telegram message ────────────────────────────────────
      const festivalBadge = festival ? `🎉 *${escapeMarkdownV2(festival.name)}* tomorrow\\!\n` : "";
      const vegLine       = isVegDay
        ? `🥗 Veg day \\(${escapeMarkdownV2(festival?.vegOnly ? festival.name : vegPeople.join(", "))} → veg only\\)`
        : `🍗 Non\\-veg allowed tomorrow`;

      let message =
        `🌙 *TNGO Roomies — Tomorrow's Plan*\n\n` +
        `📅 *${escapeMarkdownV2(tomorrowStr)}* · Week ${schedule.weekNum}\n` +
        `${festivalBadge}\n` +
        `👨‍🍳 *Cooks:* ${escapeMarkdownV2(schedule.cooking.join(" & "))}\n` +
        `🧹 *Cleaning \\+ Dishes:* ${escapeMarkdownV2(schedule.cleaning.join(" & "))}\n` +
        `😴 *Rest:* ${escapeMarkdownV2(schedule.rest.join(" & "))}\n` +
        `${vegLine}\n\n`;

      message += recipe
        ? formatLunchRecipeBlock(recipe, festival)
        : `🍽 *Recipe suggestion unavailable tonight\\. Check tomorrow morning\\!*`;

      message += `\n\n🌐 [Open the app](${APP_URL})`;

      // ── Step 6: Send + persist history ────────────────────────────────────
      await sendTelegram(TELEGRAM_BOT_TOKEN.value(), TELEGRAM_CHAT_ID.value(), message);
      if (recipe) await saveRecentLunchDish(recipe);

      log.info("Function completed successfully");
    } catch (err) {
      log.error("Unhandled error in eveningRecipeSuggestion", { message: err.message, stack: err.stack });
      throw err;
    } finally {
      log.separator();
    }
  }
);

/**
 * Cloud Function 4: Dustbin Duty Notification
 * Trigger: Firestore document update on tracker/state
 * Fires when someone marks dustbin duty as Done.
 * Throttled to 1 notification per day. Undo clears the throttle.
 */
exports.onDutyMarkedDone = onDocumentUpdated(
  {
    document: FS.TRACKER_STATE,
    region:   FUNCTION_CONFIG.region,
    secrets:  [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID],
  },
  async (event) => {
    const log    = createLogger("onDutyMarkedDone");
    const before = event.data.before.data();
    const after  = event.data.after.data();

    log.separator();
    log.info("Firestore trigger fired", {
      before_lastCompletedBy: before.lastCompletedBy,
      after_lastCompletedBy:  after.lastCompletedBy,
    });

    // ── Guard: only proceed when lastCompletedBy genuinely changes ────────────
    if (before.lastCompletedBy === after.lastCompletedBy) {
      log.info("lastCompletedBy unchanged — no action required");
      return;
    }
    if (!after.lastCompletedBy) {
      log.info("lastCompletedBy cleared (undo) — no notification sent");
      return;
    }

    try {
      // ── Throttle: max 1 notification per day ─────────────────────────────
      const alreadyNotified = await hasSentNotificationToday();
      if (alreadyNotified) {
        log.info("Notification already sent today — throttle active, skipping");
        return;
      }

      // ── Build message ─────────────────────────────────────────────────────
      const completedBy = after.lastCompletedBy;

      // FIX-2: safeParseJSON now handles native Firestore Arrays directly.
      // Old code: JSON.parse(nativeArray) always threw → fallback [] → nextPerson null.
      // New code: typeof check returns native array as-is before attempting JSON.parse.
      const queue      = safeParseJSON(after.queue, []);
      const nextPerson = queue.length > 0 ? queue[0].name : null;

      const tomorrow    = getTomorrowDate();  // FIX-7: IST-aware
      const tomorrowStr = formatDateIST(tomorrow);

      log.info("Building dustbin notification", { completedBy, nextPerson, tomorrowStr });

      const message = nextPerson
        ? `🗑️ *${escapeMarkdownV2(completedBy)}* cleared the dustbin today\\!\n\n` +
          `📅 *Tomorrow is ${escapeMarkdownV2(nextPerson)}'s turn*\n` +
          `🗓 ${escapeMarkdownV2(tomorrowStr)}\n\n` +
          `🏠 TNGO Roomies`
        : `🗑️ *${escapeMarkdownV2(completedBy)}* cleared the dustbin today\\!\n\n` +
          `✅ Everyone has completed this cycle\\!\n\n` +
          `🏠 TNGO Roomies`;

      // ── Send and record ───────────────────────────────────────────────────
      await sendTelegram(TELEGRAM_BOT_TOKEN.value(), TELEGRAM_CHAT_ID.value(), message);
      await recordNotificationSent(completedBy);

      log.info("Function completed successfully", { completedBy });
    } catch (err) {
      log.error("Unhandled error in onDutyMarkedDone", { message: err.message, stack: err.stack });
      throw err;
    } finally {
      log.separator();
    }
  }
);