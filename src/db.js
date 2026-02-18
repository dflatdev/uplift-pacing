import * as SQLite from 'expo-sqlite';

let dbPromise;

const getDb = async () => {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('uplift.db');
  }
  return dbPromise;
};

const runAsync = async (sql, params = []) => {
  const db = await getDb();
  const statement = await db.prepareAsync(sql);
  try {
    return await statement.executeAsync(params);
  } finally {
    await statement.finalizeAsync();
  }
};

const getFirstAsync = async (sql, params = []) => {
  const db = await getDb();
  const statement = await db.prepareAsync(sql);
  try {
    const result = await statement.executeAsync(params);
    return await result.getFirstAsync();
  } finally {
    await statement.finalizeAsync();
  }
};

const getAllAsync = async (sql, params = []) => {
  const db = await getDb();
  const statement = await db.prepareAsync(sql);
  try {
    const result = await statement.executeAsync(params);
    return await result.getAllAsync();
  } finally {
    await statement.finalizeAsync();
  }
};

export const initDb = async () => {
  const db = await getDb();
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS morning_checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT UNIQUE NOT NULL,
      sleep_quality INTEGER NOT NULL,
      energy_level INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS nightly_checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT UNIQUE NOT NULL,
      is_backdated INTEGER NOT NULL DEFAULT 0,
      crash_occurred INTEGER NOT NULL DEFAULT 0,
      crash_severity TEXT,
      crash_description TEXT,
      energy_assessment TEXT,
      energy_current_state TEXT,
      energy_recovery_needed INTEGER NOT NULL DEFAULT 0,
      supportive_message TEXT,
      summary_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      checkin_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      effort_json TEXT NOT NULL,
      duration_minutes INTEGER,
      difficulty_noted INTEGER NOT NULL DEFAULT 0,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS warning_flags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      checkin_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      description TEXT,
      related_activities TEXT
    );
    CREATE TABLE IF NOT EXISTS checkin_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      user_text TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
};

export const saveMorningCheckin = async ({
  date,
  sleepQuality,
  energyLevel,
}) => {
  const timestamp = new Date().toISOString();
  await runAsync(
    `INSERT OR REPLACE INTO morning_checkins
      (date, sleep_quality, energy_level, created_at)
      VALUES (?, ?, ?, ?);`,
    [date, sleepQuality, energyLevel, timestamp]
  );
};

export const upsertNightlyCheckin = async ({
  date,
  isBackdated,
  summary,
  mergeActivities = false,
}) => {
  const timestamp = new Date().toISOString();
  const crash = summary?.crash ?? {};
  const energy = summary?.energy_balance ?? {};
  const existing = await getFirstAsync(
    'SELECT id FROM nightly_checkins WHERE date = ?;',
    [date]
  );
  if (existing?.id) {
    await runAsync(
      `UPDATE nightly_checkins
        SET is_backdated = ?, crash_occurred = ?, crash_severity = ?,
          crash_description = ?, energy_assessment = ?, energy_current_state = ?,
          energy_recovery_needed = ?, supportive_message = ?, summary_json = ?,
          created_at = ?
        WHERE id = ?;`,
      [
        isBackdated ? 1 : 0,
        crash.occurred ? 1 : 0,
        crash.severity ?? null,
        crash.description ?? null,
        energy.assessment ?? null,
        energy.current_state ?? null,
        energy.recovery_needed ? 1 : 0,
        summary?.supportive_message ?? null,
        JSON.stringify(summary ?? {}),
        timestamp,
        existing.id,
      ]
    );
  } else {
    await runAsync(
      `INSERT INTO nightly_checkins
        (date, is_backdated, crash_occurred, crash_severity, crash_description,
        energy_assessment, energy_current_state, energy_recovery_needed,
        supportive_message, summary_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        date,
        isBackdated ? 1 : 0,
        crash.occurred ? 1 : 0,
        crash.severity ?? null,
        crash.description ?? null,
        energy.assessment ?? null,
        energy.current_state ?? null,
        energy.recovery_needed ? 1 : 0,
        summary?.supportive_message ?? null,
        JSON.stringify(summary ?? {}),
        timestamp,
      ]
    );
  }

  const checkinResult = await getFirstAsync(
    'SELECT id FROM nightly_checkins WHERE date = ?;',
    [date]
  );
  if (!checkinResult?.id) {
    throw new Error('Unable to load nightly check-in after save.');
  }
  const checkinId = checkinResult.id;

  if (existing?.id) {
    await runAsync('DELETE FROM warning_flags WHERE checkin_id = ?;', [
      existing.id,
    ]);
    if (!mergeActivities) {
      await runAsync('DELETE FROM activities WHERE checkin_id = ?;', [
        existing.id,
      ]);
    }
  }

  const activities = Array.isArray(summary?.activities)
    ? summary.activities
    : [];
  for (const activity of activities) {
    const activityName = activity.name ?? 'Activity';
    if (mergeActivities) {
      const existingActivity = await getFirstAsync(
        'SELECT id FROM activities WHERE checkin_id = ? AND name = ?;',
        [checkinId, activityName]
      );
      if (existingActivity?.id) {
        await runAsync(
          `UPDATE activities
            SET effort_json = ?, duration_minutes = ?, difficulty_noted = ?, notes = ?
            WHERE id = ?;`,
          [
            JSON.stringify(activity.effort ?? []),
            activity.duration_minutes ?? null,
            activity.difficulty_noted ? 1 : 0,
            activity.notes ?? null,
            existingActivity.id,
          ]
        );
        continue;
      }
    }
    await runAsync(
      `INSERT INTO activities
        (checkin_id, name, effort_json, duration_minutes, difficulty_noted, notes)
        VALUES (?, ?, ?, ?, ?, ?);`,
      [
        checkinId,
        activityName,
        JSON.stringify(activity.effort ?? []),
        activity.duration_minutes ?? null,
        activity.difficulty_noted ? 1 : 0,
        activity.notes ?? null,
      ]
    );
  }

  const warningFlags = Array.isArray(summary?.warning_flags)
    ? summary.warning_flags
    : [];
  for (const flag of warningFlags) {
    await runAsync(
      `INSERT INTO warning_flags
        (checkin_id, type, severity, description, related_activities)
        VALUES (?, ?, ?, ?, ?);`,
      [
        checkinId,
        flag.type ?? 'cumulative_load',
        flag.severity ?? 'low',
        flag.description ?? null,
        JSON.stringify(flag.related_activities ?? []),
      ]
    );
  }
};

export const saveCheckinEntry = async ({ date, userText, summary }) => {
  const timestamp = new Date().toISOString();
  await runAsync(
    `INSERT INTO checkin_entries
      (date, user_text, summary_json, created_at)
      VALUES (?, ?, ?, ?);`,
    [date, userText, JSON.stringify(summary ?? {}), timestamp]
  );
};

export const getCheckinsByDate = async (date) =>
  getAllAsync(
    `SELECT id, user_text, created_at
      FROM checkin_entries
      WHERE date = ?
      ORDER BY created_at DESC;`,
    [date]
  );

export const getNightlySummaries = async () => {
  const result = await getAllAsync(
    `SELECT id, date, crash_occurred, crash_severity, energy_assessment
      FROM nightly_checkins ORDER BY date DESC;`
  );
  const summaries = [];
  const heavyCrashKeywords = [
    'severe',
    'heavy',
    'significant',
    'major',
    'extreme',
    'high',
  ];

  for (let i = 0; i < result.length; i += 1) {
    const row = result[i];
    const warningResult = await getAllAsync(
      'SELECT severity FROM warning_flags WHERE checkin_id = ?;',
      [row.id]
    );
    let hasHighWarning = false;
    let hasMediumWarning = false;
    for (let j = 0; j < warningResult.length; j += 1) {
      const severity = warningResult[j].severity;
      if (severity === 'high') {
        hasHighWarning = true;
      } else if (severity === 'medium') {
        hasMediumWarning = true;
      }
    }

    const crashSeverity =
      typeof row.crash_severity === 'string'
        ? row.crash_severity.toLowerCase()
        : '';
    const hasHeavyCrash =
      row.crash_occurred &&
      heavyCrashKeywords.some((keyword) => crashSeverity.includes(keyword));
    const energyAssessment =
      typeof row.energy_assessment === 'string'
        ? row.energy_assessment.toLowerCase()
        : '';
    const hasSignificantOverwork =
      energyAssessment === 'significant_deficit' || hasHighWarning;
    const hasMinorCrash = row.crash_occurred && !hasHeavyCrash;
    const hasSignificantWorry = hasMediumWarning;

    const overall =
      hasHeavyCrash || hasSignificantOverwork
        ? 'red'
        : hasMinorCrash || hasSignificantWorry
        ? 'yellow'
        : 'green';

    summaries.push({ date: row.date, overall });
  }

  return summaries;
};

export const getMorningCheckinByDate = async (date) =>
  getFirstAsync(
    'SELECT date, sleep_quality, energy_level FROM morning_checkins WHERE date = ?;',
    [date]
  );

export const getNightlyCheckinByDate = async (date) =>
  getFirstAsync(
    `SELECT id, date, crash_occurred, crash_severity, crash_description,
      energy_assessment, energy_current_state, energy_recovery_needed,
      supportive_message
      FROM nightly_checkins WHERE date = ?;`,
    [date]
  );

export const getActivitiesByDate = async (date) =>
  getAllAsync(
    `SELECT id, name, effort_json, duration_minutes, difficulty_noted, notes
      FROM activities
      WHERE checkin_id = (SELECT id FROM nightly_checkins WHERE date = ?)
      ORDER BY id;`,
    [date]
  );
