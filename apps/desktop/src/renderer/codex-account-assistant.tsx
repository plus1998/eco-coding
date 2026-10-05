import { createRoot } from "react-dom/client";
import { OpenAIAccountAssistantApp } from "./components/OpenAIAccountAssistantApp";
import "./codex-account-assistant.css";

createRoot(document.getElementById("root")!).render(<OpenAIAccountAssistantApp />);
