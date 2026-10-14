# Design spec

This is the current best design for the data model, the prompt-assembly rules and the command surface. It is a living document, not a contract. The **hard rules** below are fixed. Field names, shapes and mechanics are suggestions that explain the intent. If implementation shows a better way, change it, update this file in the same commit, and say why in your report.

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
   - **Known leak, found by T01 QA-1:** some Venice models (confirmed: `venice-uncensored-1-2`) inject a default system prompt of ~550 tokens whenever the request has **no non-empty system message**. Any non-empty system message suppresses it. `deepseek-v4-1-flash` does not do this. Required behavior: when a brain's system prompt is empty, `prompt.preview` and the UI must say so plainly ("No system message. Some Venice models then add their own default prompt."). New conversations always pre-fill a non-empty system prompt. Don't spend money probing every model; a warning is enough.
2. **Terminal-first.** Every capability is a registered command. The web UI only calls commands. There are no UI-only endpoints.
3. **Local only.** The server binds to `127.0.0.1`. Nothing is deployed and nothing is pushed.
4. **Never put reasoning text or steer text into a prompt.** They are stored for display only.

## Storage layout (flat files, gitignored)

```
data/
  users/<username>/
    user.json                     # plaintext metadata only: username, encrypted flag, KDF params + salt, wrapped data key. Never the password or a raw key.
    conversations/<convId>.json   # whole conversation document (encrypted users: binary ciphertext, see below)
    images/<imageId>.<ext>        # image bytes (encrypted users: ciphertext)
.run/                             # gitignored runtime state: server.pid, server.log, cli-session.json, mock pid
```

- Writes are atomic: write a temp file, then rename.
- The server keeps no cache it could not rebuild. Every command loads from disk and saves to disk. That way the CLI, the browser and a restarted server always agree.
- One generation at a time per conversation. A second `turn` or `regenerate` on a busy conversation returns a 409 error.

### Encryption

- Key derivation: `scrypt(password, salt)` → 32-byte key-encryption key (node:crypto, N = 2^17, r = 8, p = 1, about 200 ms). The salt and params go in `user.json`.
- **Envelope (implemented in T01, replacing the planned verifier):** each encrypted user has a random 32-byte *data key* that encrypts their files. `user.json` stores only `wrappedKey`, the data key encrypted with the scrypt key in the file format below. A wrong password fails the GCM check on `wrappedKey`, so no separate verifier is needed, and a future password change only rewraps one small blob instead of re-encrypting every file. Never store the password or a raw key.
- File format: magic `SSENC1` + 12-byte random IV + 16-byte GCM tag + AES-256-GCM ciphertext, with the magic as GCM additional data. Use a fresh IV on every write.
- All user-file access goes through `src/storage/vault.ts` (`readJson` / `writeJson` / `readBytes` / `writeBytes` / `removeFile` / `listFiles` on a `Vault = {dir, key}`), which encrypts when the session has a key. It refuses plaintext files in an encrypted user's folder (and vice versa), refuses paths that escape the user's folder, and never touches `user.json`. Temp files from atomic writes are already ciphertext.
  - Vault files always live in a subfolder (`conversations/`, `images/`), and any `.` or `..` path segment is refused outright. So no spelling reaches `user.json`: macOS volumes are case-insensitive, so a name check alone would let `USER.json` or `conversations/../user.json` through (T01 QA-3).
  - A vault can be **closed** (`closeVault`): the key buffer is zeroed and every later read or write throws `session_ended`. As a last-ditch guard, `encrypt()` refuses an all-zero key.
- Everything under the user's dir except `user.json` is encrypted, images included. Titles too, since they live in the conversation doc.
- The key lives only in server memory, in the session. A server restart means logging in again.
- Never log message content, prompts or image bytes to `.run/server.log`. The server logs only method, path, status and timing, plus error codes.
- Every `/api` response carries `Cache-Control: no-store`, so the browser never writes decrypted conversations or images to its disk cache.

### Sessions

- `auth.login` derives the key, then creates a random session token mapped in memory to `{username, key}`.
- The token only ever travels in the `ss_session` cookie (`HttpOnly; SameSite=Strict; Path=/`), never in a response body. The browser keeps it as a cookie. The CLI reads the same `Set-Cookie` header and saves the token in `.run/cli-session.json` (mode 0600), then sends it back as a cookie, so both clients take the identical path. Without the running server's memory, the token is useless.
- When a request carries a token the server doesn't know (it restarted, or the user logged out elsewhere), the response has `x-ss-session: invalid`. The CLI then deletes its saved token and says why.
- Logging in again replaces the caller's previous session. Logging out wipes the key from memory.
- **Running work keeps its own key (T01 QA-2).** The session holds the master vault. The HTTP adapter gives each request its own copy (`forkVault`) and closes that copy when the request's work is done, after a stream has fully drained. So logout, or logging in again, kills the token and wipes the session's key at once, while a `turn` or image generation that is already running finishes and saves under the real key. It can never write under a wiped key. Work that outlives its request (a detached job) must `forkVault` its own copy and close it when done; a request's vault is closed once the handler returns.

## Conversation document

```ts
type Conversation = {
  id: string; title: string; createdAt: string; updatedAt: string;
  settings: {
    textModel: string;                 // default "deepseek-v4-1-flash"
    maxTokens?: number; temperature?: number;
    imageModel: string;                // default "z-image-turbo"
    image: { width?: number; height?: number; aspectRatio?: string; resolution?: string;
             format: "webp" | "png" | "jpeg"; hideWatermark: boolean; negativePrompt?: string };
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
  reasoning: { enabled: boolean; effort: string };  // default { enabled: true, effort: "low" }. Disabled → reasoning_effort "none".
  safeMode?: boolean;                   // image brains only, default true → Venice safe_mode
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
  "reasoning_effort": "none" | B.reasoning.effort,  // from the brain's toggle; omitted if the model has no reasoning
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
- **The chunk that carries `finish_reason` can also carry content** (seen live with `finish_reason: "length"`, T01 QA-7). The parser must read `delta.content` on every chunk, including the finishing one. The mock reproduces this whenever `max_tokens` cuts a reply.
- With `include_venice_system_prompt: false`, prompt_tokens matched our own text (no injected prompt).

## Turns, regeneration and edits

- **turn** `(conversation, brain = default, content?)`. If `content` is not empty, append a player message and save. Then generate a response from `brain` and append it as a new brain message. With empty content, it just asks the brain to respond. Example: a Character Portraitist whose system prompt says "unless the player asks for someone specific, paint the most recently introduced character". With empty content it does exactly that; with "(paint the barkeep, give him a leather apron)" it follows the note. No special code is needed. The player message is simply framed like any other, and the brain's prompt decides.
- **regenerate** `(messageId, steer?)`. Only allowed when `messageId` is the **last** ledger message and has a brain author. Build the request for that message's brain, excluding the message itself, plus the steer. The result becomes a **new version** of the message and the active one. The steer text is stored on that version for display. It is never sent again.
- **select-version.** Go back to version 2 of 10, decide it's the good one, and keep playing from it. Switching the active version changes what every brain sees from then on.
- **edit** `(messageId, content)`. Edits the active version in place (`edited: true`). Any message can be edited, player or brain, at any depth. For an image message, saving a new prompt starts a new image generation. The old image stays on screen until the new one is ready.
- **delete** `(messageId)`. Any message. Deleting an image message deletes its image files.
- **add** `(author = player | brain, content)`. Appends an authored message without generating anything. This is how you put words in the GM's mouth for the opening scene. Authoring an image-brain message starts image generation for that prompt.
- Brains: add anytime. Edit anytime: name, system prompt, reminder, tool text. Delete only if no ledger message references the brain. Change the default anytime. Kind is locked once the brain has messages.

### Image generation

1. The image brain streams a forced `generate_image` tool call. Stream the argument fragments to the client so the prompt shows up live.
2. Parse `{prompt}` and save the message with `image.status = "pending"`.
3. `POST {VENICE_BASE_URL}/image/generate` with `{ model: settings.imageModel, prompt, safe_mode: B.safeMode, ...settings.image }`, mapped to the Venice field names (`aspect_ratio`, `resolution`, `safe_mode`, `hide_watermark`, `negative_prompt`, `format`). Only send fields the chosen model supports; model constraints come from `/models?type=image`. For example, z-image-turbo takes width and height; Nano Banana takes resolution and aspect_ratio.
4. Decode `images[0]` (base64). Store it under `images/<imageId>.<ext>`, encrypted for encrypted users. Set the status to `done`, or to `error` with the message.
5. The stream stays open until the image is done, so the CLI and browser can show a loader. The server must finish and persist even if the client disconnects. `image.retry` regenerates the image for the active version from the same prompt.

## Command surface

Commands live in one registry. Each has a name, a zod args schema, an optional `stream: true`, and a handler. Two adapters expose them:

- **HTTP:** `POST /api/<command>` with a JSON body of args. Non-stream commands reply with JSON. Stream commands reply with NDJSON (`application/x-ndjson`), one event per line. Binary commands (image fetch) also answer `GET /api/<command>?...` so `<img src>` works.
- **CLI:** `./ss <command> --arg value ...`. This is a thin HTTP client over the same endpoints. `--content @file.md` reads a file and `--content -` reads stdin. `--json` prints raw JSON. Stream commands print text deltas live.

Stream event shapes (NDJSON):
`{type:"message", message}` (player message saved) · `{type:"start", brainId, brainName?}` · `{type:"reasoning", delta}` · `{type:"delta", delta}` · `{type:"tool_args", delta}` · `{type:"image_pending", messageId, imageId}` · `{type:"image_done", messageId, imageId}` · `{type:"image_error", messageId, error}` · `{type:"done", message}` · `{type:"error", error: {code, message}}`

Every stream ends with exactly one `done` or `error` event; the CLI treats anything else as a broken stream. The CLI prints `delta` and `tool_args` to stdout as they arrive and `reasoning` and status lines to stderr, so `./ss turn ... > reply.md` captures only the reply.

### HTTP contract (implemented in T01, `src/server/app.ts`)

- `POST /api/<name>` with a JSON object body (an empty body means `{}`) and `Content-Type: application/json`, which is required even when the body is empty; anything else gets a 415 `unsupported_media_type`. With curl, add `-H 'content-type: application/json'`. Args are validated with the command's zod schema in strict mode, so unknown keys are a 400.
- Success: the JSON result, status 200. Failure: `{"error": {"code", "message", "details?"}}` with a real status: 400 `bad_args`/`bad_json`, 401 `unauthenticated`/`wrong_password`, 404 `not_found`/`unknown_command`, 405, 409 `conflict`, 502 `venice_error`, 500 `internal` (whose details go only to the log).
- Stream commands: the adapter pulls the first event *before* sending headers, so a failure up front (unknown id, 409 busy) is a normal HTTP error rather than a 200 stream with an error inside. After that, it keeps draining the generator even if the client disconnects, so work finishes and persists. Handlers that should stop on disconnect can watch `ctx.signal`.
- `GET /api/<name>?k=v` works only for binary commands (so `<img src>` works) and `health`. State-changing commands can't be triggered by a link. Query values arrive as strings.
- Local-only guard: requests whose `Host` isn't `localhost`, `127.0.0.1` or `[::1]` are refused (DNS rebinding), and so is any request with a non-loopback `Origin` (CSRF). The Vite dev server on another localhost port is still allowed. Pages on *other* localhost ports are stopped by the JSON requirement instead: without a CORS preflight a page can only send `text/plain` or form bodies, and the server never approves a preflight (it sends no CORS headers), so a blind cookie-carrying POST from, say, `localhost:3000` gets a 415 (T01 QA-4).
- `x-ss-cli: 1` asks for `{result, text}`, where `text` is the command's own `format()` rendering. The CLI uses it; the browser doesn't need it.
- Everything else under `GET /` serves `web/dist` with an SPA fallback to `index.html`, or a placeholder page when there's no build.

### Writing a command

`command({...})`, `streamCommand({...})` or `binaryCommand({...})` from `src/registry.ts`, registered in `src/commands/index.ts`. Each one has a `name`, a `description` (the first line is the summary in `./ss help`), a zod `args` object, `auth` (default `true`, meaning login required) and optional `examples`. JSON commands can add `format(result)` for CLI text. Mark a password-like arg with `.meta({ secret: true, prompt: "Password for {username}: " })` and the CLI prompts for it with hidden input when it's omitted (`confirm: true` asks twice). With no terminal, it reads the first line of stdin, and empty stdin is a usage error rather than an empty password. A secret flag value is literal, except that `-` reads stdin: no `@file` expansion. `ctx.requireSession().vault` is this request's own key copy, valid until the handler (or the stream) finishes. Don't name args `json`, `help` or `out`, since those are CLI global flags. The catalog the CLI parses flags from is `help`, which returns each command's JSON Schema.

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

`src/dev/mock-venice.ts` is a small HTTP server that speaks the Venice protocol: `/models`, `/chat/completions` (SSE streaming, including reasoning and forced tool calls), `/image/generate` (a tiny real image) and `/api_keys/rate_limits`. `npm run up:mock` starts it on port 4748 and points the app at it with `VENICE_BASE_URL`. In mock mode the server never loads `.env`, so the real key can't reach the mock. Tests start it in-process with `startMockVenice({ port: 0, delayMs: 0 })`.

Mock replies are deterministic and echo structure: `MOCK reply to brain "<system prompt, first 30 chars>"; saw N messages; last: "<last message, first 60 chars>"`. QA can then confirm what each brain saw without spending money. Automated tests always use the mock or pure functions, never the live API.

Implemented in T01:
- The model list is a handful of entries copied verbatim from the live `/models` response (`src/dev/mock-models.ts`): `deepseek-v4-1-flash` (reasoning effort), `venice-uncensored-1-2` (no reasoning), `gemini-3-6-flash` (anonymized) and three image models covering the three image-pricing shapes.
- Chat streams match the live wire format captured on 2026-10-13: a role chunk, `reasoning_content` deltas (when the model reasons and `reasoning_effort` isn't `"none"`), `content` deltas or `tool_calls` argument fragments, a `finish_reason` chunk, then, with `stream_options.include_usage`, a final chunk with `choices: []`, `usage` and `cost: {usd, diem}`, then `data: [DONE]`. `stream: false` returns a plain `chat.completion`. For models without reasoning, the role chunk is `{role: "assistant", content: ""}`, as it is live.
- `max_tokens` is honored, counted in content words: the reply is cut, `finish_reason` is `"length"`, and the last content delta rides in the finish chunk, as it does live.
- It **rejects** chat requests without `venice_parameters.include_venice_system_prompt: false`, so a regression on that hard rule fails tests.
- Images are always PNG, whatever `format` asks for, with the size taken from `width`/`height` (capped at 256 px). T05 should sniff the content type from the magic bytes rather than trust the requested format. `return_binary: true` returns raw bytes. Image responses carry `x-venice-is-blurred: false` and `x-venice-is-content-violation: false`, like live; the mock never blurs.
- A mock balance starts at $10 and goes down by each call's computed cost.
- `GET /_mock/requests` returns the last 20 request bodies, newest first. Compare it with `prompt.preview` to prove the real send matches the preview.
- Triggers in the last message (chat) or the prompt (image): `MOCK_ERROR` returns an HTTP error, `MOCK_SLOW` makes it slow (useful for 409 and stop tests), and `MOCK_MIDSTREAM_ERROR` drops the connection halfway through.
