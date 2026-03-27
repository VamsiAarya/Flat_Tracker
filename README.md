# 🏠 Roomies — Flat Activity Planner

> A real-time duty tracker and cooking schedule manager for 6 roommates, with automated Telegram notifications.

**Live App → [flatactivityplanner.web.app](https://flatactivityplanner.web.app)**

---

## ✨ Features

### 📅 Cooking Schedule
- **3-week rotating schedule** — perfectly balanced across all 6 roommates
- Every person gets exactly **7 cooking, 7 cleaning, 7 rest days** per cycle
- Weekly workload is fair — everyone gets exactly **1 easy week** (workload 4) per cycle
- Auto-detects the **current week** based on IST timezone
- **Today's duty** highlighted prominently at the top
- **Swap feature** — swap duties between any two people for a specific day, synced in real-time across all devices

### 🔄 Turn Tracker (Dustbin Duty)
- Tracks who clears the dustbin in a rotating queue
- **Done** — marks current person complete, advances to next
- **Skip** — skips a person, retries them after every subsequent turn
- **Undo** — reverts the last action
- Full **completion history** with editable dates
- All state synced live via Firebase Firestore

### 🔔 Telegram Notifications
- **7:30 AM IST daily** — sends today's full cooking/cleaning/rest schedule to the group
- **On duty completion** — notifies the group who cleared the dustbin and who's up tomorrow
- **Max 2 messages per day** — morning reminder + 1 done notification, no spam
- If Done is undone, the notification lock is released so it can fire again

### 🤖 AI-Powered Pre-Workout Suggestions
- 6:00 AM IST daily — automatically sends a pre-workout meal suggestion to the Telegram group
- Uses Cloudflare Workers AI (Llama 3.1) to generate quick, energy-rich meals
- Suggestions are optimized for Indian household ingredients
- Ready in under 10 minutes — practical for morning routines
- Automatically avoids repeating recent meals using history tracking
- Stores suggestion history in Firestore for smarter future recommendations
### 🍽 Smart Lunch Planning
- 10:00 PM IST daily — sends tomorrow's lunch recipe suggestion to the group
- Automatically detects Indian festivals using Google Calendar API
- Enforces vegetarian-only meals on festival days or based on roommate preferences
Provides:
- Ingredients list
- Step-by-step cooking instructions
- Nutrition information per serving
- Overnight preparation steps (if required)
- Prevents repeating recently cooked dishes using history tracking
- Designed for Andhra-style home cooking
### ⚙️ Fully Automated Daily Workflow
- Runs entirely on serverless scheduled functions
- No manual triggers required
- Timezone-aware execution using Asia/Kolkata (IST)
Automatically handles:
- Daily reminders
- Meal suggestions
- Duty notifications
- Festival detection
- Built for reliability — continues operating even if external APIs temporarily fail
### 🧠 Intelligent System Design
- History tracking — remembers recent meals to avoid repetition
- Festival-aware logic — adjusts meals automatically based on holidays
- Dietary-aware planning — respects vegetarian preferences per roommate
- Real-time synchronization across all devices via Firestore
- Structured logging for easy debugging and monitoring
### 🛡 Reliability & Safety Controls
- Notification throttling — prevents duplicate messages per day
- Undo-safe logic — allows reversing actions without breaking system state
- Error-safe fallbacks — sends default messages if AI or APIs fail
- Automatic retry-safe execution — prevents inconsistent states
- Low-maintenance architecture — runs reliably without supervision
### 💰 Cost-Optimized Architecture
- Designed to run within the Firebase free tier
- Uses serverless infrastructure — no servers to manage
- Minimal database reads/writes to control costs
### Typical monthly cost:
- ₹0 – ₹10
- Scales automatically without manual configuration

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML, CSS, JavaScript |
| Database | Firebase Firestore (real-time sync) |
| Hosting | Firebase Hosting |
| Backend | Firebase Cloud Functions v2 (Node.js 22) |
| Notifications | Telegram Bot API |
| Secrets | Google Secret Manager |
| Scheduler | Google Cloud Scheduler |
