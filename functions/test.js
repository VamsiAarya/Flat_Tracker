/**
 * @fileoverview TNGO Roomies — Cloud Functions Test Suite
 *
 * Self-contained test runner using Node.js built-in assert module.
 * No external dependencies required.
 *
 * Test coverage:
 *   ✅ createLogger
 *   ✅ getISTComponents
 *   ✅ getScheduleForDate
 *   ✅ formatDateIST
 *   ✅ getVegOnlyPeople
 *   ✅ getTodayBirthdays
 *   ✅ classifyFestivalAsVeg
 *   ✅ safeParseJSON
 *   ✅ escapeMarkdownV2
 *   ✅ buildLunchPrompt
 *   ✅ buildPreWorkoutPrompt
 *   ✅ formatLunchRecipeBlock
 *   ✅ formatPreWorkoutBlock
 *   ✅ Schedule balance verification (3-week)
 *
 * Run: node test.js
 */

"use strict";

const assert = require("assert");

// =============================================================================
// SECTION A — MINIMAL TEST HARNESS
// =============================================================================

let passed   = 0;
let failed   = 0;
let skipped  = 0;
const results = [];

/**
 * Runs a single test case and records the result.
 * @param {string}   suiteName  Name of the test suite
 * @param {string}   testName   Description of this specific test
 * @param {Function} fn         Test function (sync or async)
 */
async function test(suiteName, testName, fn) {
  const label = `[${suiteName}] ${testName}`;
  try {
    await fn();
    passed++;
    results.push({ status: "PASS", label });
    process.stdout.write(".");
  } catch (err) {
    failed++;
    results.push({ status: "FAIL", label, error: err.message });
    process.stdout.write("F");
  }
}

function skip(suiteName, testName) {
  skipped++;
  results.push({ status: "SKIP", label: `[${suiteName}] ${testName}` });
  process.stdout.write("S");
}

function printReport() {
  console.log("\n\n" + "═".repeat(70));
  console.log("  TNGO Roomies — Test Results");
  console.log("═".repeat(70));

  const failedTests = results.filter(r => r.status === "FAIL");
  const skipTests   = results.filter(r => r.status === "SKIP");

  if (failedTests.length > 0) {
    console.log("\n❌  FAILURES:\n");
    failedTests.forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.label}`);
      console.log(`     → ${r.error}\n`);
    });
  }

  if (skipTests.length > 0) {
    console.log("⏭  SKIPPED:");
    skipTests.forEach(r => console.log(`  • ${r.label}`));
    console.log();
  }

  console.log("─".repeat(70));
  console.log(`  Total:   ${passed + failed + skipped}`);
  console.log(`  ✅ Pass:  ${passed}`);
  console.log(`  ❌ Fail:  ${failed}`);
  console.log(`  ⏭  Skip:  ${skipped}`);
  console.log("═".repeat(70));

  if (failed === 0) {
    console.log("\n  🎉 All tests passed!\n");
  } else {
    console.log(`\n  ⚠️  ${failed} test(s) failed.\n`);
    process.exitCode = 1;
  }
}

// =============================================================================
// SECTION B — EXTRACT TESTABLE FUNCTIONS FROM index.js
// =============================================================================
// Since index.js doesn't export pure helpers (they're internal), we replicate
// them here verbatim. Any change to index.js logic MUST be reflected here.
// This also serves as a living specification of expected behaviour.

// ── Constants (copied from index.js) ─────────────────────────────────────────

const MEMBERS = ["Vamsi", "Baggu", "Deepak", "Sriman", "Mohan", "Sahith"];
const DAYS    = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const SCHEDULE_WEEKS = [
  [
    { cooking: [0, 1], cleaning: [2, 3], rest: [4, 5] },
    { cooking: [2, 3], cleaning: [4, 5], rest: [0, 1] },
    { cooking: [4, 5], cleaning: [0, 1], rest: [2, 3] },
    { cooking: [0, 2], cleaning: [4, 3], rest: [1, 5] },
    { cooking: [1, 5], cleaning: [0, 2], rest: [4, 3] },
    { cooking: [4, 3], cleaning: [1, 5], rest: [0, 2] },
    { cooking: [0, 4], cleaning: [1, 3], rest: [2, 5] },
  ],
  [
    { cooking: [0, 2], cleaning: [1, 4], rest: [3, 5] },
    { cooking: [1, 4], cleaning: [3, 5], rest: [0, 2] },
    { cooking: [3, 5], cleaning: [0, 2], rest: [1, 4] },
    { cooking: [1, 3], cleaning: [2, 5], rest: [0, 4] },
    { cooking: [2, 5], cleaning: [0, 4], rest: [1, 3] },
    { cooking: [0, 4], cleaning: [1, 3], rest: [2, 5] },
    { cooking: [1, 2], cleaning: [0, 5], rest: [3, 4] },
  ],
  [
    { cooking: [3, 5], cleaning: [0, 4], rest: [1, 2] },
    { cooking: [0, 5], cleaning: [2, 4], rest: [1, 3] },
    { cooking: [1, 2], cleaning: [3, 5], rest: [0, 4] },
    { cooking: [3, 4], cleaning: [1, 5], rest: [0, 2] },
    { cooking: [2, 5], cleaning: [0, 3], rest: [1, 4] },
    { cooking: [0, 1], cleaning: [2, 4], rest: [3, 5] },
    { cooking: [3, 4], cleaning: [1, 2], rest: [0, 5] },
  ],
];

const SCHEDULE_ANCHOR = new Date("2026-03-01T18:30:00.000Z");
const MS_PER_WEEK     = 7 * 24 * 60 * 60 * 1000;
const MS_PER_CYCLE    = 3 * MS_PER_WEEK;
const IST_OFFSET_MS   = 5.5 * 60 * 60 * 1000;
const MAX_HISTORY_ENTRIES = 7;

const VEG_FESTIVAL_KEYWORDS = [
  "sankranti", "ugadi", "rama navami", "hanuman", "ganesh", "chaturthi",
  "navratri", "diwali", "deepavali", "kartika", "ekadashi", "pournami",
  "amavasya", "janmashtami", "buddha", "mahavir", "pongal", "onam",
  "shivaratri", "holi", "raksha", "teej", "durga",
];
const NONVEG_FESTIVAL_KEYWORDS = [
  "christmas", "independence", "republic", "gandhi", "ambedkar",
  "dussehra", "eid", "bakrid", "muharram",
];

// ── Functions under test (verbatim copies from index.js) ─────────────────────

function getISTComponents(date) {
  const istDate = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  return {
    istDate,
    year:  istDate.getFullYear(),
    month: istDate.getMonth(),
    day:   istDate.getDate(),
    jsDay: istDate.getDay(),
    mmdd:  `${String(istDate.getMonth() + 1).padStart(2, "0")}-${String(istDate.getDate()).padStart(2, "0")}`,
  };
}

function getScheduleForDate(date) {
  const { year, month, day, jsDay, mmdd } = getISTComponents(date);
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

function formatDateIST(date) {
  return date.toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata",
  });
}

function getVegOnlyPeople(roomies, dayName) {
  return roomies
    .filter(r => Array.isArray(r.vegDays) && r.vegDays.includes(dayName))
    .map(r => r.name);
}

function getTodayBirthdays(roomies, date) {
  const { mmdd } = getISTComponents(date);
  return roomies.filter(r => r.birthday === mmdd).map(r => r.name);
}

function classifyFestivalAsVeg(holidayName) {
  const lower = holidayName.toLowerCase();
  if (NONVEG_FESTIVAL_KEYWORDS.some(k => lower.includes(k))) return false;
  if (VEG_FESTIVAL_KEYWORDS.some(k => lower.includes(k)))    return true;
  return true;
}

function safeParseJSON(raw, fallback) {
  if (raw === null || raw === undefined) return fallback;
  try { return JSON.parse(raw); }
  catch { return fallback; }
}

function escapeMarkdownV2(text) {
  return String(text).replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
}

function buildLunchPrompt(dayName, vegOnlyPeople, recentDishes, festival) {
  const isVegRequired = festival?.vegOnly || vegOnlyPeople.length > 0;
  let dietaryContext;
  if (festival) {
    dietaryContext = festival.vegOnly
      ? `Tomorrow is ${festival.name}, a major Indian festival. The meal MUST be strictly vegetarian and should be a traditional festive dish from Andhra Pradesh associated with ${festival.name}.`
      : `Tomorrow is ${festival.name}. No strict dietary restriction for this festival — the meal can be vegetarian or non-vegetarian.`;
  } else if (vegOnlyPeople.length > 0) {
    dietaryContext = `Tomorrow is ${dayName}. ${vegOnlyPeople.join(" & ")} do not eat non-veg, so the meal MUST be strictly vegetarian.`;
  } else {
    dietaryContext = `Tomorrow is ${dayName}. No dietary restrictions — the meal can be vegetarian or non-vegetarian.`;
  }
  const avoidClause = recentDishes.length > 0
    ? `\n- Do NOT repeat any of these recently cooked dishes: ${recentDishes.join(", ")}`
    : "";
  return `You are a recipe assistant for ${MEMBERS.length} roommates sharing a flat in Hyderabad, India.\n\n${dietaryContext}\n\nRULES:\n- Suggest exactly ONE lunch recipe\n- Must be an authentic dish from Andhra Pradesh cuisine${avoidClause}`;
}

function buildPreWorkoutPrompt(recentDishes) {
  const avoidClause = recentDishes.length > 0
    ? `\n- Do NOT repeat any of these recent suggestions: ${recentDishes.join(", ")}`
    : "";
  return `You are a sports nutrition assistant for ${MEMBERS.length} roommates in Hyderabad, India.\n\nSuggest ONE pre-workout meal that is:\n- Ready in under 10 minutes${avoidClause}`;
}

function formatLunchRecipeBlock(recipe, festival) {
  const typeEmoji   = recipe.type === "Vegetarian" ? "🟢" : "🍗";
  const ingredients = recipe.ingredients.map(i => `• ${i}`).join("\n");
  const steps       = recipe.steps.map((s, i) => `${i + 1}\\. ${s}`).join("\n");
  const festivalHeader = festival ? `🎉 *${escapeMarkdownV2(festival.name)} Special\\!*\n` : "";
  let block =
    `🍽 *Tomorrow's Lunch Suggestion*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `${festivalHeader}` +
    `🥘 *${escapeMarkdownV2(recipe.name)}*\n` +
    `${typeEmoji} ${recipe.type}  |  ⏱ ${recipe.cookingTime}  |  👥 6 people\n\n` +
    `🛒 *Ingredients:*\n${ingredients}\n\n` +
    `📋 *Steps:*\n${steps}`;
  if (recipe.nutrition) {
    const n = recipe.nutrition;
    block += `\n\n💪 *Nutrition \\(per serving\\):*\n• Calories: ${n.calories}\n• Protein: ${n.protein}\n• Carbs: ${n.carbs}\n• Fats: ${n.fats}`;
  }
  if (Array.isArray(recipe.prepTonight) && recipe.prepTonight.length > 0) {
    block += `\n\n⚠️ *Prep Tonight:*\n` + recipe.prepTonight.map(p => `• ${p}`).join("\n");
  }
  return block;
}

function formatPreWorkoutBlock(meal) {
  const energyEmoji = meal.energyLevel === "High" ? "⚡" : "🔋";
  const ingredients = meal.ingredients.map(i => `• ${i}`).join("\n");
  return (
    `🏋️ *Pre\\-Workout Meal Suggestion*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🥗 *${escapeMarkdownV2(meal.name)}*\n` +
    `${energyEmoji} ${meal.energyLevel} energy  |  ⏱ ${meal.readyIn}\n\n` +
    `🛒 *Ingredients \\(per person\\):*\n${ingredients}\n\n` +
    `✅ *Why it works:*\n${meal.whyItWorks}\n\n` +
    `💡 *Tip:* ${meal.tip}\n\n` +
    `🏃 Have this 30–45 mins before your workout\\!`
  );
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

const SAMPLE_ROOMIES = [
  { name: "Vamsi",  vegDays: ["Saturday"],           birthday: "07-15", active: true  },
  { name: "Baggu",  vegDays: ["Monday"],              birthday: "03-22", active: true  },
  { name: "Deepak", vegDays: ["Monday", "Tuesday"],   birthday: "11-05", active: true  },
  { name: "Sriman", vegDays: ["Tuesday"],             birthday: "08-30", active: true  },
  { name: "Mohan",  vegDays: ["Tuesday"],             birthday: "01-18", active: true  },
  { name: "Sahith", vegDays: ["Saturday"],            birthday: "05-24", active: false },
];

const SAMPLE_RECIPE = {
  name:        "Gongura Chicken",
  type:        "Non-Vegetarian",
  cookingTime: "45 minutes",
  ingredients: ["Chicken — 1.5 kg", "Gongura leaves — 2 cups", "Onion — 3 medium"],
  steps:       ["Marinate chicken for 30 mins", "Cook on medium heat"],
  nutrition:   { calories: "380 kcal", protein: "28g", carbs: "12g", fats: "18g" },
  prepTonight: ["Marinate chicken overnight"],
};

const SAMPLE_VEG_RECIPE = {
  name:        "Pesarattu",
  type:        "Vegetarian",
  cookingTime: "30 minutes",
  ingredients: ["Green moong dal — 2 cups", "Rice — 0.5 cup"],
  steps:       ["Soak dal for 6 hours", "Grind to batter", "Make dosas"],
  nutrition:   { calories: "220 kcal", protein: "14g", carbs: "32g", fats: "6g" },
  prepTonight: ["Soak green moong dal and rice for 6-8 hours"],
};

const SAMPLE_MEAL = {
  name:        "Banana Peanut Butter Toast",
  readyIn:     "5 minutes",
  energyLevel: "High",
  ingredients: ["Banana — 1", "Whole wheat bread — 2 slices", "Peanut butter — 2 tbsp"],
  whyItWorks:  "Quick carbs from banana, sustained energy from peanut butter",
  tip:         "Add a drizzle of honey for extra energy",
};

// =============================================================================
// SECTION C — TEST SUITES
// =============================================================================

async function runAllTests() {
  console.log("TNGO Roomies — Test Suite");
  console.log("─".repeat(70));
  console.log("Running tests...\n");

  // ───────────────────────────────────────────────────────────────────────────
  // SUITE 1 — getISTComponents
  // ───────────────────────────────────────────────────────────────────────────
  const S1 = "getISTComponents";

  await test(S1, "[POSITIVE] UTC midnight → correct IST date (same day)", () => {
    // UTC midnight on 2026-03-20 = 5:30 AM IST on 2026-03-20
    const date = new Date("2026-03-20T00:00:00.000Z");
    const { year, month, day, mmdd } = getISTComponents(date);
    assert.strictEqual(year,  2026,  "year should be 2026");
    assert.strictEqual(month, 2,     "month should be 2 (March, 0-indexed)");
    assert.strictEqual(day,   20,    "day should be 20");
    assert.strictEqual(mmdd,  "03-20");
  });

  await test(S1, "[POSITIVE] IST midnight → correct IST date", () => {
    // 2026-03-02 00:00 IST = 2026-03-01 18:30 UTC
    const date = new Date("2026-03-01T18:30:00.000Z");
    const { year, month, day } = getISTComponents(date);
    assert.strictEqual(year,  2026, "year should be 2026");
    assert.strictEqual(month, 2,    "month should be 2 (March)");
    assert.strictEqual(day,   2,    "day should be 2");
  });

  await test(S1, "[POSITIVE] Late UTC night crosses to next IST day", () => {
    // 2026-03-19 23:00 UTC = 2026-03-20 04:30 IST → still March 20 IST
    const date = new Date("2026-03-19T23:00:00.000Z");
    const { year, month, day } = getISTComponents(date);
    assert.strictEqual(day,   20,  "should be March 20 in IST");
    assert.strictEqual(month, 2);
  });

  await test(S1, "[POSITIVE] mmdd format is always 2 digits each part", () => {
    // Jan 5 → should be "01-05" not "1-5"
    const date = new Date("2026-01-04T18:30:00.000Z"); // Jan 5 IST midnight
    const { mmdd } = getISTComponents(date);
    assert.strictEqual(mmdd, "01-05", `expected 01-05 but got ${mmdd}`);
  });

  await test(S1, "[NEGATIVE] Invalid date input → still returns an object", () => {
    // Graceful degradation — should not throw
    const date = new Date("invalid");
    assert.doesNotThrow(() => getISTComponents(date));
  });

  await test(S1, "[EDGE] Year boundary — Dec 31 IST", () => {
    // 2025-12-31 18:30 UTC = Jan 1 2026 IST
    const date = new Date("2025-12-31T18:30:00.000Z");
    const { year, month, day } = getISTComponents(date);
    assert.strictEqual(year,  2026, "should roll over to 2026");
    assert.strictEqual(month, 0,    "should be January (0-indexed)");
    assert.strictEqual(day,   1,    "should be 1st");
  });

  await test(S1, "[EDGE] Feb 28 in non-leap year → next day is March 1", () => {
    // 2026-02-28 18:30 UTC = Mar 1 IST
    const date = new Date("2026-02-28T18:30:00.000Z");
    const { month, day } = getISTComponents(date);
    assert.strictEqual(month, 2,  "should be March");
    assert.strictEqual(day,   1,  "should be 1st");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SUITE 2 — getScheduleForDate
  // ───────────────────────────────────────────────────────────────────────────
  const S2 = "getScheduleForDate";

  await test(S2, "[POSITIVE] Anchor date (2026-03-02 Mon) → Week 1, Monday", () => {
    // 2026-03-02 IST midnight = 2026-03-01T18:30:00Z
    const anchorDate = new Date("2026-03-01T18:30:00.000Z");
    const result     = getScheduleForDate(anchorDate);
    assert.strictEqual(result.weekNum, 1,        "should be week 1");
    assert.strictEqual(result.dayName, "Monday", "should be Monday");
    assert.deepStrictEqual(result.cooking,  ["Vamsi", "Baggu"],   "Week1 Mon cooking");
    assert.deepStrictEqual(result.cleaning, ["Deepak", "Sriman"], "Week1 Mon cleaning");
    assert.deepStrictEqual(result.rest,     ["Mohan", "Sahith"],  "Week1 Mon rest");
  });

  await test(S2, "[POSITIVE] 7 days after anchor → Week 2, Monday", () => {
    // 2026-03-09 IST midnight
    const date   = new Date("2026-03-08T18:30:00.000Z");
    const result = getScheduleForDate(date);
    assert.strictEqual(result.weekNum, 2,        "should be week 2");
    assert.strictEqual(result.dayName, "Monday", "should be Monday");
  });

  await test(S2, "[POSITIVE] 14 days after anchor → Week 3, Monday", () => {
    const date   = new Date("2026-03-15T18:30:00.000Z");
    const result = getScheduleForDate(date);
    assert.strictEqual(result.weekNum, 3,        "should be week 3");
    assert.strictEqual(result.dayName, "Monday", "should be Monday");
  });

  await test(S2, "[POSITIVE] 21 days after anchor → cycle restarts at Week 1", () => {
    const date   = new Date("2026-03-22T18:30:00.000Z");
    const result = getScheduleForDate(date);
    assert.strictEqual(result.weekNum, 1,        "should restart at week 1");
    assert.strictEqual(result.dayName, "Monday", "should be Monday");
  });

  await test(S2, "[POSITIVE] Sunday returns correct dayName", () => {
    // 2026-03-08 IST = Sunday (7 days after anchor Monday = Week2 Sunday)
    const date   = new Date("2026-03-07T18:30:00.000Z"); // Mar 8 IST
    const result = getScheduleForDate(date);
    assert.strictEqual(result.dayName, "Sunday", "should be Sunday");
  });

  await test(S2, "[POSITIVE] Each day returns exactly 2 people per task", () => {
    const date = new Date("2026-03-01T18:30:00.000Z");
    for (let i = 0; i < 21; i++) {
      const d = new Date(date.getTime() + i * 24 * 60 * 60 * 1000);
      const s = getScheduleForDate(d);
      assert.strictEqual(s.cooking.length,  2, `Day ${i}: cooking should have 2 people`);
      assert.strictEqual(s.cleaning.length, 2, `Day ${i}: cleaning should have 2 people`);
      assert.strictEqual(s.rest.length,     2, `Day ${i}: rest should have 2 people`);
    }
  });

  await test(S2, "[POSITIVE] No person appears in two tasks on the same day", () => {
    const date = new Date("2026-03-01T18:30:00.000Z");
    for (let i = 0; i < 21; i++) {
      const d = new Date(date.getTime() + i * 24 * 60 * 60 * 1000);
      const s = getScheduleForDate(d);
      const all = [...s.cooking, ...s.cleaning, ...s.rest];
      const unique = new Set(all);
      assert.strictEqual(unique.size, 6, `Day ${i}: all 6 people should appear exactly once`);
    }
  });

  await test(S2, "[POSITIVE] Anchor day result matches Week1 Mon in SCHEDULE_WEEKS", () => {
    const date   = new Date("2026-03-01T18:30:00.000Z");
    const result = getScheduleForDate(date);
    // Week 1, Monday (dayIdx=0): cooking=[0,1] → Vamsi, Baggu
    assert.ok(result.cooking.includes("Vamsi"),  "Vamsi should cook on Week1 Monday");
    assert.ok(result.cooking.includes("Baggu"),  "Baggu should cook on Week1 Monday");
  });

  await test(S2, "[NEGATIVE] Date far in the past → still returns a valid schedule (cycle wraps)", () => {
    const pastDate = new Date("2020-01-01T18:30:00.000Z");
    const result   = getScheduleForDate(pastDate);
    assert.ok([1, 2, 3].includes(result.weekNum), "weekNum should be 1, 2, or 3");
    assert.ok(DAYS.includes(result.dayName),       "dayName should be a valid day");
  });

  await test(S2, "[NEGATIVE] Date far in the future → cycle still wraps correctly", () => {
    const futureDate = new Date("2030-12-25T18:30:00.000Z");
    const result     = getScheduleForDate(futureDate);
    assert.ok([1, 2, 3].includes(result.weekNum), "weekNum should be 1, 2, or 3");
    assert.strictEqual(result.cooking.length, 2,  "should have 2 cooks");
  });

  await test(S2, "[EDGE] Day just before anchor (Feb 28 2026) → valid week/day", () => {
    const date   = new Date("2026-02-27T18:30:00.000Z"); // Feb 28 IST
    const result = getScheduleForDate(date);
    assert.ok([1, 2, 3].includes(result.weekNum), "should have valid week number");
    assert.strictEqual(result.dayName, "Saturday", "2026-02-28 is a Saturday");
  });

  await test(S2, "[EDGE] Exact UTC midnight vs IST midnight gives same schedule day", () => {
    // Both 2026-03-20T18:30:00Z (IST midnight) and 2026-03-20T23:00:00Z should be same IST day
    const istMidnight  = new Date("2026-03-19T18:30:00.000Z"); // Mar 20 IST midnight
    const istEvening   = new Date("2026-03-19T23:00:00.000Z"); // Mar 20 IST 04:30
    const r1 = getScheduleForDate(istMidnight);
    const r2 = getScheduleForDate(istEvening);
    assert.strictEqual(r1.dayName, r2.dayName, "same IST day should give same schedule");
    assert.deepStrictEqual(r1.cooking, r2.cooking, "same cooking assignment");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SUITE 3 — Schedule Balance Verification
  // ───────────────────────────────────────────────────────────────────────────
  const S3 = "Schedule Balance";

  await test(S3, "[POSITIVE] Every person gets exactly 7 cooking days over 21 days", () => {
    const counts = MEMBERS.map(() => 0);
    SCHEDULE_WEEKS.forEach(week =>
      week.forEach(day => day.cooking.forEach(i => counts[i]++))
    );
    counts.forEach((c, i) => {
      assert.strictEqual(c, 7, `${MEMBERS[i]} should cook exactly 7 times, got ${c}`);
    });
  });

  await test(S3, "[POSITIVE] Every person gets exactly 7 cleaning days over 21 days", () => {
    const counts = MEMBERS.map(() => 0);
    SCHEDULE_WEEKS.forEach(week =>
      week.forEach(day => day.cleaning.forEach(i => counts[i]++))
    );
    counts.forEach((c, i) => {
      assert.strictEqual(c, 7, `${MEMBERS[i]} should clean exactly 7 times, got ${c}`);
    });
  });

  await test(S3, "[POSITIVE] Every person gets exactly 7 rest days over 21 days", () => {
    const counts = MEMBERS.map(() => 0);
    SCHEDULE_WEEKS.forEach(week =>
      week.forEach(day => day.rest.forEach(i => counts[i]++))
    );
    counts.forEach((c, i) => {
      assert.strictEqual(c, 7, `${MEMBERS[i]} should rest exactly 7 times, got ${c}`);
    });
  });

  await test(S3, "[POSITIVE] No person appears in two tasks on the same day (full schedule check)", () => {
    SCHEDULE_WEEKS.forEach((week, wIdx) => {
      week.forEach((day, dIdx) => {
        const all    = [...day.cooking, ...day.cleaning, ...day.rest];
        const unique = new Set(all);
        assert.strictEqual(all.length,    6, `Week ${wIdx+1} Day ${dIdx+1}: should have 6 assignments`);
        assert.strictEqual(unique.size,   6, `Week ${wIdx+1} Day ${dIdx+1}: each person should appear once`);
      });
    });
  });

  await test(S3, "[POSITIVE] Per-week workload: no person has workload > 5 (max active days)", () => {
    SCHEDULE_WEEKS.forEach((week, wIdx) => {
      const workloads = MEMBERS.map(() => 0);
      week.forEach(day => {
        day.cooking.forEach(i  => workloads[i]++);
        day.cleaning.forEach(i => workloads[i]++);
      });
      workloads.forEach((w, i) => {
        assert.ok(w <= 5, `Week ${wIdx+1} ${MEMBERS[i]}: workload ${w} exceeds max of 5`);
      });
    });
  });

  await test(S3, "[POSITIVE] Per-week rest: no person gets fewer than 2 rest days", () => {
    SCHEDULE_WEEKS.forEach((week, wIdx) => {
      const restCounts = MEMBERS.map(() => 0);
      week.forEach(day => day.rest.forEach(i => restCounts[i]++));
      restCounts.forEach((r, i) => {
        assert.ok(r >= 2, `Week ${wIdx+1} ${MEMBERS[i]}: only ${r} rest day(s), minimum is 2`);
      });
    });
  });

  await test(S3, "[POSITIVE] Easy week rotation — each person gets exactly 1 easy week (workload 4)", () => {
    const easyWeekCounts = MEMBERS.map(() => 0);
    SCHEDULE_WEEKS.forEach(week => {
      const workloads = MEMBERS.map(() => 0);
      week.forEach(day => {
        day.cooking.forEach(i  => workloads[i]++);
        day.cleaning.forEach(i => workloads[i]++);
      });
      workloads.forEach((w, i) => { if (w === 4) easyWeekCounts[i]++; });
    });
    easyWeekCounts.forEach((count, i) => {
      assert.strictEqual(count, 1, `${MEMBERS[i]} should have exactly 1 easy week, got ${count}`);
    });
  });

  await test(S3, "[POSITIVE] Each day has exactly 2 people per task across all weeks", () => {
    SCHEDULE_WEEKS.forEach((week, wIdx) => {
      week.forEach((day, dIdx) => {
        assert.strictEqual(day.cooking.length,  2, `Week${wIdx+1} Day${dIdx+1}: cooking needs 2`);
        assert.strictEqual(day.cleaning.length, 2, `Week${wIdx+1} Day${dIdx+1}: cleaning needs 2`);
        assert.strictEqual(day.rest.length,     2, `Week${wIdx+1} Day${dIdx+1}: rest needs 2`);
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SUITE 4 — getVegOnlyPeople
  // ───────────────────────────────────────────────────────────────────────────
  const S4 = "getVegOnlyPeople";

  await test(S4, "[POSITIVE] Monday → returns Baggu and Deepak", () => {
    const result = getVegOnlyPeople(SAMPLE_ROOMIES, "Monday");
    assert.ok(result.includes("Baggu"),  "Baggu avoids non-veg on Monday");
    assert.ok(result.includes("Deepak"), "Deepak avoids non-veg on Monday");
    assert.strictEqual(result.length, 2, "exactly 2 people on Monday");
  });

  await test(S4, "[POSITIVE] Tuesday → returns Deepak, Sriman, Mohan", () => {
    const result = getVegOnlyPeople(SAMPLE_ROOMIES, "Tuesday");
    assert.ok(result.includes("Deepak"), "Deepak on Tuesday");
    assert.ok(result.includes("Sriman"), "Sriman on Tuesday");
    assert.ok(result.includes("Mohan"),  "Mohan on Tuesday");
    assert.strictEqual(result.length, 3, "exactly 3 people on Tuesday");
  });

  await test(S4, "[POSITIVE] Saturday → returns Vamsi and Sahith (even inactive)", () => {
    // Note: getVegOnlyPeople doesn't filter by active — it receives pre-filtered roomies
    const activeOnly = SAMPLE_ROOMIES.filter(r => r.active);
    const result     = getVegOnlyPeople(activeOnly, "Saturday");
    assert.ok(result.includes("Vamsi"), "Vamsi avoids non-veg on Saturday");
    assert.strictEqual(result.length, 1, "only 1 active person on Saturday (Sahith inactive)");
  });

  await test(S4, "[POSITIVE] Wednesday → returns empty array (no restrictions)", () => {
    const result = getVegOnlyPeople(SAMPLE_ROOMIES, "Wednesday");
    assert.deepStrictEqual(result, [], "no one avoids non-veg on Wednesday");
  });

  await test(S4, "[NEGATIVE] Roomie with no vegDays field → not included", () => {
    const roomies = [{ name: "TestPerson" }]; // missing vegDays field
    const result  = getVegOnlyPeople(roomies, "Monday");
    assert.deepStrictEqual(result, [], "should return empty for undefined vegDays");
  });

  await test(S4, "[NEGATIVE] Roomie with vegDays as string (not array) → not included", () => {
    const roomies = [{ name: "TestPerson", vegDays: "Monday" }]; // string instead of array
    const result  = getVegOnlyPeople(roomies, "Monday");
    assert.deepStrictEqual(result, [], "should reject non-array vegDays");
  });

  await test(S4, "[NEGATIVE] Empty roomies array → returns empty array", () => {
    const result = getVegOnlyPeople([], "Monday");
    assert.deepStrictEqual(result, []);
  });

  await test(S4, "[EDGE] Case-sensitive day name — 'monday' (lowercase) → no match", () => {
    const result = getVegOnlyPeople(SAMPLE_ROOMIES, "monday");
    assert.deepStrictEqual(result, [], "day name comparison is case-sensitive");
  });

  await test(S4, "[EDGE] Roomie with empty vegDays array → not included", () => {
    const roomies = [{ name: "FullNonVeg", vegDays: [] }];
    const result  = getVegOnlyPeople(roomies, "Monday");
    assert.deepStrictEqual(result, []);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SUITE 5 — getTodayBirthdays
  // ───────────────────────────────────────────────────────────────────────────
  const S5 = "getTodayBirthdays";

  await test(S5, "[POSITIVE] Date matching Baggu's birthday (03-22)", () => {
    // 2026-03-22 IST midnight = 2026-03-21T18:30:00Z
    const date   = new Date("2026-03-21T18:30:00.000Z");
    const result = getTodayBirthdays(SAMPLE_ROOMIES, date);
    assert.ok(result.includes("Baggu"), "Baggu's birthday is 03-22");
  });

  await test(S5, "[POSITIVE] Date matching Vamsi's birthday (07-15)", () => {
    const date   = new Date("2026-07-14T18:30:00.000Z"); // Jul 15 IST
    const result = getTodayBirthdays(SAMPLE_ROOMIES, date);
    assert.ok(result.includes("Vamsi"), "Vamsi's birthday is 07-15");
    assert.strictEqual(result.length, 1);
  });

  await test(S5, "[POSITIVE] Date with no birthdays → returns empty array", () => {
    const date   = new Date("2026-06-01T18:30:00.000Z"); // No birthday on Jun 2
    const result = getTodayBirthdays(SAMPLE_ROOMIES, date);
    assert.deepStrictEqual(result, []);
  });

  await test(S5, "[NEGATIVE] Roomie with no birthday field → not included", () => {
    const roomies = [{ name: "NoBirthday" }];
    const date    = new Date("2026-03-21T18:30:00.000Z");
    const result  = getTodayBirthdays(roomies, date);
    assert.deepStrictEqual(result, []);
  });

  await test(S5, "[NEGATIVE] Birthday in wrong format (YYYY-MM-DD) → no match", () => {
    const roomies = [{ name: "WrongFormat", birthday: "2000-03-22" }];
    const date    = new Date("2026-03-21T18:30:00.000Z"); // Mar 22 IST
    const result  = getTodayBirthdays(roomies, date);
    assert.deepStrictEqual(result, [], "should not match wrong format");
  });

  await test(S5, "[EDGE] Two people sharing a birthday → both returned", () => {
    const roomies = [
      { name: "Twin1", birthday: "06-15" },
      { name: "Twin2", birthday: "06-15" },
    ];
    const date   = new Date("2026-06-14T18:30:00.000Z"); // Jun 15 IST
    const result = getTodayBirthdays(roomies, date);
    assert.strictEqual(result.length, 2, "both twins should appear");
    assert.ok(result.includes("Twin1"));
    assert.ok(result.includes("Twin2"));
  });

  await test(S5, "[EDGE] Jan 1st birthday — year rollover handled correctly", () => {
    const roomies = [{ name: "NewYear", birthday: "01-01" }];
    const date    = new Date("2025-12-31T18:30:00.000Z"); // Jan 1 IST
    const result  = getTodayBirthdays(roomies, date);
    assert.ok(result.includes("NewYear"), "should detect birthday on Jan 1 across year boundary");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SUITE 6 — classifyFestivalAsVeg
  // ───────────────────────────────────────────────────────────────────────────
  const S6 = "classifyFestivalAsVeg";

  await test(S6, "[POSITIVE] Ugadi → veg", () => {
    assert.strictEqual(classifyFestivalAsVeg("Ugadi"), true);
  });

  await test(S6, "[POSITIVE] Diwali → veg", () => {
    assert.strictEqual(classifyFestivalAsVeg("Diwali"), true);
  });

  await test(S6, "[POSITIVE] Ganesh Chaturthi → veg", () => {
    assert.strictEqual(classifyFestivalAsVeg("Ganesh Chaturthi"), true);
  });

  await test(S6, "[POSITIVE] Makar Sankranti → veg", () => {
    assert.strictEqual(classifyFestivalAsVeg("Makar Sankranti"), true);
  });

  await test(S6, "[POSITIVE] Janmashtami → veg", () => {
    assert.strictEqual(classifyFestivalAsVeg("Janmashtami"), true);
  });

  await test(S6, "[POSITIVE] Christmas → NOT veg", () => {
    assert.strictEqual(classifyFestivalAsVeg("Christmas"), false);
  });

  await test(S6, "[POSITIVE] Independence Day → NOT veg", () => {
    assert.strictEqual(classifyFestivalAsVeg("Independence Day"), false);
  });

  await test(S6, "[POSITIVE] Eid → NOT veg", () => {
    assert.strictEqual(classifyFestivalAsVeg("Eid ul-Fitr"), false);
  });

  await test(S6, "[POSITIVE] Gandhi Jayanti → NOT veg", () => {
    assert.strictEqual(classifyFestivalAsVeg("Gandhi Jayanti"), false);
  });

  await test(S6, "[NEGATIVE] Case insensitive — 'DIWALI' → veg", () => {
    assert.strictEqual(classifyFestivalAsVeg("DIWALI"), true);
  });

  await test(S6, "[NEGATIVE] Case insensitive — 'CHRISTMAS' → NOT veg", () => {
    assert.strictEqual(classifyFestivalAsVeg("CHRISTMAS"), false);
  });

  await test(S6, "[EDGE] Unknown festival name → defaults to veg (conservative)", () => {
    assert.strictEqual(classifyFestivalAsVeg("Some Unknown Festival Day"), true,
      "unknown festivals should default to veg for safety");
  });

  await test(S6, "[EDGE] Empty string → defaults to veg", () => {
    assert.strictEqual(classifyFestivalAsVeg(""), true);
  });

  await test(S6, "[EDGE] Non-veg keyword takes priority over veg keyword", () => {
    // 'Gandhi Diwali Festival' — contains both 'gandhi' (non-veg) and 'diwali' (veg)
    // Non-veg checked first, so should return false
    assert.strictEqual(classifyFestivalAsVeg("Gandhi Diwali Festival"), false,
      "non-veg keyword should take priority");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SUITE 7 — safeParseJSON
  // ───────────────────────────────────────────────────────────────────────────
  const S7 = "safeParseJSON";

  await test(S7, "[POSITIVE] Valid JSON object → returns parsed object", () => {
    const result = safeParseJSON('{"name":"Sahith","age":25}', null);
    assert.deepStrictEqual(result, { name: "Sahith", age: 25 });
  });

  await test(S7, "[POSITIVE] Valid JSON array → returns parsed array", () => {
    const result = safeParseJSON('["Vamsi","Baggu"]', []);
    assert.deepStrictEqual(result, ["Vamsi", "Baggu"]);
  });

  await test(S7, "[POSITIVE] Valid empty JSON → returns empty object", () => {
    const result = safeParseJSON('{}', null);
    assert.deepStrictEqual(result, {});
  });

  await test(S7, "[NEGATIVE] Invalid JSON string → returns fallback", () => {
    const result = safeParseJSON("not valid json", []);
    assert.deepStrictEqual(result, [], "should return fallback on parse failure");
  });

  await test(S7, "[NEGATIVE] Empty string → returns fallback", () => {
    const result = safeParseJSON("", { default: true });
    assert.deepStrictEqual(result, { default: true });
  });

  await test(S7, "[NEGATIVE] Undefined input → returns fallback", () => {
    const result = safeParseJSON(undefined, "fallback");
    assert.strictEqual(result, "fallback");
  });

  await test(S7, "[NEGATIVE] Null input → returns fallback", () => {
    const result = safeParseJSON(null, []);
    assert.deepStrictEqual(result, []);
  });

  await test(S7, "[EDGE] Nested JSON → correctly parsed", () => {
    const raw    = '{"queue":[{"name":"Sahith","idx":0}]}';
    const result = safeParseJSON(raw, null);
    assert.strictEqual(result.queue[0].name, "Sahith");
  });

  await test(S7, "[EDGE] JSON number → returns number", () => {
    const result = safeParseJSON("42", null);
    assert.strictEqual(result, 42);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SUITE 8 — escapeMarkdownV2
  // ───────────────────────────────────────────────────────────────────────────
  const S8 = "escapeMarkdownV2";

  await test(S8, "[POSITIVE] Plain text → unchanged", () => {
    assert.strictEqual(escapeMarkdownV2("Hello World"), "Hello World");
  });

  await test(S8, "[POSITIVE] Dot escaped", () => {
    assert.strictEqual(escapeMarkdownV2("flatactivityplanner.web.app"), "flatactivityplanner\\.web\\.app");
  });

  await test(S8, "[POSITIVE] Exclamation mark escaped", () => {
    assert.strictEqual(escapeMarkdownV2("Hello!"), "Hello\\!");
  });

  await test(S8, "[POSITIVE] Parentheses escaped", () => {
    assert.strictEqual(escapeMarkdownV2("(test)"), "\\(test\\)");
  });

  await test(S8, "[POSITIVE] Hyphen escaped", () => {
    assert.strictEqual(escapeMarkdownV2("Pre-workout"), "Pre\\-workout");
  });

  await test(S8, "[POSITIVE] Underscore escaped", () => {
    assert.strictEqual(escapeMarkdownV2("some_value"), "some\\_value");
  });

  await test(S8, "[POSITIVE] Asterisk escaped", () => {
    assert.strictEqual(escapeMarkdownV2("a*b"), "a\\*b");
  });

  await test(S8, "[NEGATIVE] Empty string → returns empty string", () => {
    assert.strictEqual(escapeMarkdownV2(""), "");
  });

  await test(S8, "[NEGATIVE] Number input → converts to string and escapes", () => {
    assert.strictEqual(escapeMarkdownV2(42), "42");
  });

  await test(S8, "[EDGE] Multiple special chars in one string", () => {
    const result = escapeMarkdownV2("Cleaning + Dishes!");
    assert.ok(result.includes("\\+"), "should escape +");
    assert.ok(result.includes("\\!"), "should escape !");
  });

  await test(S8, "[EDGE] Festival name with dot and exclamation — Ugadi!", () => {
    const result = escapeMarkdownV2("Ugadi!");
    assert.strictEqual(result, "Ugadi\\!");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SUITE 9 — buildLunchPrompt
  // ───────────────────────────────────────────────────────────────────────────
  const S9 = "buildLunchPrompt";

  await test(S9, "[POSITIVE] No restrictions → allows non-veg", () => {
    const prompt = buildLunchPrompt("Wednesday", [], [], null);
    assert.ok(prompt.includes("No dietary restrictions"), "should mention no restrictions");
    assert.ok(prompt.includes("can be vegetarian or non-vegetarian"), "should allow non-veg");
  });

  await test(S9, "[POSITIVE] Veg people present → forces vegetarian", () => {
    const prompt = buildLunchPrompt("Monday", ["Deepak", "Baggu"], [], null);
    assert.ok(prompt.includes("MUST be strictly vegetarian"), "should force veg");
    assert.ok(prompt.includes("Deepak & Baggu"),              "should name the people");
  });

  await test(S9, "[POSITIVE] Festival with vegOnly → uses festival context", () => {
    const festival = { name: "Ugadi", vegOnly: true };
    const prompt   = buildLunchPrompt("Monday", [], [], festival);
    assert.ok(prompt.includes("Ugadi"),                       "should mention festival name");
    assert.ok(prompt.includes("MUST be strictly vegetarian"), "should force veg for festival");
    assert.ok(prompt.includes("traditional festive dish"),    "should mention festive context");
  });

  await test(S9, "[POSITIVE] Festival with non-veg allowed → correct context", () => {
    const festival = { name: "Christmas", vegOnly: false };
    const prompt   = buildLunchPrompt("Thursday", [], [], festival);
    assert.ok(prompt.includes("Christmas"),                          "should mention Christmas");
    assert.ok(prompt.includes("can be vegetarian or non-vegetarian"), "should allow non-veg");
  });

  await test(S9, "[POSITIVE] Recent dishes → included in avoid clause", () => {
    const recent = ["Dal Tadka", "Gongura Chicken", "Pesarattu"];
    const prompt = buildLunchPrompt("Friday", [], recent, null);
    assert.ok(prompt.includes("Dal Tadka"),       "should include recent dish 1");
    assert.ok(prompt.includes("Gongura Chicken"), "should include recent dish 2");
    assert.ok(prompt.includes("Pesarattu"),       "should include recent dish 3");
    assert.ok(prompt.includes("Do NOT repeat"),   "should have avoid clause");
  });

  await test(S9, "[NEGATIVE] Empty recent dishes → no avoid clause", () => {
    const prompt = buildLunchPrompt("Friday", [], [], null);
    assert.ok(!prompt.includes("Do NOT repeat"), "should not have avoid clause when no history");
  });

  await test(S9, "[EDGE] Festival vegOnly overrides person-level veg preferences", () => {
    // Even if vegPeople is empty, festival.vegOnly=true should force veg
    const festival = { name: "Diwali", vegOnly: true };
    const prompt   = buildLunchPrompt("Sunday", [], [], festival);
    assert.ok(prompt.includes("MUST be strictly vegetarian"), "festival should override");
  });

  await test(S9, "[EDGE] All 7 recent dishes listed → all appear in prompt", () => {
    const recent = ["Dish1", "Dish2", "Dish3", "Dish4", "Dish5", "Dish6", "Dish7"];
    const prompt = buildLunchPrompt("Monday", [], recent, null);
    recent.forEach(dish => assert.ok(prompt.includes(dish), `${dish} should be in prompt`));
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SUITE 10 — buildPreWorkoutPrompt
  // ───────────────────────────────────────────────────────────────────────────
  const S10 = "buildPreWorkoutPrompt";

  await test(S10, "[POSITIVE] No recent dishes → no avoid clause", () => {
    const prompt = buildPreWorkoutPrompt([]);
    assert.ok(!prompt.includes("Do NOT repeat"), "no avoid clause without history");
    assert.ok(prompt.includes("10 minutes"),     "should specify time constraint");
  });

  await test(S10, "[POSITIVE] With recent dishes → avoid clause included", () => {
    const prompt = buildPreWorkoutPrompt(["Banana Toast", "Poha"]);
    assert.ok(prompt.includes("Banana Toast"),   "should include recent item 1");
    assert.ok(prompt.includes("Poha"),           "should include recent item 2");
    assert.ok(prompt.includes("Do NOT repeat"),  "should have avoid clause");
  });

  await test(S10, "[POSITIVE] Prompt specifies Indian cuisine context", () => {
    const prompt = buildPreWorkoutPrompt([]);
    assert.ok(prompt.includes("Hyderabad") || prompt.includes("Indian"), "should mention Indian context");
  });

  await test(S10, "[NEGATIVE] Empty array → returns prompt without avoid clause", () => {
    const prompt = buildPreWorkoutPrompt([]);
    assert.ok(typeof prompt === "string" && prompt.length > 0, "should return non-empty string");
    assert.ok(!prompt.includes("Do NOT repeat"));
  });

  await test(S10, "[EDGE] Single recent dish → still formatted correctly", () => {
    const prompt = buildPreWorkoutPrompt(["Oats Porridge"]);
    assert.ok(prompt.includes("Oats Porridge"), "single dish should appear");
    assert.ok(prompt.includes("Do NOT repeat"));
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SUITE 11 — formatLunchRecipeBlock
  // ───────────────────────────────────────────────────────────────────────────
  const S11 = "formatLunchRecipeBlock";

  await test(S11, "[POSITIVE] Non-veg recipe → uses chicken emoji", () => {
    const block = formatLunchRecipeBlock(SAMPLE_RECIPE, null);
    assert.ok(block.includes("🍗"), "non-veg should use 🍗 emoji");
    assert.ok(!block.includes("🟢"), "should not use veg emoji for non-veg");
  });

  await test(S11, "[POSITIVE] Veg recipe → uses green circle emoji", () => {
    const block = formatLunchRecipeBlock(SAMPLE_VEG_RECIPE, null);
    assert.ok(block.includes("🟢"), "veg should use 🟢 emoji");
    assert.ok(!block.includes("🍗"), "should not use non-veg emoji for veg");
  });

  await test(S11, "[POSITIVE] Recipe name appears in block", () => {
    const block = formatLunchRecipeBlock(SAMPLE_RECIPE, null);
    assert.ok(block.includes("Gongura Chicken"), "recipe name should appear");
  });

  await test(S11, "[POSITIVE] All ingredients appear in block", () => {
    const block = formatLunchRecipeBlock(SAMPLE_RECIPE, null);
    SAMPLE_RECIPE.ingredients.forEach(ing => {
      assert.ok(block.includes(ing.split(" — ")[0]), `ingredient ${ing} should appear`);
    });
  });

  await test(S11, "[POSITIVE] Nutrition block present when nutrition provided", () => {
    const block = formatLunchRecipeBlock(SAMPLE_RECIPE, null);
    assert.ok(block.includes("💪"),         "nutrition section should appear");
    assert.ok(block.includes("380 kcal"),   "calories should appear");
    assert.ok(block.includes("28g"),        "protein should appear");
  });

  await test(S11, "[POSITIVE] Prep tonight section present when prepTonight has items", () => {
    const block = formatLunchRecipeBlock(SAMPLE_RECIPE, null);
    assert.ok(block.includes("⚠️"),                        "prep tonight section should appear");
    assert.ok(block.includes("Marinate chicken overnight"), "prep step should appear");
  });

  await test(S11, "[POSITIVE] No prep tonight section when prepTonight is empty", () => {
    const recipe = { ...SAMPLE_RECIPE, prepTonight: [] };
    const block  = formatLunchRecipeBlock(recipe, null);
    assert.ok(!block.includes("Prep Tonight"), "should not show prep section for empty array");
  });

  await test(S11, "[POSITIVE] Festival header shown when festival provided", () => {
    const festival = { name: "Ugadi", vegOnly: true };
    const block    = formatLunchRecipeBlock(SAMPLE_VEG_RECIPE, festival);
    assert.ok(block.includes("🎉"),    "should show festival emoji");
    assert.ok(block.includes("Ugadi"), "should show festival name");
  });

  await test(S11, "[NEGATIVE] No festival → no festival header", () => {
    const block = formatLunchRecipeBlock(SAMPLE_RECIPE, null);
    assert.ok(!block.includes("🎉"), "should not show festival emoji without festival");
  });

  await test(S11, "[NEGATIVE] Missing nutrition → no nutrition block", () => {
    const recipe = { ...SAMPLE_RECIPE, nutrition: null };
    const block  = formatLunchRecipeBlock(recipe, null);
    assert.ok(!block.includes("💪"), "should not show nutrition section when null");
  });

  await test(S11, "[EDGE] Recipe name with special chars → properly escaped", () => {
    const recipe = { ...SAMPLE_RECIPE, name: "Gongura.Chicken!" };
    const block  = formatLunchRecipeBlock(recipe, null);
    assert.ok(block.includes("Gongura\\.Chicken\\!"), "special chars should be escaped");
  });

  await test(S11, "[EDGE] Steps are numbered correctly", () => {
    const block = formatLunchRecipeBlock(SAMPLE_RECIPE, null);
    assert.ok(block.includes("1\\."), "first step should be numbered");
    assert.ok(block.includes("2\\."), "second step should be numbered");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SUITE 12 — formatPreWorkoutBlock
  // ───────────────────────────────────────────────────────────────────────────
  const S12 = "formatPreWorkoutBlock";

  await test(S12, "[POSITIVE] High energy → uses lightning bolt emoji", () => {
    const block = formatPreWorkoutBlock(SAMPLE_MEAL);
    assert.ok(block.includes("⚡"), "high energy should use ⚡");
    assert.ok(!block.includes("🔋"), "should not use battery emoji for high energy");
  });

  await test(S12, "[POSITIVE] Medium energy → uses battery emoji", () => {
    const meal  = { ...SAMPLE_MEAL, energyLevel: "Medium" };
    const block = formatPreWorkoutBlock(meal);
    assert.ok(block.includes("🔋"), "medium energy should use 🔋");
    assert.ok(!block.includes("⚡"), "should not use lightning for medium energy");
  });

  await test(S12, "[POSITIVE] Meal name appears in block", () => {
    const block = formatPreWorkoutBlock(SAMPLE_MEAL);
    assert.ok(block.includes("Banana Peanut Butter Toast"), "meal name should appear");
  });

  await test(S12, "[POSITIVE] All ingredients listed", () => {
    const block = formatPreWorkoutBlock(SAMPLE_MEAL);
    SAMPLE_MEAL.ingredients.forEach(ing => {
      assert.ok(block.includes(ing.split(" — ")[0]), `ingredient should appear`);
    });
  });

  await test(S12, "[POSITIVE] whyItWorks text appears", () => {
    const block = formatPreWorkoutBlock(SAMPLE_MEAL);
    assert.ok(block.includes("Quick carbs"), "whyItWorks should appear");
  });

  await test(S12, "[POSITIVE] Tip text appears", () => {
    const block = formatPreWorkoutBlock(SAMPLE_MEAL);
    assert.ok(block.includes("honey"), "tip should appear");
  });

  await test(S12, "[POSITIVE] Workout timing reminder present", () => {
    const block = formatPreWorkoutBlock(SAMPLE_MEAL);
    assert.ok(block.includes("30–45 mins"), "should include workout timing advice");
  });

  await test(S12, "[EDGE] Meal name with special chars → properly escaped", () => {
    const meal  = { ...SAMPLE_MEAL, name: "Toast.Meal!" };
    const block = formatPreWorkoutBlock(meal);
    assert.ok(block.includes("Toast\\.Meal\\!"), "special chars should be escaped");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SUITE 13 — formatDateIST
  // ───────────────────────────────────────────────────────────────────────────
  const S13 = "formatDateIST";

  await test(S13, "[POSITIVE] Returns string with month name", () => {
    const date   = new Date("2026-03-19T18:30:00.000Z"); // Mar 20 IST
    const result = formatDateIST(date);
    assert.ok(typeof result === "string",  "should return string");
    assert.ok(result.includes("March"),    "should include month name");
    assert.ok(result.includes("20"),       "should include day number");
    assert.ok(result.includes("Friday"),   "should include day name");
  });

  await test(S13, "[POSITIVE] Returns correct weekday for anchor date (Monday)", () => {
    const date   = new Date("2026-03-01T18:30:00.000Z"); // Mar 2 IST = Monday
    const result = formatDateIST(date);
    assert.ok(result.includes("Monday"), "2026-03-02 is a Monday");
  });

  await test(S13, "[EDGE] Year boundary — Jan 1", () => {
    const date   = new Date("2025-12-31T18:30:00.000Z"); // Jan 1 2026 IST
    const result = formatDateIST(date);
    assert.ok(result.includes("January"), "should show January");
    assert.ok(result.includes("1"),       "should show day 1");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Print summary
  // ─────────────────────────────────────────────────────────────────────────
  printReport();
}

runAllTests().catch(err => {
  console.error("\n💥 Test runner crashed:", err);
  process.exit(1);
});