// load environment variables from .env (if present)
import "dotenv/config";
import app from "./app";
import { initializeFirebase } from "./lib/firebase";

const start = async () => {
  try {
    initializeFirebase();
    const port = process.env.PORT ? Number(process.env.PORT) : 3000;
    await app.listen({ port, host: "0.0.0.0" });
    console.log(`Server listening on ${port}`);
  } catch (err) {
    // @ts-ignore
    console.error("Failed to start server:", err);
    process.exit(1);
  }
};

start();
