# TNGO Roomies — Firebase CLI Commands Reference

---

## 🔧 Initial Setup

```bash
# Install Firebase CLI globally
npm install -g firebase-tools

# Login to Firebase
firebase login

# Initialise project (run once in repo root)
firebase init

# Select project
firebase use <project-id>

# List available projects
firebase projects:list
```

---

## 🚀 Deployment

```bash
# Deploy everything (functions + hosting)
firebase deploy

# Deploy only Cloud Functions
firebase deploy --only functions

# Deploy a single specific function
firebase deploy --only functions:dailyMorningReminder
firebase deploy --only functions:eveningRecipeSuggestion
firebase deploy --only functions:preWorkoutSuggestion
firebase deploy --only functions:onDutyMarkedDone

# Deploy only hosting (frontend)
firebase deploy --only hosting
```

---

## 🔑 Secrets Management

```bash
# Set a secret (prompts for value)
firebase functions:secrets:set TELEGRAM_BOT_TOKEN
firebase functions:secrets:set TELEGRAM_CHAT_ID
firebase functions:secrets:set CF_API_TOKEN
firebase functions:secrets:set CF_ACCOUNT_ID

# View all secrets (names only, not values)
firebase functions:secrets:access TELEGRAM_BOT_TOKEN

# List all secrets in the project
firebase functions:secrets:list

# Destroy a secret (use with caution)
firebase functions:secrets:destroy TELEGRAM_BOT_TOKEN
```

---

## ⚡ Local Emulator

```bash
# Install emulator dependencies (first time)
firebase init emulators

# Start all emulators (Functions + Firestore + Hosting)
firebase emulators:start

# Start only Functions + Firestore emulators
firebase emulators:start --only functions,firestore

# Start emulators and import a Firestore snapshot
firebase emulators:start --import=./emulator-data

# Export Firestore data from running emulator (for seeding later)
firebase emulators:export ./emulator-data
```

---

## 🧪 Manually Triggering Functions

```bash
# Trigger a scheduled function manually via HTTP (emulator)
curl -X POST http://127.0.0.1:5001/<project-id>/asia-south1/dailyMorningReminder

# Trigger in production using Firebase Functions shell
firebase functions:shell
# Then inside shell:
dailyMorningReminder()
eveningRecipeSuggestion()
preWorkoutSuggestion()
```

---

## 📋 Logs & Monitoring

```bash
# Stream live logs from all functions
firebase functions:log

# Stream logs for a specific function
firebase functions:log --only dailyMorningReminder
firebase functions:log --only onDutyMarkedDone

# Show last N log lines
firebase functions:log --lines 50
```

---

## 🗃️ Firestore

```bash
# Open Firestore in browser (Firestore console)
firebase open firestore

# Export Firestore data to GCS bucket (backup)
gcloud firestore export gs://<your-bucket>/backups/$(date +%Y%m%d)

# Import Firestore data from GCS
gcloud firestore import gs://<your-bucket>/backups/<folder>

# Delete a specific Firestore document (use with care)
firebase firestore:delete tracker/notifications --yes
```

---

## 🏠 Hosting

```bash
# Preview hosting locally
firebase hosting:channel:deploy preview --expires 1d

# List all hosting channels (preview URLs)
firebase hosting:channel:list

# Delete a preview channel
firebase hosting:channel:delete preview
```

---

## 🔁 Function Management

```bash
# List all deployed functions
firebase functions:list

# Delete a specific function (removes from Cloud)
firebase functions:delete preWorkoutSuggestion

# Set environment config (legacy — use secrets for sensitive values)
firebase functions:config:set app.url="https://flatactivityplanner.web.app/"

# Get current config
firebase functions:config:get
```

---

## 🛠️ Useful Combos

```bash
# Full redeploy after code changes
firebase deploy --only functions && firebase functions:log --lines 30

# Quick test cycle: deploy single function + stream its logs
firebase deploy --only functions:onDutyMarkedDone && firebase functions:log --only onDutyMarkedDone

# Run local tests before deploying
node test.js && firebase deploy --only functions
```

---

## 📌 Project Info

| Item              | Value                                          |
|-------------------|------------------------------------------------|
| App URL           | https://flatactivityplanner.web.app/           |
| Region            | asia-south1                                    |
| Timezone          | Asia/Kolkata (IST)                             |
| AI Model          | @cf/meta/llama-3.1-8b-instruct (Cloudflare)    |
| Schedule 1        | preWorkoutSuggestion — 06:00 AM IST daily      |
| Schedule 2        | dailyMorningReminder — 07:30 AM IST daily      |
| Schedule 3        | eveningRecipeSuggestion — 10:00 PM IST daily   |
| Firestore Trigger | onDutyMarkedDone — tracker/state updates       |
