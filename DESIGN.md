# Uplift - Fatigue Management & Pacing App

> *Gently expand your possibilities, one day at a time*

## Overview

A pacing app using **energy envelope theory** to help people with chronic fatigue, ME/CFS, Long COVID, and other energy-limiting conditions track their activity, monitor energy levels, and prevent crashes with colorful hot air balloon-themed visualizations.

## 🌟 The Balloon Philosophy

- **Rise slowly** - Gradual, consistent effort builds capacity over time
- **Don't burn too hard** - Fly too high and risk a crash
- **Find your balance** - Stay within your energy envelope for sustainable recovery

## Core Concepts

### Energy Envelope
The range of activity a user can sustain without triggering a crash. Uplift helps users discover and respect their envelope over time.

### Activity Color Coding
Every logged activity is rated by exertion level:
- **Green** - Low effort, well within limits (e.g. light stretching, watching TV, short phone call)
- **Yellow** - Moderate effort, approaching limits (e.g. cooking a meal, a short walk, focused work for 30 min)
- **Red** - High effort, at or beyond limits (e.g. heavy exercise, long outing, emotionally draining event)

These ratings are personal and learned over time — what's green for one user may be yellow for another.

### Effort Categories
Activities are tagged by the type of effort involved:
- **Physical** - bodily exertion, movement, exercise
- **Cognitive** - concentration, problem-solving, reading, screen work
- **Social** - interaction with others, phone calls, events
- **Sensory**: noisy/bright environments, crowds, travel
- **Emotional** - stressful situations, conflict, grief, excitement

An activity can span multiple categories (e.g. a work meeting may be cognitive + social).

### Crash / PEM Tracking
A crash is a significant worsening of symptoms following activity. Uplift tracks:
- Whether a crash occurred
- Severity (mild / moderate / severe)
- Onset delay (same day, next day, 2+ days)
- Suspected trigger activities

---

## Feature 1: Nightly Check-in

### Purpose
A conversational end-of-day diary that captures what the user did, how it felt, and whether they experienced any crashes or warning signs.

### Interaction Model
The user talks to an AI assistant via **text or voice**. The conversation is freeform and natural — the user describes their day and the AI extracts structured data from it.

### AI Responsibilities
1. **Extract activities** from the user's narrative (e.g. "I went grocery shopping and then cooked dinner" becomes two activities)
2. **Assign a color** (green/yellow/red) to each activity based on the user's description and historical patterns
3. **Categorize effort type** (physical, cognitive, social, emotional) for each activity
4. **Ask follow-up questions** if something sounds like it was hard or taxing
5. **Ask about crashes** — did the user experience any PEM symptoms today?
6. **Flag warning signs** — if the day looks overloaded (too many yellows/reds, back-to-back effort), surface that gently

### Conversation Flow
```
1. Open-ended prompt: "How was your day? What did you get up to?"
2. User describes their day freely
3. AI summarizes extracted activities with colors and categories
4. AI asks clarifying questions:
   - "That sounds like it was tough — would you say the shopping trip was more of a yellow or red?"
   - "Did anything feel particularly draining today?"
   - "Any crashes or symptom flare-ups?"
5. User confirms or adjusts
6. Summary saved
```

### Data Captured Per Entry
| Field | Type | Description |
|-------|------|-------------|
| date | date | The day being reviewed |
| is_backdated | bool | True if this check-in was done for a previous day |
| activities | list | Extracted activities (see below) |
| crash_occurred | bool | Whether a crash/PEM episode happened |
| crash_severity | enum | mild / moderate / severe (if applicable) |
| crash_suspected_triggers | list | Activities the user thinks caused it |
| overall_notes | text | Any free-text notes |
| raw_transcript | text | Full conversation transcript for re-analysis |

### Activity Schema
| Field | Type | Description |
|-------|------|-------------|
| name | string | Short description (e.g. "Grocery shopping") |
| color | enum | green / yellow / red |
| effort_types | list | physical, cognitive, social, emotional |
| duration_minutes | int? | Approximate duration if mentioned |
| notes | string? | Any extra context |

### Day History View
A simple visual timeline/calendar where each day is color-coded by its overall exertion:
- **Green day** - mostly green activities, no crashes
- **Yellow day** - some yellow activities or a high activity count
- **Red day** - red activities, a crash, or clear overexertion

Users can tap a day to see the activity breakdown. The view should make patterns immediately visible — e.g. a string of yellow days followed by a red crash day.

### Backdated Check-ins
Users can add a check-in for a previous day. This is important because fatigue itself can prevent someone from checking in — a crash day or a bad stretch might mean several missed days.

- From the day history view, tapping an empty day offers to start a check-in for that date
- The AI conversation adapts its wording (e.g. "Let's look back at Tuesday — what do you remember doing?")
- Backdated entries are expected to be rougher — less detail, approximate durations, fewer activities. That's fine.
- Backdated entries are marked as such in the data so analysis can account for reduced accuracy
- Users can also backfill multiple days in one session (e.g. "I was out for three days, let me catch up")

The goal is zero guilt about missed days — the app should make it easy to fill in gaps without pressure.

---

## Feature 2: Morning Check-in

### Purpose
A quick, low-effort check-in to capture baseline state before the day starts. Should take under 30 seconds.

### Interaction Model
Simple form — no AI conversation needed. Two inputs:

1. **Sleep quality**: "How did you sleep?"
   - Options: Terrible / Poor / OK / Good / Great (or a simple 1-5 tap)

2. **Energy level**: "How's your energy this morning?"
   - 1-5 scale with simple icons or labels (e.g. 1 = empty, 5 = full)

### Data Captured
| Field | Type | Description |
|-------|------|-------------|
| date | date | Today's date |
| sleep_quality | int (1-5) | Self-reported sleep quality |
| energy_level | int (1-5) | Self-reported morning energy |
| timestamp | datetime | When the check-in was completed |

### Design Notes
- This must be **fast and frictionless** — if it takes more than a few taps, users won't do it consistently
- Consider a notification/reminder at a user-configured morning time
- Morning energy + previous night's activity load is a key correlation for analysis

---

## Feature 3: Insights & Analysis (Future)

### Purpose
Analyze accumulated check-in data to surface patterns, trends, and actionable suggestions. Help the user understand what's working and what's causing problems.

### Planned Capabilities
- **Trend detection** — "Your energy has been declining over the past week"
- **Crash pattern analysis** — "You tend to crash the day after doing 2+ yellow activities"
- **Category insights** — "Social activities seem to drain you more than physical ones"
- **Pacing suggestions** — "Consider spacing out your cognitive tasks across the week"
- **Progress tracking** — "You've had fewer red days this month compared to last"
- **Envelope estimation** — over time, estimate the user's sustainable daily activity load

### Design Status
To be designed in detail later once data model and check-in flows are established. The quality of insights depends on having enough historical data to analyze.

---

## Technical Stack

### Platform: React Native + Expo
- **Expo managed workflow** — handles build tooling, OTA updates, and cross-platform complexity
- Primary development on **Android**, portable to iOS with no architectural changes
- Expo provides push notifications, SQLite, and secure storage out of the box
- EAS Build for producing APKs/AABs (free tier: 30 builds/month) and iOS builds when needed

### AI / LLM Integration

#### Nightly Check-in LLM
The conversational check-in needs an LLM that can extract structured activity data from freeform text. The LLM is called via cloud API directly from the app (no backend needed initially).

**Recommended: Google Gemini API (free tier)**
- 15 requests/minute, 1 million tokens/day on Gemini Flash — more than enough for personal use
- Supports structured output / function calling for reliable activity extraction
- Free tier covers daily use comfortably (a nightly check-in is ~5-10k tokens total)
- If usage grows beyond free tier, pay-as-you-go is very cheap

**Alternatives if needed:**
- **Claude API** — best quality conversation, no free tier but ~$0.15-0.30/month at daily use with Haiku/Sonnet
- **OpenAI GPT-4o-mini** — ~$0.05-0.10/month, good structured output support
- **Groq** — free tier available, very fast inference

The API key is stored in the app (acceptable for personal use). If the app ever goes multi-user, move API calls behind a backend.

#### AI Check-in Setup
1. Copy `.env.example` to `.env`.
2. Set `EXPO_PUBLIC_GEMINI_API_KEY` to your Gemini API key.
3. (Optional) Set `EXPO_PUBLIC_GEMINI_MODEL` to a specific model (defaults to `gemini-1.5-flash`).
4. Restart `expo start` so the env vars are loaded.

#### Structured Output
Use the LLM's function calling / tool use to extract activities reliably:
```json
{
  "activities": [
    { "name": "Grocery shopping", "color": "yellow", "effort_types": ["physical"], "duration_minutes": 45 },
    { "name": "Cooked dinner", "color": "green", "effort_types": ["physical"], "duration_minutes": 30 }
  ],
  "crash_occurred": false,
  "follow_up_question": "You mentioned the shopping felt tiring — was it more of a yellow or red for you?"
}
```

#### Voice Input
- **react-native-voice** or **expo-speech** — uses the device's native speech-to-text engine (free, offline-capable)
- No need for Whisper API — Android and iOS both have good built-in STT
- Voice input gets transcribed to text, then sent to the LLM as if the user typed it

### Data Storage

#### Local-first: SQLite via expo-sqlite
- All data stored on-device in SQLite — works offline, no account needed, fast
- Good for structured query of activity history (e.g. "show me all red days in the last month")
- expo-sqlite is well-supported in Expo managed workflow

#### Schema (simplified)
```sql
-- Morning check-ins
CREATE TABLE morning_checkins (
  id INTEGER PRIMARY KEY,
  date TEXT UNIQUE NOT NULL,
  sleep_quality INTEGER NOT NULL,  -- 1-5
  energy_level INTEGER NOT NULL,   -- 1-5
  created_at TEXT NOT NULL
);

-- Nightly check-ins
CREATE TABLE nightly_checkins (
  id INTEGER PRIMARY KEY,
  date TEXT UNIQUE NOT NULL,
  is_backdated INTEGER NOT NULL DEFAULT 0,
  crash_occurred INTEGER NOT NULL DEFAULT 0,
  crash_severity TEXT,             -- mild/moderate/severe
  overall_notes TEXT,
  raw_transcript TEXT,
  created_at TEXT NOT NULL
);

-- Activities (linked to nightly check-ins)
CREATE TABLE activities (
  id INTEGER PRIMARY KEY,
  checkin_id INTEGER NOT NULL REFERENCES nightly_checkins(id),
  name TEXT NOT NULL,
  color TEXT NOT NULL,             -- green/yellow/red
  effort_physical INTEGER NOT NULL DEFAULT 0,
  effort_cognitive INTEGER NOT NULL DEFAULT 0,
  effort_social INTEGER NOT NULL DEFAULT 0,
  effort_emotional INTEGER NOT NULL DEFAULT 0,
  duration_minutes INTEGER,
  notes TEXT
);
```

#### Cloud Sync (future, not MVP)
When ready to add sync, best free-tier options:
- **Supabase** — free tier: 500MB database, 50k monthly active users, built-in auth. Postgres-based so the local SQLite schema maps cleanly.
- **Firebase Firestore** — free tier: 1GB storage, 50k reads/day, 20k writes/day. More than enough for a single user.

Either way, the pattern is: SQLite is the source of truth, sync pushes/pulls changes to cloud. Libraries like **PowerSync** or **WatermelonDB** can handle this sync layer for React Native + SQLite.

### Notifications
- **expo-notifications** — free, handles both Android and iOS
- Morning reminder at user-configured time
- Evening reminder for nightly check-in
- Configurable / dismissable

### Cost Summary

| Service | Free Tier | If Scaling |
|---------|-----------|------------|
| Expo / EAS Build | 30 builds/month | $1/build after that |
| Gemini API | 1M tokens/day | ~$0.01-0.05/month beyond free |
| SQLite | Free (on-device) | Free forever |
| Supabase (future) | 500MB, 50k MAU | $25/month (unlikely to need) |
| Voice STT | Free (on-device) | Free forever |
| **Total MVP cost** | **$0/month** | |

---

## User Experience Principles

1. **Low friction** — check-ins should feel effortless, not like a chore
2. **Non-judgmental** — the app should never make the user feel bad about a red day
3. **Empowering** — surface insights that help users feel in control
4. **Gradual** — don't overwhelm with data; reveal complexity over time
5. **Accessible** — fatigue conditions affect cognitive capacity; keep UI simple and clear

---

## MVP Scope

For a first working version, focus on:
1. Morning check-in (simple form)
2. Nightly check-in (text-based AI conversation)
3. Day history view (color-coded calendar)
4. Local data storage

Voice input and insights can be added after the core loop is solid.
