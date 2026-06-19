import { loadConfig } from "./config";
import { startEcoServer } from "./http";

const config = loadConfig();
const server = startEcoServer({ config });

console.log(`Eco server listening on http://${config.host}:${server.port}`);
