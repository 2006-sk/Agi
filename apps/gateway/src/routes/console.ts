import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";

const VOICE_PAGE = fileURLToPath(new URL("../public/voice.html", import.meta.url));

/**
 * The browser voice console.
 *
 * A fallback client for the days when Aditya's Pipecat service cannot run —
 * a missing Gradium key, no microphone binding, or a platform with no wheel for
 * one of its native dependencies. It speaks the same HTTP contract as the real
 * voice service, so the gateway, the deck and the intelligence service cannot
 * tell which one is on the other end.
 *
 * Served from the gateway rather than the Next.js app deliberately: it is an
 * operations tool that must keep working when the deck is mid-rebuild, and it
 * keeps the integration layer out of the frontend's tree entirely.
 */
export async function consoleRoutes(app: FastifyInstance): Promise<void> {
  // Read once per process; the file ships with the service.
  let cached: string | null = null;

  app.get("/voice", async (_request, reply) => {
    if (cached === null) cached = await readFile(VOICE_PAGE, "utf8");
    return reply.type("text/html; charset=utf-8").send(cached);
  });
}
