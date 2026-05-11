/**
 * Daily snapshot of per-user task counts.
 *
 * Reads every user in `users/{uid}`, runs a Firestore count() aggregation on
 * `users/{uid}/tasks`, and writes the result to
 * `analytics/{uid}/taskCounts/{YYYY-MM-DD}`. The user's email is denormalised
 * onto each record so the Analytics view doesn't need to read `users` itself.
 *
 * Exposed via two triggers backed by the same `runTaskCountSnapshot` worker:
 *   - `dailyTaskCountSnapshot` — scheduled, runs once a day at 00:00 UTC.
 *   - `runTaskCountSnapshotNow` — callable, invoked from the web app via
 *     `httpsCallable(functions, 'runTaskCountSnapshotNow')`.
 *
 * Both use the Admin SDK so they bypass Firestore security rules, which is
 * what we want for an admin-only analytics job.
 */

import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
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

function todayISO(): string {
  // YYYY-MM-DD in UTC. Change the slice/format if you want a local-day bucket.
  return new Date().toISOString().slice(0, 10);
}

async function runTaskCountSnapshot(): Promise<{
  users: number;
  totalTasks: number;
  dateISO: string;
}> {
  const db = getFirestore(FIRESTORE_DATABASE_ID);
  const dateISO = todayISO();

  const usersSnap = await db.collection("users").get();
  const userInfos = usersSnap.docs.map((d) => ({
    uid: d.id,
    email: (d.data().email as string | undefined) ?? null,
  }));
  logger.info(
    `Snapshotting task counts for ${userInfos.length} users on ${dateISO}`
  );

  let totalTasks = 0;

  for (let i = 0; i < userInfos.length; i += CONCURRENCY) {
    const batch = userInfos.slice(i, i + CONCURRENCY);
    const counts = await Promise.all(
      batch.map(async ({ uid, email }) => {
        const agg = await db
          .collection(`users/${uid}/tasks`)
          .count()
          .get();
        const count = agg.data().count;

        // Idempotent: re-running the job on the same day overwrites.
        await db.doc(`analytics/${uid}/taskCounts/${dateISO}`).set({
          uid,
          email,
          dateISO,
          count,
          takenAt: FieldValue.serverTimestamp(),
        });

        return count;
      })
    );
    totalTasks += counts.reduce((a, b) => a + b, 0);
  }

  logger.info(
    `Snapshot complete: ${userInfos.length} users, ${totalTasks} total tasks on ${dateISO}`
  );

  return { users: userInfos.length, totalTasks, dateISO };
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
    await runTaskCountSnapshot();
  }
);

export const runTaskCountSnapshotNow = onCall(
  {
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    try {
      return await runTaskCountSnapshot();
    } catch (err) {
      logger.error("Manual snapshot run failed", err);
      throw new HttpsError("internal", String(err));
    }
  }
);
