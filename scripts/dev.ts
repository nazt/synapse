// Dev orchestrator — runs the Elysia server + Vite web dev server in parallel.
// Bun-native (no concurrently dependency). Ctrl+C stops both cleanly.

const server = Bun.spawn(["bun", "run", "dev"], {
  cwd: "server",
  stdout: "inherit",
  stderr: "inherit",
});

const web = Bun.spawn(["bun", "run", "dev"], {
  cwd: "web",
  stdout: "inherit",
  stderr: "inherit",
});

const shutdown = () => {
  server.kill();
  web.kill();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("Synapse dev — server (:3001) + web (:5173). Ctrl+C to stop.");

await Promise.all([server.exited, web.exited]);
