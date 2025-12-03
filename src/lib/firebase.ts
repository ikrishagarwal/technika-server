import { readFileSync } from "node:fs";
import admin from "firebase-admin";
import path from "node:path";

let db;

export function initializeFirebase() {
  const serviceAccountPath = path.join(
    __dirname,
    "../../serviceAccountKey.json"
  );
  console.log("Loading Firebase service account from:", serviceAccountPath);

  try {
    const serviceAccount = JSON.parse(
      readFileSync(serviceAccountPath, "utf-8")
    );
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } catch (err) {
    console.error("Failed to read Firebase service account key:", err);
    process.exit(1);
  }

  db = admin.firestore();
}

export { admin, db };
