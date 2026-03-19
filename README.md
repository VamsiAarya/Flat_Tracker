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
