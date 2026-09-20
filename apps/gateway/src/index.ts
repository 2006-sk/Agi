import { buildGateway } from "./app.js";
import { config } from "./config.js";

const { app } = await buildGateway();

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    {
      port: config.port,
      intelligence: config.intelligenceUrl,
      voice: config.voiceUrl,
    },
    "echo gateway listening",
  );
} catch (error) {
  app.log.error(error, "gateway failed to start");
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    app.log.info({ signal }, "shutting down");
    void app.close().then(() => process.exit(0));
  });
}
