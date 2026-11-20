import relay from "../lllm/relay.js?raw";
import studio from "../lllm/studio.js?raw";
import queue from "../lllm/queue.js?raw";
import vault from "../lllm/vault.js?raw";
import privacy from "../lllm/privacy-crypto.js?raw";
import chat from "../lllm/chat-crypto.js?raw";
import css from "../lllm/studio.css?raw";
export const LLLM_ASSETS: Record<string, string> = {
  "relay.js": relay, "studio.js": studio, "queue.js": queue,
  "vault.js": vault, "privacy-crypto.js": privacy,
  "chat-crypto.js": chat, "studio.css": css,
};
