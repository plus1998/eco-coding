import { DatabaseSync } from "node:sqlite";
import { ConversationV2Store } from "../../src/main/conversation-v2-store";

const databasePath = process.argv[2];
if (!databasePath) throw new Error("Missing crash-test database path.");

const db = new DatabaseSync(databasePath);
const store = new ConversationV2Store(db);
store.initialize();
const result = store.sendMessage({
  principalId: "user",
  conversationId: "receipt-crash",
  clientCommandId: "command",
  text: "survive SIGKILL",
});

process.stdout.write(`${JSON.stringify(result)}\n`);

// Deliberately keep the connection and process alive. The parent test kills
// this worker without allowing application cleanup or DatabaseSync.close().
setInterval(() => undefined, 1_000);
