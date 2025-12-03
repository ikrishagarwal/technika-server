import admin from "firebase-admin";

let db: admin.firestore.Firestore;

export function initializeFirebase() {
  const serviceAccountKey = process.env.SERVICE_ACCOUNT_KEY;
  const serviceAccount = JSON.parse(serviceAccountKey || "{}");

  try {
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
