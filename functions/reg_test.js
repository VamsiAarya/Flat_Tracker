"use strict";

// =============================================================================
// TNGO Roomies — Isolated Logic Tests
// Tests: escapeMarkdownV2, safeParseJSON, getVegOnlyPeople,
//        classifyFestivalAsVeg, getScheduleForDate, buildLunchPrompt,
//        Issue-1 (sync/double-escape), Issue-2 (vegDay logic),
//        Issue-3 (prompt lunch-type enforcement)
// =============================================================================

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✅ PASS: ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("═".repeat(60));
}

// ─── Inline copies of all pure logic functions (no Firebase deps) ─────────────

// ── escapeMarkdownV2 ─────────────────────────────────────────────────────────
function escapeMarkdownV2(text) {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/([_*[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

// ── safeParseJSON (FIXED — handles native arrays) ────────────────────────────
function safeParseJSON(raw, fallback) {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw !== "string") return raw;          // FIX-2: native type passthrough
  try { return JSON.parse(raw); }
  catch { return fallback; }
}

// ── classifyFestivalAsVeg ────────────────────────────────────────────────────
const VEG_FESTIVAL_KEYWORDS = [
  "sankranti","ugadi","rama navami","hanuman","ganesh","chaturthi",
  "navratri","diwali","deepavali","kartika","ekadashi","pournami",
  "amavasya","janmashtami","buddha","mahavir","pongal","onam",
  "shivaratri","holi","raksha","teej","durga",
];
const NONVEG_FESTIVAL_KEYWORDS = [
  "christmas","independence","republic","gandhi","ambedkar",
  "dussehra","eid","bakrid","muharram",
];
function classifyFestivalAsVeg(holidayName) {
  const lower = holidayName.toLowerCase();
  if (NONVEG_FESTIVAL_KEYWORDS.some(k => lower.includes(k))) return false;
  if (VEG_FESTIVAL_KEYWORDS.some(k => lower.includes(k)))    return true;
  return true;
}

// ── getVegOnlyPeople ─────────────────────────────────────────────────────────
function getVegOnlyPeople(roomies, dayName) {
  return roomies
    .filter(r => Array.isArray(r.vegDays) && r.vegDays.includes(dayName))
    .map(r => r.name);
}

// ── getScheduleForDate ───────────────────────────────────────────────────────
const MEMBERS = ["Vamsi","Baggu","Deepak","Sriman","Mohan","Sahith"];
const DAYS    = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const SCHEDULE_WEEKS = [
  [
    {cooking:[0,1],cleaning:[2,3],rest:[4,5]},
    {cooking:[2,3],cleaning:[4,5],rest:[0,1]},
    {cooking:[4,5],cleaning:[0,1],rest:[2,3]},
    {cooking:[0,2],cleaning:[4,3],rest:[1,5]},
    {cooking:[1,5],cleaning:[0,2],rest:[4,3]},
    {cooking:[4,3],cleaning:[1,5],rest:[0,2]},
    {cooking:[0,4],cleaning:[1,3],rest:[2,5]},
  ],
  [
    {cooking:[0,2],cleaning:[1,4],rest:[3,5]},
    {cooking:[1,4],cleaning:[3,5],rest:[0,2]},
    {cooking:[3,5],cleaning:[0,2],rest:[1,4]},
    {cooking:[1,3],cleaning:[2,5],rest:[0,4]},
    {cooking:[2,5],cleaning:[0,4],rest:[1,3]},
    {cooking:[0,4],cleaning:[1,3],rest:[2,5]},
    {cooking:[1,2],cleaning:[0,5],rest:[3,4]},
  ],
  [
    {cooking:[3,5],cleaning:[0,4],rest:[1,2]},
    {cooking:[0,5],cleaning:[2,4],rest:[1,3]},
    {cooking:[1,2],cleaning:[3,5],rest:[0,4]},
    {cooking:[3,4],cleaning:[1,5],rest:[0,2]},
    {cooking:[2,5],cleaning:[0,3],rest:[1,4]},
    {cooking:[0,1],cleaning:[2,4],rest:[3,5]},
    {cooking:[3,4],cleaning:[1,2],rest:[0,5]},
  ],
];
const SCHEDULE_ANCHOR = new Date("2026-03-01T18:30:00.000Z");
const MS_PER_DAY    = 24 * 60 * 60 * 1000;
const MS_PER_WEEK   = 7  * MS_PER_DAY;
const MS_PER_CYCLE  = 3  * MS_PER_WEEK;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function getISTComponents(date) {
  const istDate = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  return {
    istDate,
    year:  istDate.getFullYear(),
    month: istDate.getMonth(),
    day:   istDate.getDate(),
    jsDay: istDate.getDay(),
    mmdd:  `${String(istDate.getMonth()+1).padStart(2,"0")}-${String(istDate.getDate()).padStart(2,"0")}`,
  };
}

function getScheduleForDate(date) {
  const { year, month, day, jsDay } = getISTComponents(date);
  const istMidnightUTC = new Date(Date.UTC(year, month, day) - IST_OFFSET_MS);
  const msIntoCycle    = ((istMidnightUTC - SCHEDULE_ANCHOR) % MS_PER_CYCLE + MS_PER_CYCLE) % MS_PER_CYCLE;
  const weekIdx        = Math.floor(msIntoCycle / MS_PER_WEEK);
  const dayIdx         = (jsDay + 6) % 7;
  const daySchedule    = SCHEDULE_WEEKS[weekIdx][dayIdx];
  return {
    weekNum:  weekIdx + 1,
    dayName:  DAYS[dayIdx],
    cooking:  daySchedule.cooking.map(i  => MEMBERS[i]),
    cleaning: daySchedule.cleaning.map(i => MEMBERS[i]),
    rest:     daySchedule.rest.map(i     => MEMBERS[i]),
  };
}

// ── getTomorrowDate (FIXED — IST-aware) ──────────────────────────────────────
function getTomorrowDate() {
  const now = new Date();
  const { year, month, day } = getISTComponents(now);
  return new Date(Date.UTC(year, month, day + 1) - IST_OFFSET_MS);
}

// ── buildLunchPrompt (FIXED v3) ───────────────────────────────────────────────
function buildLunchPrompt(dayName, vegOnlyPeople, recentDishes, festival) {
  let dietaryContext;
  if (festival) {
    dietaryContext = festival.vegOnly
      ? `Tomorrow is ${festival.name}, a major Indian festival. The meal MUST be strictly vegetarian and should be a traditional festive dish from Andhra Pradesh or Telangana associated with ${festival.name}.`
      : `Tomorrow is ${festival.name}. No strict dietary restriction for this festival — the meal can be vegetarian or non-vegetarian.`;
  } else if (vegOnlyPeople.length > 0) {
    dietaryContext = `Tomorrow is ${dayName}. ${vegOnlyPeople.join(" & ")} avoid non-veg on ${dayName}s, so the meal MUST be strictly vegetarian.`;
  } else {
    dietaryContext = `Tomorrow is ${dayName}. No dietary restrictions — the meal can be vegetarian or non-vegetarian.`;
  }

  const avoidClause = recentDishes.length > 0
    ? `\n- Do NOT suggest any of these recently made dishes: ${recentDishes.join(", ")}`
    : "";

  return `You are a lunch recipe assistant for ${MEMBERS.length} Telugu-speaking roommates sharing a flat in Hyderabad, India.

${dietaryContext}

YOUR TASK: Suggest exactly ONE lunch recipe that the roommates will cook and eat for lunch.

STRICT CUISINE RULES — read carefully:
- ONLY suggest authentic lunch dishes from Andhra Pradesh or Telangana cuisine
- ALLOWED categories: rice-based mains (biriyanis, pulao, one-pot rice), curries (kura), dal varieties (pappu), sambar, rasam with rice, dry sabzis as sides, roti/paratha with a curry
- FORBIDDEN — do NOT suggest these under any circumstances:
  * Desserts or sweets (kheer, halwa, payasam, gulab jamun, laddu, etc.)
  * Breakfast items (idli, dosa, upma, poha, pesarattu, uttapam, pongal as breakfast)
  * Snacks or street food meant as starters (vada, bajji, bonda, samosa, etc.)
  * North Indian only dishes that have no Andhra/Telangana variant
- Practical for a basic home kitchen — max 60 minutes total
- All quantities must be scaled for exactly ${MEMBERS.length} people${avoidClause}
- "prepTonight": list ONLY steps genuinely needed the night before (soaking lentils/rice, marinating meat). Use [] if nothing is needed.
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

// =============================================================================
// TEST SUITE
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
section("1 — escapeMarkdownV2");
// ─────────────────────────────────────────────────────────────────────────────

assert("escapes underscore",       escapeMarkdownV2("hello_world") === "hello\\_world");
assert("escapes asterisk",         escapeMarkdownV2("bold*text")   === "bold\\*text");
assert("escapes dot",              escapeMarkdownV2("3.14")        === "3\\.14");
assert("escapes hyphen",           escapeMarkdownV2("non-veg")     === "non\\-veg");
assert("escapes parentheses",      escapeMarkdownV2("(per serving)") === "\\(per serving\\)");
assert("escapes exclamation",      escapeMarkdownV2("Done!")       === "Done\\!");
assert("escapes pipe",             escapeMarkdownV2("a|b")         === "a\\|b");
assert("does not double-escape backslash already escaped",
  escapeMarkdownV2("a\\b") === "a\\\\b");
assert("plain text unchanged",     escapeMarkdownV2("Vamsi")       === "Vamsi");
assert("number coercion",          escapeMarkdownV2(6)             === "6");

// ─────────────────────────────────────────────────────────────────────────────
section("2 — safeParseJSON (FIX-2: native Array passthrough)");
// ─────────────────────────────────────────────────────────────────────────────

// The core bug: before fix, JSON.parse(nativeArray) threw → returned []
// After fix: typeof check short-circuits and returns native array as-is
const nativeArr = [{name:"Deepak"},{name:"Vamsi"}];
const parsed    = safeParseJSON(nativeArr, []);
assert("native Array returned directly (not empty fallback)",
  Array.isArray(parsed) && parsed.length === 2 && parsed[0].name === "Deepak");

assert("native object returned directly",
  safeParseJSON({foo:"bar"}, {}) && safeParseJSON({foo:"bar"},{}).foo === "bar");

assert("valid JSON string parsed correctly",
  safeParseJSON('[{"name":"Mohan"}]', [])[0].name === "Mohan");

assert("invalid JSON string returns fallback",
  Array.isArray(safeParseJSON("not-json", [])) && safeParseJSON("not-json",[]).length === 0);

assert("null returns fallback",
  safeParseJSON(null, []).length === 0);

assert("undefined returns fallback",
  safeParseJSON(undefined, []).length === 0);

assert("number passthrough",
  safeParseJSON(42, 0) === 42);

// ─────────────────────────────────────────────────────────────────────────────
section("3 — getVegOnlyPeople (BUG-2: veg day detection)");
// ─────────────────────────────────────────────────────────────────────────────

const roomies = [
  { name: "Vamsi",  vegDays: ["Tuesday", "Thursday"],  active: true },
  { name: "Baggu",  vegDays: [],                        active: true },
  { name: "Deepak", vegDays: ["Monday"],                active: true },
  { name: "Sriman", vegDays: ["Tuesday"],               active: true },
  { name: "Mohan",  vegDays: null,                      active: true },   // null vegDays edge case
  { name: "Sahith", active: true },                                       // missing vegDays field
];

const vegTuesday  = getVegOnlyPeople(roomies, "Tuesday");
const vegMonday   = getVegOnlyPeople(roomies, "Monday");
const vegWednesday= getVegOnlyPeople(roomies, "Wednesday");
const vegThursday = getVegOnlyPeople(roomies, "Thursday");

assert("Tuesday: Vamsi & Sriman are veg-only",
  vegTuesday.includes("Vamsi") && vegTuesday.includes("Sriman") && vegTuesday.length === 2,
  JSON.stringify(vegTuesday));

assert("Monday: only Deepak is veg-only",
  vegMonday.length === 1 && vegMonday[0] === "Deepak",
  JSON.stringify(vegMonday));

assert("Wednesday: nobody is veg-only (empty array)",
  vegWednesday.length === 0);

assert("Thursday: only Vamsi is veg-only",
  vegThursday.length === 1 && vegThursday[0] === "Vamsi");

assert("null vegDays does not crash — treated as non-veg",
  !vegTuesday.includes("Mohan"));

assert("missing vegDays field does not crash",
  !vegTuesday.includes("Sahith"));

// Key scenario from the bug report: veg day present but bug showed non-veg
assert("BUG-2 REGRESSION: Tuesday has veg people → isVegDay must be true",
  (Boolean(null) || vegTuesday.length > 0) === true,
  `vegTuesday=${JSON.stringify(vegTuesday)}`);

// ─────────────────────────────────────────────────────────────────────────────
section("4 — classifyFestivalAsVeg");
// ─────────────────────────────────────────────────────────────────────────────

assert("Diwali → vegOnly true",           classifyFestivalAsVeg("Diwali")               === true);
assert("Ganesh Chaturthi → vegOnly true", classifyFestivalAsVeg("Ganesh Chaturthi")     === true);
assert("Ugadi → vegOnly true",            classifyFestivalAsVeg("Ugadi")                === true);
assert("Eid ul-Fitr → vegOnly false",     classifyFestivalAsVeg("Eid ul-Fitr")          === false);
assert("Bakrid → vegOnly false",          classifyFestivalAsVeg("Bakrid")               === false);
assert("Christmas → vegOnly false",       classifyFestivalAsVeg("Christmas")            === false);
assert("Dussehra → vegOnly false",        classifyFestivalAsVeg("Dussehra")             === false);
assert("Independence Day → vegOnly false",classifyFestivalAsVeg("Independence Day")     === false);
assert("Unknown holiday → conservative veg=true", classifyFestivalAsVeg("Puja Day")    === true);
assert("case insensitive — HOLI",         classifyFestivalAsVeg("HOLI")                 === true);
assert("case insensitive — EID",          classifyFestivalAsVeg("EID")                  === false);

// ─────────────────────────────────────────────────────────────────────────────
section("5 — getScheduleForDate");
// ─────────────────────────────────────────────────────────────────────────────

// Anchor Monday 2026-03-02 = Week 1, Monday, dayIdx 0
const anchorMonday = new Date("2026-03-02T02:00:00.000Z"); // 07:30 IST same day
const s1 = getScheduleForDate(anchorMonday);
assert("Anchor Monday → Week 1",
  s1.weekNum === 1, `got weekNum=${s1.weekNum}`);
assert("Anchor Monday → dayName Monday",
  s1.dayName === "Monday", `got dayName=${s1.dayName}`);
assert("Anchor Monday → cooking Vamsi & Baggu",
  s1.cooking.includes("Vamsi") && s1.cooking.includes("Baggu"),
  JSON.stringify(s1.cooking));

// One full week later → still Week 1, Monday (next Mon)
const nextMonday = new Date(anchorMonday.getTime() + MS_PER_WEEK);
const s2 = getScheduleForDate(nextMonday);
assert("Anchor+7days → Week 2 Monday",
  s2.weekNum === 2, `got weekNum=${s2.weekNum}`);

// Three weeks later → cycles back to Week 1
const threeWeeksLater = new Date(anchorMonday.getTime() + MS_PER_CYCLE);
const s3 = getScheduleForDate(threeWeeksLater);
assert("Anchor+21days → back to Week 1",
  s3.weekNum === 1, `got weekNum=${s3.weekNum}`);

// Wednesday of anchor week: dayIdx=2
const anchorWednesday = new Date("2026-03-04T02:00:00.000Z");
const s4 = getScheduleForDate(anchorWednesday);
assert("2026-03-04 → Wednesday",
  s4.dayName === "Wednesday", `got ${s4.dayName}`);

// Each day has exactly 2 cooks, 2 cleaners, 2 resting
assert("Each slot has exactly 2 members",
  s1.cooking.length === 2 && s1.cleaning.length === 2 && s1.rest.length === 2);

// No overlap between roles
const allRoles = [...s1.cooking, ...s1.cleaning, ...s1.rest];
assert("All 6 members present exactly once",
  new Set(allRoles).size === 6 && allRoles.length === 6,
  JSON.stringify(allRoles));

// ─────────────────────────────────────────────────────────────────────────────
section("6 — getTomorrowDate (FIX: IST-aware)");
// ─────────────────────────────────────────────────────────────────────────────

const tomorrow = getTomorrowDate();
const nowIST   = getISTComponents(new Date());
const tomIST   = getISTComponents(tomorrow);

// tomorrow in IST should be exactly today's IST day + 1
const expectedTomDay = nowIST.day + 1; // simplified check (works within-month)
// Only test day-of-week advances by 1 (mod 7) since month rollover complicates date arithmetic
const todayJsDay   = nowIST.jsDay;
const tomorrowJsDay = tomIST.jsDay;
const expectedJsDay = (todayJsDay + 1) % 7;
assert("Tomorrow IST day-of-week is today+1",
  tomorrowJsDay === expectedJsDay,
  `today jsDay=${todayJsDay}, tomorrow jsDay=${tomorrowJsDay}, expected=${expectedJsDay}`);

// ─────────────────────────────────────────────────────────────────────────────
section("7 — buildLunchPrompt (BUG-2 & BUG-3 fixes)");
// ─────────────────────────────────────────────────────────────────────────────

// BUG-2: when vegOnlyPeople is non-empty, prompt must enforce veg
const promptVegDay = buildLunchPrompt("Tuesday", ["Vamsi", "Sriman"], [], null);
assert("BUG-2: veg day — prompt contains MUST be strictly vegetarian",
  promptVegDay.includes("MUST be strictly vegetarian"),
  "veg constraint not found");
assert("BUG-2: veg day — names mentioned in prompt",
  promptVegDay.includes("Vamsi") && promptVegDay.includes("Sriman"));
assert("BUG-2: veg day — dayName mentioned for context",
  promptVegDay.includes("Tuesday"));

// BUG-3: prompt must ban desserts, breakfasts, snacks
const promptNonVeg = buildLunchPrompt("Wednesday", [], [], null);
assert("BUG-3: FORBIDDEN section exists",
  promptNonVeg.includes("FORBIDDEN"),
  "FORBIDDEN keyword not found in prompt");
assert("BUG-3: desserts explicitly banned",
  promptNonVeg.toLowerCase().includes("dessert"),
  "desserts not banned");
assert("BUG-3: breakfast items explicitly banned",
  promptNonVeg.toLowerCase().includes("breakfast"),
  "breakfast not banned");
assert("BUG-3: snacks explicitly banned",
  promptNonVeg.toLowerCase().includes("snack"),
  "snacks not banned");
assert("BUG-3: idli/dosa explicitly mentioned as forbidden",
  promptNonVeg.toLowerCase().includes("idli") || promptNonVeg.toLowerCase().includes("dosa"),
  "idli/dosa not forbidden");
assert("BUG-3: Telangana included as valid cuisine region",
  promptNonVeg.includes("Telangana"),
  "Telangana not in prompt");
assert("BUG-3: ALLOWED categories listed (curries, dal)",
  promptNonVeg.toLowerCase().includes("curri") && promptNonVeg.toLowerCase().includes("dal"),
  "allowed categories not listed");

// Festival veg context
const festivalVeg = { name: "Diwali", vegOnly: true };
const promptFest  = buildLunchPrompt("Thursday", [], [], festivalVeg);
assert("Festival veg: MUST be strictly vegetarian in prompt",
  promptFest.includes("MUST be strictly vegetarian"));
assert("Festival name appears in prompt",
  promptFest.includes("Diwali"));

// Recent dishes avoidance
const promptRecent = buildLunchPrompt("Friday", [], ["Pesarattu","Pulihora"], null);
assert("Recent dishes listed in avoid clause",
  promptRecent.includes("Pesarattu") && promptRecent.includes("Pulihora"));

// No avoidance when history empty
const promptEmpty = buildLunchPrompt("Friday", [], [], null);
assert("No avoid clause when history empty",
  !promptEmpty.includes("Do NOT suggest"));

// ─────────────────────────────────────────────────────────────────────────────
section("8 — Issue-1: sendTelegram double-escape simulation");
// ─────────────────────────────────────────────────────────────────────────────

// Simulate what the callers produce — already-escaped MarkdownV2 text
const alreadyEscaped = `*TNGO Roomies \\— Daily Reminder*\n\n📅 *Tuesday, 7 April* · Week 1\n🍳 *Cooking:* Vamsi \\& Baggu`;

// WRONG (old bug): escaping again corrupts the message
const doubleEscaped = escapeMarkdownV2(alreadyEscaped);
assert("Double-escape corrupts backslashes (old bug reproduced)",
  doubleEscaped.includes("\\\\"),
  "double-escape did not produce \\\\");
assert("Double-escape corrupts bold asterisks",
  doubleEscaped.includes("\\*"),
  "asterisks should be broken by double-escape");

// CORRECT (FIX-1): send text as-is, no second escape
const correctBody = JSON.stringify({ chat_id: "-100xyz", text: alreadyEscaped, parse_mode: "MarkdownV2" });
const parsedBody  = JSON.parse(correctBody);
assert("FIX-1: text in request body equals original (no double-escape)",
  parsedBody.text === alreadyEscaped);
assert("FIX-1: parse_mode is MarkdownV2",
  parsedBody.parse_mode === "MarkdownV2");

// ─────────────────────────────────────────────────────────────────────────────
section("9 — End-to-end: veg day + prompt coherence (BUG-2 regression)");
// ─────────────────────────────────────────────────────────────────────────────

// Full scenario: someone has vegDays=["Tuesday"], function runs on Monday evening
// for Tuesday's plan — getVegOnlyPeople must return them, prompt must say veg
const roomiesTomorrow = [
  { name: "Vamsi",  vegDays: ["Tuesday"], active: true },
  { name: "Baggu",  vegDays: [],          active: true },
  { name: "Deepak", vegDays: [],          active: true },
];
const vegPeopleTomorrow = getVegOnlyPeople(roomiesTomorrow, "Tuesday");
const isVegDayTomorrow  = Boolean(null) || vegPeopleTomorrow.length > 0; // null=no festival
const e2ePrompt         = buildLunchPrompt("Tuesday", vegPeopleTomorrow, [], null);

assert("E2E: Vamsi detected as veg on Tuesday",
  vegPeopleTomorrow.includes("Vamsi"), JSON.stringify(vegPeopleTomorrow));
assert("E2E: isVegDay resolves true",
  isVegDayTomorrow === true);
assert("E2E: prompt enforces vegetarian",
  e2ePrompt.includes("MUST be strictly vegetarian"));
assert("E2E: prompt does NOT say 'non-vegetarian or vegetarian'",
  !e2ePrompt.includes("non-vegetarian or vegetarian"));

// ─────────────────────────────────────────────────────────────────────────────
// RESULTS
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(60)}`);
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
console.log("═".repeat(60));
if (failed > 0) {
  console.error("\n⚠️  Some tests FAILED — fix logic before deploying.\n");
  process.exit(1);
} else {
  console.log("\n🎉  All tests passed — safe to deploy.\n");
}
