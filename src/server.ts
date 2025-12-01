import app from "./app";

const start = async () => {
  try {
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
