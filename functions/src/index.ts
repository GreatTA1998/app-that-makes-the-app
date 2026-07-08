/**
 * Daily analytics snapshot. Runs once per day (00:00 UTC) and also on demand.
 *
 * Reads every Firebase Auth user (source of truth for email, creationTime and
 * lastRefreshTime — no Firestore reads needed) and writes three things:
 *
 *   1. analytics/{uid}/taskCounts/{YYYY-MM-DD}
 *      Per-user daily task count. Converted users only.
 *
 *   2. analytics/{uid}
 *      One profile doc per user: uid, email, cohort, lastRefreshedAt,
 *      taskCount, taskCountChange (day-over-day delta vs yesterday's
 *      snapshot, null when there is none). Powers the per-user admin page.
 *      Converted users only.
 *
 *   3. analyticsMonthly/{YYYY-MM}   (one merged write per run)
 *      - dailyActive.{date}: DAU for each day of the month
 *      - dailyActiveByCohort.{date}.{cohort}: that day's DAU split by signup
 *        cohort (stacked DAU chart). Days written before this field existed
 *        have no breakdown and render as an "unknown" band.
 *      - activeUids.{uid}: cohort — distinct users active that month (layer cake)
 *      - conversionByCohort.{cohort}: { total, converted } — every auth user
 *        starts anonymous (created on first visit); having an email means the
 *        account was linked, i.e. the visitor converted.
 *      Docs for past months stop being written and are frozen history.
 *
 * Anonymous accounts (no email) are visitors, not users: they only count in
 * the conversion funnel denominator, never in DAU, the layer cake, or task
 * counts. If a visitor later links an email, they start being tracked from
 * the next run — their pre-conversion daily history simply doesn't exist,
 * but taskCount is a live aggregation so it's immediately accurate.
 *
 * "Active" means Auth refreshed the user's ID token during the day being
 * closed out — the SDK does this hourly whenever the app is open.
 */

import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth, UserRecord } from "firebase-admin/auth";
import { setGlobalOptions } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

initializeApp();
setGlobalOptions({ maxInstances: 10 });

// How many users to process in parallel. count() aggregations are cheap, but
// this caps simultaneous Firestore connections.
const CONCURRENCY = 25;

// The web app stores data in a named Firestore database, not (default).
// See src/lib/db/init.js.
const FIRESTORE_DATABASE_ID = "schema-compliant";

// YYYY-MM-DD in UTC, `daysAgo` days before now.
function isoDate(daysAgo = 0): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

async function listAllAuthUsers(): Promise<UserRecord[]> {
  const users: UserRecord[] = [];
  let pageToken: string | undefined;
  do {
    const page = await getAuth().listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

async function runDailySnapshot(): Promise<{
  users: number;
  totalTasks: number;
  dau: number;
  dateISO: string;
}> {
  const db = getFirestore(FIRESTORE_DATABASE_ID);
  const dateISO = isoDate(); // task counts are a point-in-time reading, taken "today"
  const activityDate = isoDate(1); // activity closes out the completed UTC day
  const month = activityDate.slice(0, 7);

  const infos = (await listAllAuthUsers()).map((u) => ({
    uid: u.uid,
    email: u.email ?? null,
    cohort: new Date(u.metadata.creationTime).toISOString().slice(0, 7),
    lastRefreshedAt: u.metadata.lastRefreshTime
      ? new Date(u.metadata.lastRefreshTime).toISOString()
      : null,
  }));
  logger.info(
    `Snapshotting ${infos.length} auth users (${infos.filter((i) => i.email).length} converted) on ${dateISO}`
  );

  const activeUids: Record<string, string> = {}; // uid -> cohort
  const conversionByCohort: Record<string, { total: number; converted: number }> = {};
  for (const { uid, email, cohort, lastRefreshedAt } of infos) {
    const tally = (conversionByCohort[cohort] ??= { total: 0, converted: 0 });
    tally.total += 1;
    if (email) tally.converted += 1;
    if (email && lastRefreshedAt && lastRefreshedAt.slice(0, 10) >= activityDate) {
      activeUids[uid] = cohort;
    }
  }

  const converted = infos.filter((info) => info.email);
  let totalTasks = 0;
  for (let i = 0; i < converted.length; i += CONCURRENCY) {
    const counts = await Promise.all(
      converted.slice(i, i + CONCURRENCY).map(async (info) => {
        const agg = await db.collection(`users/${info.uid}/tasks`).count().get();
        const count = agg.data().count;

        // Day-over-day delta ("change" in PostHog terms) vs yesterday's
        // snapshot; null when the user has no snapshot from yesterday.
        const yesterdaySnap = await db
          .doc(`analytics/${info.uid}/taskCounts/${isoDate(1)}`)
          .get();
        const yesterdayCount = yesterdaySnap.data()?.count;
        const taskCountChange =
          typeof yesterdayCount === "number" ? count - yesterdayCount : null;

        // Idempotent: re-running the job on the same day overwrites.
        await db.doc(`analytics/${info.uid}/taskCounts/${dateISO}`).set({
          uid: info.uid,
          email: info.email,
          dateISO,
          count,
          takenAt: FieldValue.serverTimestamp(),
        });

        await db.doc(`analytics/${info.uid}`).set({
          ...info,
          taskCount: count,
          taskCountChange,
          updatedAt: FieldValue.serverTimestamp(),
        });

        return count;
      })
    );
    totalTasks += counts.reduce((a, b) => a + b, 0);
  }

  const dau = Object.keys(activeUids).length;

  // Per-cohort breakdown of the day's actives — powers the stacked DAU chart.
  // Counts only (not uids) so month docs stay small as users grow.
  const dayCohortCounts: Record<string, number> = {};
  for (const cohort of Object.values(activeUids)) {
    dayCohortCounts[cohort] = (dayCohortCounts[cohort] ?? 0) + 1;
  }

  // merge:true accumulates dailyActive dates and activeUids across the month
  // instead of overwriting them.
  await db.doc(`analyticsMonthly/${month}`).set(
    {
      month,
      dailyActive: { [activityDate]: dau },
      dailyActiveByCohort: { [activityDate]: dayCohortCounts },
      activeUids,
      conversionByCohort,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  logger.info(
    `Snapshot complete: ${converted.length} converted users, ${totalTasks} tasks, ${dau} active on ${activityDate}`
  );

  return { users: converted.length, totalTasks, dau, dateISO };
}

export const dailyTaskCountSnapshot = onSchedule(
  {
    // App Engine cron syntax. Runs once a day at 00:00 in the given TZ.
    schedule: "every day 00:00",
    timeZone: "UTC",
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    await runDailySnapshot();
  }
);

// Re-copies each converted user's current Auth lastRefreshTime into their
// analytics profile doc, touching nothing else. The daily snapshot leaves
// lastRefreshedAt up to a day stale (frozen at 00:00 UTC); unlike
// runTaskCountSnapshotNow, this refreshes activity without overwriting
// today's task counts with a partial mid-day reading.
export const refreshLastActive = onCall(async () => {
  const db = getFirestore(FIRESTORE_DATABASE_ID);
  const writer = db.bulkWriter();
  let updated = 0;
  for (const u of await listAllAuthUsers()) {
    if (!u.email || !u.metadata.lastRefreshTime) continue;
    writer.set(
      db.doc(`analytics/${u.uid}`),
      {
        lastRefreshedAt: new Date(u.metadata.lastRefreshTime).toISOString(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    updated += 1;
  }
  await writer.close();
  logger.info(`Refreshed lastRefreshedAt for ${updated} users`);
  return { updated };
});

export const runTaskCountSnapshotNow = onCall(
  {
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    try {
      return await runDailySnapshot();
    } catch (err) {
      logger.error("Manual snapshot run failed", err);
      throw new HttpsError("internal", String(err));
    }
  }
);
