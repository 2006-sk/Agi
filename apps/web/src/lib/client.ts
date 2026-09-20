import { MockTransport } from "../mock/mockGateway.ts";
import { GatewayTransport } from "./gatewayTransport.ts";
import { gatewayBaseUrl, transportModeFromEnvironment, type Transport } from "./transport.ts";

function createTransport(): Transport {
  return transportModeFromEnvironment() === "gateway" ? new GatewayTransport(gatewayBaseUrl()) : new MockTransport();
}

/** The one backend connection the app talks to (mock stream by default). */
export const transport: Transport = createTransport();
