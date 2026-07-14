import { loadGatewayConfig } from "./provider-config.js";
import { startEcoGateway } from "./server.js";

const config = loadGatewayConfig();
const server = await startEcoGateway(config);

console.log(`eco-gateway listening on http://${config.host}:${server.port} (node http)`);
