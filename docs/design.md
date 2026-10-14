# Design spec

This is the source of truth for the data model, the prompt-assembly rules and the command surface.
If you change any of these, update this file in the same commit.

## Vocabulary

| Term | Meaning |
|---|---|
| **User** | A local login. Has a username and an optional password. With a password, all of that user's data on disk is encrypted. With an empty password, it is plain JSON (for debugging). |
| **Conversation** | One chat or one campaign ("D&D at the Gilded Goat", "Pathfinder, dark and gritty"). Owns its settings, templates, setup messages, brains and ledger. The UI may call it a campaign; the code calls it a conversation. |
| **Brain** | A named AI persona inside a conversation (Game Master, Dice Master, Joke Teller, Scene Painter). Each has its own system prompt, an optional final reminder, and a kind (`text` or `image`). Exactly one is the **default brain**. |
| **Ledger** | The single shared, ordered list of messages in a conversation. Every brain sees the same ledger, from its own point of view. Editing a ledger message changes what every brain sees. |
| **Setup messages** | Ordered text blocks (World Bible, Module, ...) sent verbatim, as `role: user`, to every brain right after its system prompt. |
| **Templates** | Conversation-level framing strings (the HTML-comment wrappers) used when one brain sees a message from the player or from another brain. They are plain editable text. |
| **Steer** | A one-off, behind-the-scenes direction used when regenerating the latest brain message. It is sent once and never appears in any later prompt. |

## Hard rules

1. **No hidden text.** Every string we send to a model comes from user-editable fields: system prompts, setup messages, templates, final reminders, tool descriptions, tool-result text, ledger content and steer text. Code must never add prose, instructions or wrappers of its own.
   - Venice must always get `venice_parameters.include_venice_system_prompt: false`. Without it, Venice adds its own system prompt.
   - `prompt.preview` must return the **exact** request body that would be sent (minus the auth header). The real send path must use the same function, so preview and reality cannot drift. A test asserts this.
   - The only text outside our control is the model's own chat template (how DeepSeek serializes the tool schema). That is unavoidable and is noted in the UI's payload view.
2. **Terminal-first.** Every capability is a registered command. The web UI only calls commands. There are no UI-only endpoints.
3. **Local only.** The server binds to `127.0.0.1`. Nothing is deployed and nothing is pushed.
4. **Never put reasoning text or steer text into a prompt.** They are stored for display only.

## Storage layout (flat files, gitignored)

```
data/
  users/<username>/
    user.json                     # plaintext metadata only: username, encrypted flag, KDF params, salt, verifier. Never the password or the key.
    conversations/<convId>.json   # whole conversation document (encrypted users: binary ciphertext, see below)
    images/<imageId>.<ext>        # image bytes (encrypted users: ciphertext)
.run/                             # gitignored runtime state: server.pid, server.log, cli-session.json, mock pid
```

- Writes are atomic: write a temp file, then rename.
- The server keeps no cache it could not rebuild. Every command loads from disk and saves to disk. That way the CLI, the browser and a restarted server always agree.
- One generation at a time per conversation. A second `turn` or `regenerate` on a busy conversation returns a 409 error.

### Encryption

- Key derivation: `scrypt(password, salt)` → 32-byte key (node:crypto, N ≥ 2^15). The salt and params go in `user.json`.
- Password check: `user.json` stores a verifier, a small known plaintext encrypted with the key. If it decrypts, the password is right. Never store the password or the raw key.
- File format: magic `SSENC1` + 12-byte random IV + 16-byte GCM tag + AES-256-GCM ciphertext. Use a fresh IV on every write.
- Everything under the user's dir except `user.json` is encrypted, images included. Titles too, since they live in the conversation doc.
- The key lives only in server memory, in the session. A server restart means logging in again.
- Never log message content, prompts or image bytes to `.run/server.log`.

### Sessions

- `auth.login` derives the key, then creates a random session token mapped in memory to `{username, key}`.
- Browser: an httpOnly cookie. CLI: the token goes in `.run/cli-session.json`. Without the running server's memory, the token is useless.

## Conversation document

```ts
type Conversation = {
  id: string; title: string; createdAt: string; updatedAt: string;
  settings: {
    textModel: string;                 // default "deepseek-v4-1-flash"
    reasoningEffort: string;           // "" = model default; else one of the model's options. Default "low"
    maxTokens?: number; temperature?: number;
    imageModel: string;                // default: see AGENTS.md "Defaults"
    image: { width?: number; height?: number; aspectRatio?: string; resolution?: string;
             format: "webp" | "png" | "jpeg"; safeMode: boolean; hideWatermark: boolean; negativePrompt?: string };
  };
  templates: {
    player: string;          // default "<!-- from: the user -->\n{{content}}"
    otherBrainText: string;  // default "<!-- from: {{brain}} -->\n{{content}}"
    otherBrainImage: string; // default "<!-- from: {{brain}}. It called generate_image with this exact prompt, and that image is now on the player's screen: -->\n{{prompt}}"
    steer: string;           // default "<!-- Behind-the-scenes direction from the user. This is not part of the conversation. Write your previous response again, following this direction: -->\n{{instruction}}"
  };
  setup: Array<{ id: string; label: string; content: string }>;
  brains: Brain[];
  messages: LedgerMessage[];
};

type Brain = {
  id: string; name: string; color: string;
  kind: "text" | "image";              // cannot change once the brain has messages
  isDefault: boolean;                   // exactly one brain is the default
  systemPrompt: string;                 // empty = no system message sent
  finalReminder: { enabled: boolean; content: string };  // default enabled=false for the default brain, true for others
  tool?: {                              // image brains only. All of this text reaches the model.
    name: string;                       // default "generate_image"
    description: string;
    promptParamDescription: string;
    resultContent: string;              // content of the role:"tool" message that follows each of this brain's own past calls
  };
};

type LedgerMessage = {
  id: string;
  author: { type: "player" } | { type: "brain"; brainId: string };
  kind: "text" | "image";
  versions: MessageVersion[];           // player messages have exactly one
  activeVersion: number;                // index into versions; this is what every brain sees
  createdAt: string; updatedAt: string;
};

type MessageVersion = {
  content: string;                      // text: markdown. image: the exact image prompt.
  image?: { id: string; status: "pending" | "done" | "error"; error?: string; model: string };
  steer?: string;                       // display only, never sent
  reasoning?: string;                   // display only, never sent
  source: "generated" | "authored";     // authored = typed by the user (player message, or hand-written "words in the brain's mouth")
  edited?: boolean;
  costUsd?: number;
  createdAt: string;
};
```

Template placeholders are literal string replacements and there are only four: `{{content}}`, `{{brain}}`, `{{prompt}}`, `{{instruction}}`.

## Prompt assembly (the heart of the app)

`buildRequest(conversation, targetBrainId, { excludeFromMessageId?, steer? })` is a pure function returning the full chat-completions body. It is used by both `prompt.preview` and the real send.

For the target brain **B**:

1. If `B.systemPrompt` is not empty: `{ role: "system", content: B.systemPrompt }`.
2. For each setup message, in order: `{ role: "user", content: setup.content }`. Verbatim, no template.
3. For each ledger message `m`, in order, using `m.versions[m.activeVersion]`. On regenerate, stop before `excludeFromMessageId`:
   - **Player message:** `{ role: "user", content: render(templates.player, {content}) }`.
   - **B's own text message:** `{ role: "assistant", content }`.
   - **B's own image message:** `{ role: "assistant", content: "", tool_calls: [{ id: "call_<m.id>", type: "function", function: { name: B.tool.name, arguments: JSON.stringify({ prompt: content }) } }] }`, followed by `{ role: "tool", tool_call_id: "call_<m.id>", content: B.tool.resultContent }`.
   - **Another brain O's text message:** `{ role: "user", content: render(templates.otherBrainText, {brain: O.name, content}) }`.
   - **Another brain O's image message:** `{ role: "user", content: render(templates.otherBrainImage, {brain: O.name, prompt: content}) }`.
4. If `B.finalReminder.enabled`: `{ role: "user", content: B.finalReminder.content }`. Verbatim.
5. If steering: `{ role: "user", content: render(templates.steer, {instruction: steer}) }`. This goes last, so the whole prefix stays cache-friendly.

Request body:

```jsonc
{
  "model": settings.textModel,
  "messages": [...],
  "stream": true,
  "stream_options": { "include_usage": true },
  "venice_parameters": { "include_venice_system_prompt": false, "enable_web_search": "off" },
  "reasoning_effort": settings.reasoningEffort,   // omitted when ""
  "max_tokens": ..., "temperature": ...,          // omitted when unset
  // image brains only:
  "tools": [{ "type": "function", "function": { "name": B.tool.name, "description": B.tool.description,
              "parameters": { "type": "object", "properties": { "prompt": { "type": "string", "description": B.tool.promptParamDescription } }, "required": ["prompt"] } } }],
  "tool_choice": { "type": "function", "function": { "name": B.tool.name } }
}
```

Verified against the live Venice API (2026-10-13), using `deepseek-v4-1-flash`:
- Consecutive `role: user` messages are accepted. Do not merge them.
- Streaming deltas carry `delta.reasoning_content` (reasoning) and `delta.content` (text).
- Forced `tool_choice` works while streaming. `delta.tool_calls[0].function.arguments` arrives as JSON fragments, and `finish_reason` is `"tool_calls"`.
- History with an assistant `tool_calls` message plus a `role: tool` result is accepted.
- The final chunk has `usage` and `cost.usd`. Store `cost.usd` on the version.
- With `include_venice_system_prompt: false`, prompt_tokens matched our own text (no injected prompt).

## Turns, regeneration and edits

- **turn** `(conversation, brain = default, content?)`. If `content` is not empty, append a player message and save. Then generate a response from `brain` and append it as a new brain message. With empty content, it just asks the brain to respond (e.g. "paint the current scene").
- **regenerate** `(messageId, steer?)`. Only allowed when `messageId` is the **last** ledger message and has a brain author. Build the request for that message's brain, excluding the message itself, plus the steer. The result becomes a **new version** of the message and the active one. The steer text is stored on that version for display. It is never sent again.
- **select-version.** Switching the active version changes what every brain sees from then on.
- **edit** `(messageId, content)`. Edits the active version in place (`edited: true`). Any message can be edited, player or brain, at any depth. For an image message, saving a new prompt starts a new image generation. The old image stays on screen until the new one is ready.
- **delete** `(messageId)`. Any message. Deleting an image message deletes its image files.
- **add** `(author = player | brain, content)`. Appends an authored message without generating anything. This is how you put words in the GM's mouth for the opening scene. Authoring an image-brain message starts image generation for that prompt.
- Brains: add anytime. Edit anytime: name, system prompt, reminder, tool text. Delete only if no ledger message references the brain. Change the default anytime. Kind is locked once the brain has messages.

### Image generation

1. The image brain streams a forced `generate_image` tool call. Stream the argument fragments to the client so the prompt shows up live.
2. Parse `{prompt}` and save the message with `image.status = "pending"`.
3. `POST {VENICE_BASE_URL}/image/generate` with `{ model: settings.imageModel, prompt, ...settings.image }`, mapped to the Venice field names (`aspect_ratio`, `resolution`, `safe_mode`, `hide_watermark`, `negative_prompt`, `format`). Only send fields the chosen model supports; model constraints come from `/models?type=image`.
4. Decode `images[0]` (base64). Store it under `images/<imageId>.<ext>`, encrypted for encrypted users. Set the status to `done`, or to `error` with the message.
5. The stream stays open until the image is done, so the CLI and browser can show a loader. The server must finish and persist even if the client disconnects. `image.retry` regenerates the image for the active version from the same prompt.

## Command surface

Commands live in one registry. Each has a name, a zod args schema, an optional `stream: true`, and a handler. Two adapters expose them:

- **HTTP:** `POST /api/<command>` with a JSON body of args. Non-stream commands reply with JSON. Stream commands reply with NDJSON (`application/x-ndjson`), one event per line. Binary commands (image fetch) also answer `GET /api/<command>?...` so `<img src>` works.
- **CLI:** `./ss <command> --arg value ...`. This is a thin HTTP client over the same endpoints. `--content @file.md` reads a file and `--content -` reads stdin. `--json` prints raw JSON. Stream commands print text deltas live.

Stream event shapes (NDJSON):
`{type:"message", message}` (player message saved) · `{type:"start", brainId}` · `{type:"reasoning", delta}` · `{type:"delta", delta}` · `{type:"tool_args", delta}` · `{type:"image_pending", messageId, imageId}` · `{type:"image_done", messageId, imageId}` · `{type:"image_error", messageId, error}` · `{type:"done", message}` · `{type:"error", error}`

Initial command list (tickets add to it, and `./ss help` is the live reference):

```
help · health · venice.balance · models.list
user.create · user.list · auth.login · auth.logout · auth.whoami
conversation.create · conversation.list · conversation.get · conversation.update · conversation.delete · conversation.clone · conversation.import
setup.add · setup.update · setup.delete · setup.move
brain.add · brain.update · brain.delete · brain.set-default
turn · message.add · message.edit · message.delete · message.regenerate · message.select-version
image.get · image.retry
prompt.preview
```

## Mock Venice

`src/dev/mock-venice.ts` is a small HTTP server that speaks the Venice protocol: `/models`, `/chat/completions` (SSE streaming, including reasoning and forced tool calls), `/image/generate` (a tiny real image) and `/api_keys/rate_limits`. `npm run up:mock` starts it and points the app at it with `VENICE_BASE_URL`.

Mock replies are deterministic and echo structure (for example `MOCK reply to brain "<system prompt first 30 chars>"; saw N messages; last: "<last message first 40 chars>"`). QA can then confirm what each brain saw without spending money. Automated tests always use the mock or pure functions, never the live API.
