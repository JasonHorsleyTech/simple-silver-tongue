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
   - **Never send a request without a user-written system message (Jason, 2026-10-14).** Some Venice models (confirmed: `venice-uncensored-1-2`, found by T01 QA-1) insert their own built-in prompt of ~550 tokens ("you are uncensored…") whenever a request has no non-empty system message, even with `include_venice_system_prompt: false`. Any non-empty system message suppresses it. So a brain's system prompt must be non-empty: brain create and update reject an empty one, and the send path refuses, with a clear error, to send a body whose first message isn't a non-empty `role: system`. `prompt.preview` shows the same error. Jason's words: "The system prompt should be whatever we put in, and nothing else." 
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
  - `readJson` replaces `JSON.parse`'s error with a plain "not valid JSON": V8's message quotes the text it failed on, and internal errors are logged, so a corrupt file would otherwise put decrypted content in `.run/server.log` (T02).
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

Implemented in T02 as `src/conversations/types.ts` (the types), `defaults.ts` (new conversations and brains) and `store.ts` (files, write queue, generation lock). The shape below is what is on disk.

```ts
type Conversation = {
  schemaVersion: 1;                    // bump it and upgrade on load if a later ticket changes the shape
  id: string; title: string; createdAt: string; updatedAt: string;
  settings: {
    textModel: string;                 // default "deepseek-v4-1-flash"; must be in Venice's /models list
    maxTokens?: number; temperature?: number;   // omitted = not sent
    imageModel: string;                // default "z-image-turbo"
    image: { width?: number; height?: number; aspectRatio?: string; resolution?: string;
             format: "webp" | "png" | "jpeg"; hideWatermark: boolean; negativePrompt?: string };
             // T02 default { format: "webp", hideWatermark: false }; T05 owns the semantics
  };
  templates: {
    player: string;          // default "<!-- from: the user -->\n{{content}}"
    otherBrainText: string;  // default "<!-- from: {{brain}} -->\n{{content}}"
    otherBrainImage: string; // default "<!-- from: {{brain}}. It called generate_image with this exact prompt, and that image is now on the player's screen: -->\n{{prompt}}"
    steer: string;           // default "<!-- Behind-the-scenes direction from the user. This is not part of the conversation. Write your previous response again, following this direction: -->\n{{instruction}}"
  };
  setup: Array<{ id: string; label: string; content: string }>;
  brains: Brain[];
  defaultBrainId: string;              // T02: replaces Brain.isDefault, so "exactly one default" holds by construction
  messages: LedgerMessage[];
  spentUsd?: number;                   // T03 triage: what the conversation has cost, and it only grows (see "Cost" below).
                                       // Absent in older files: totalCost() then sums the versions.
};

type Brain = {
  id: string; name: string; color: string;   // name is unique (case-insensitive) and never looks like an id (b_...)
  kind: "text" | "image";              // cannot change once the brain has messages
  reasoning: { enabled: boolean; effort: string };  // default { enabled: false, effort: "low" } (T02 QA-1, see below). See "Request body" for how it maps.
  safeMode?: boolean;                   // image brains only, default true → Venice safe_mode
  systemPrompt: string;                 // must be non-empty (see hard rule 1)
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
  steeredFrom?: number;                 // T03: with a steer, the index of the version it revised (the one active then). Display only
  reasoning?: string;                   // display only, never sent
  source: "generated" | "authored";     // authored = typed by the user (player message, or hand-written "words in the brain's mouth")
  edited?: boolean;
  model?: string;                       // generated: the text model that wrote it (the conversation's model can change later)
  finishReason?: string;                // generated: Venice's finish_reason. "length" = cut off by max_tokens (the UI can say so)
  stopped?: true;                       // T03: cut short by generation.stop; content is what had arrived. usage and costUsd come
                                        // a little later, from the drain, and are the whole reply's (what Venice billed)
  usage?: { promptTokens: number; completionTokens: number; reasoningTokens?: number; cachedTokens?: number };
  costUsd?: number;                     // from the final chunk's cost.usd. The conversation's total is spentUsd, not a sum of these
  createdAt: string;
};
```

Template placeholders are literal string replacements and there are only four: `{{content}}`, `{{brain}}`, `{{prompt}}`, `{{instruction}}`. Rendering is a **single pass** with a function replacer, so a message that itself contains `{{brain}}` or `$&` is never expanded again. A placeholder a template has no value for (say `{{prompt}}` in the player template) is left as typed, where the preview shows it.

**Each template must keep the placeholder its text goes into (T03 QA-3):** `player` and `otherBrainText` need `{{content}}`, `otherBrainImage` needs `{{prompt}}`, and `steer` needs `{{instruction}}` (`{{brain}}` is optional). Without it, the text would silently go missing: a blank steer template dropped the steer and left an empty message after the brain's own reply. `conversation.update` refuses such a template, and `buildRequest` refuses to use one (`bad_template`, 400, nothing sent) for files written before the check. The wording is in `templateProblem` (`prompt.ts`). A bare `{{content}}` (no framing at all) is fine.

**Cost (T03 QA-2).** `spentUsd` is what the conversation has cost, and it is what the CLI and the browser show. Each save adds the reply's `cost.usd` (`addSpend`, called before the version goes in, so an older file's total is first pinned from its versions), and the drain adds a stopped reply's cost when Venice reports it (see **stop**). The total never goes down: deleting a message removes it from every prompt, not from the bill. The one cost that can't be counted is a stream that breaks mid-reply: it reports no usage, though Venice probably bills what it wrote. A conversation made by `conversation.clone` or `.import` (T07) starts at `spentUsd: 0`: it hasn't cost anything yet.

**Storage mechanics (T02).** Every change is a read-modify-write of the whole file through `mutateConversation(vault, id, fn)`, which runs one job at a time per conversation. So a rename while a reply streams is not lost when the reply is saved: the reply's save re-reads the file and appends. The generation lock (`beginGeneration`, the 409) is separate from that queue. It carries a stop signal, which `generation.stop` aborts (`stopGeneration`, T03), and the abort for the Venice request, which `release()` fires unless a stop has handed the request to the drain (`keepUpstream`). **While a generation runs, ledger edits are refused too** (`assertLedgerIdle`, T03): `message.edit`, `.delete` and `.select-version` get a 409, because the reply in flight answers the messages as they were sent, and a regenerate's save expects its message to still be there. Stop it, then edit. Title, settings, templates and brains can still change mid-reply. `conversation.delete` is refused while a generation runs.
- **The lock and the read must agree (T03 QA-1).** A "not while generating" check runs *inside* the conversation's queue (in `mutateConversation`'s `fn`), and a generation reads the conversation *through* that queue, after taking the lock: `gen.load()`, never a bare `loadConversation`. So an edit whose check passed a moment before the lock has finished writing by the time the generation reads, and every later edit sees the lock and gets its 409. With a bare read, QA saw a delete land after a regenerate had read the old ledger (the whole reply was generated, billed and then thrown away), and turns that answered pre-edit text. T04's "brain delete, not while a generation for it runs" and T05's generating commands follow the same pattern. The lock also keeps, in server memory only, the events the generation has streamed so far (consecutive deltas merged), so `generation.follow` can re-attach to it (T02 frontend). A generating command passes its events through `gen.relay(...)`, which records them and hands followers the same `done` or error the caller gets.

## Prompt assembly (the heart of the app)

`buildRequest(conversation, targetBrainId, { model, excludeFromMessageId?, steer? })` in `src/conversations/prompt.ts` is a pure function returning the full chat-completions body. `model` is what `/models` says the conversation's text model can do (reasoning support and effort levels); the command layer looks it up from the cached list and refuses a model Venice doesn't list (`unknown_model`). A blank `steer` is refused (a caller bug, not "no steer"; T02 QA-5): a plain re-roll passes no steer at all. T02 implements every branch below, image brains and steering included, with unit tests (`test/prompt.test.ts`), so T03-T05 only wire commands to it.

**One code path for preview and send.** `planTurn(conv, {brain, content}, model)` (`src/conversations/turn.ts`) builds the would-be player message and the body. `prompt.preview` returns `plan.body`; `turn` sends `plan.body` and saves `plan.player`. A test compares the preview with what the mock received, for the same `--content`. `planRegenerate(conv, {message?, steer?}, model)` (T03) sits beside it: `message.regenerate` sends its body and `prompt.preview --regenerate [--message] [--steer]` returns it, and `test/regenerate.test.ts` compares the two for every steer in the green/blue/green scenario. It also does the checks (last message, brain author) and trims the steer (blank = plain re-roll), so the preview and the send can't disagree about any of it.

For the target brain **B**:

1. `{ role: "system", content: B.systemPrompt }`. Always present and never empty; refuse to build otherwise.
2. For each setup message, in order: `{ role: "user", content: setup.content }`. Verbatim, no template. Blank ones (whitespace only) are skipped rather than sent empty.
3. For each ledger message `m`, in order, using `m.versions[m.activeVersion]`. On regenerate, stop before `excludeFromMessageId`:
   - **Player message:** `{ role: "user", content: render(templates.player, {content}) }`.
   - **B's own text message:** `{ role: "assistant", content }`.
   - **B's own image message:** `{ role: "assistant", content: "", tool_calls: [{ id: "call_<m.id>", type: "function", function: { name: B.tool.name, arguments: JSON.stringify({ prompt: content }) } }] }`, followed by `{ role: "tool", tool_call_id: "call_<m.id>", content: B.tool.resultContent }`.
   - **Another brain O's text message:** `{ role: "user", content: render(templates.otherBrainText, {brain: O.name, content}) }`.
   - **Another brain O's image message:** `{ role: "user", content: render(templates.otherBrainImage, {brain: O.name, prompt: content}) }`.
4. If `B.finalReminder.enabled` and its content isn't blank: `{ role: "user", content: B.finalReminder.content }`. Verbatim.
5. If steering: `{ role: "user", content: render(templates.steer, {instruction: steer}) }`. This goes last, so the whole prefix stays cache-friendly.

Request body:

```jsonc
{
  "model": settings.textModel,
  "messages": [...],
  "stream": true,
  "stream_options": { "include_usage": true },
  // Everything on Venice's side that would add text we didn't write is off, explicitly:
  "venice_parameters": { "include_venice_system_prompt": false, "enable_web_search": "off", "enable_web_scraping": false },
  "reasoning_effort": ...,                        // see below
  "max_tokens": ..., "temperature": ...,          // omitted when unset
  // image brains only:
  "tools": [{ "type": "function", "function": { "name": B.tool.name, "description": B.tool.description,
              "parameters": { "type": "object", "properties": { "prompt": { "type": "string", "description": B.tool.promptParamDescription } }, "required": ["prompt"] } } }],
  "tool_choice": { "type": "function", "function": { "name": B.tool.name } }
}
```

Reasoning, from the brain's toggle and the model's capabilities (T02):

| Model | Brain reasoning on | Brain reasoning off |
|---|---|---|
| No reasoning | nothing sent | nothing sent |
| Effort levels including `none` (deepseek-v4-1-flash) | `reasoning_effort: B.reasoning.effort` | `reasoning_effort: "none"` |
| Effort levels without `none` | `reasoning_effort: B.reasoning.effort` | `venice_parameters.disable_thinking: true` |
| Reasoning, no effort levels | nothing sent | `venice_parameters.disable_thinking: true` |

**The send path re-checks the hard rule.** `openChatStream` (`src/venice/chat.ts`) calls `assertSendable(body)` before anything leaves the server, whoever built the body: the first message must be a non-empty `role: system` and `include_venice_system_prompt` must be `false`. The mock refuses both too. It also calls `assertAnswerable(body)`: the last message must be `user` or `tool` (see `nothing_to_answer` below).

**Every plan is reviewed the same way (T02 triage).** `reviewBody(brain, body, model)` in `turn.ts` gives a plan its `refusal` (from `nothingToAnswer`) and its `notes`, the plain-language lines the payload view shows next to the body (today: the reasoning note, whenever the request really turns reasoning on, i.e. the brain's toggle is on and the model reasons). `planTurn` and `planRegenerate` both use it. `prompt.preview` returns `{conversationId, brainId, brainName, body, notes, refusal?, regenerate?: {messageId, newVersion, steer?, steeredFrom?}}`.

Verified against the live Venice API (2026-10-13), using `deepseek-v4-1-flash`:
- Consecutive `role: user` messages are accepted. Do not merge them.
- Streaming deltas carry `delta.reasoning_content` (reasoning) and `delta.content` (text).
- Forced `tool_choice` works while streaming. `delta.tool_calls[0].function.arguments` arrives as JSON fragments, and `finish_reason` is `"tool_calls"`.
- History with an assistant `tool_calls` message plus a `role: tool` result is accepted.
- The final chunk has `usage` and `cost.usd`. Store `cost.usd` on the version.
- **The chunk that carries `finish_reason` can also carry content** (seen live with `finish_reason: "length"`, T01 QA-7). The parser must read `delta.content` on every chunk, including the finishing one. The mock reproduces this whenever `max_tokens` cuts a reply.
- With `include_venice_system_prompt: false` **and reasoning off**, prompt_tokens matched our own text (no injected prompt).
- **Reasoning on adds provider-side text (T02 QA-1).** With reasoning on, `deepseek-v4-1-flash` gets ~25 prompt tokens we never send (17 → 42 for the same body), and its reasoning twice quoted a system line we never wrote ("You are an AI assistant accessed via an API."). It comes from Venice or the model template, and we can't remove it. **Decision (orchestrator, applying Jason's "nothing else" rule): reasoning defaults to OFF on every brain.** Turning it on is an explicit per-brain opt-in, and the brain editor and the payload view must say plainly: "Reasoning on: the provider adds a small hidden instruction we can't see or edit." (Implemented in T02 triage: `newBrain` defaults off; the sentence is `REASONING_NOTE` in `prompt.ts`, carried in `prompt.preview`'s `notes` and printed by `brain.update` when reasoning is on. Existing files keep whatever they have.)

Verified live in T02 (2026-10-14), `deepseek-v4-1-flash`:
- The full T02 body above, `enable_web_scraping: false` included, is accepted. A 3-turn chat had `prompt_tokens` of 52, 68 and 86 for roughly 25, 40 and 55 tokens of our own text plus the chat template. Venice's own prompt would add about 550.
- `reasoning_effort: "none"` really turns reasoning off: no `reasoning_content`, and 3 completion tokens for "Yellow.".
- **A request that ends with the target brain's own `assistant` message goes wrong.** The model treats it as a prefix to continue: it repeated its last reply and put its reasoning, with a literal `</think>`, into `content`. So `turn` refuses that case (`nothing_to_answer`); `prompt.preview` still shows the body, with a note. A brain whose final reminder is on never hits it, because the reminder is a `user` message. T04 should keep the check as it is: it looks at the built body, not at who spoke last.
- **A request that is only the system prompt goes wrong too (T02 QA-3).** Live, the model continued the system prompt as text, with a leading space, and ended in garbage. So the rule is: **the body must end with a `user` or `tool` message** (`nothingToAnswer`). An image brain whose own image is last ends with `role: tool`, which is answerable (it paints again).
- **The steer needs the reply it is revising (T03).** Live probe on a chat whose replies were Blue, Red, Green, Green, Yellow, regenerating "Yellow." with the steer "Translate it into French.": with the message excluded as originally specified, the model translated its *earlier* reply ("Vert.", from "Green."). With the active version left in, it answered "Jaune.". The default template says "Write your previous response again", so the rule below now keeps the active version in the request when there is a steer.

Verified live in T03 (2026-10-14), `deepseek-v4-1-flash`, reasoning off:
- **Chained steers work with only the current steer in the request.** "What color is a fresh lime?" → "Green"; steer "Say it's blue." → "Blue"; steer "No, say it's green." (the request held "Blue" and this steer only) → "Green"; steer "Make it iambic pentameter." → "A fresh lime's color is a shade of green." The next turn's `prompt_tokens` (45, after selecting "Blue") matched our own four messages; the steered requests were 66-69.
- **Aborting a stream doesn't stop the billing.** Venice keeps generating after we disconnect and bills **the whole reply it would have written** (up to `max_tokens`), not what had arrived. T03 QA measured it with "count to 300 in words": run once to completion (40 in / 1215 out, $0.00147), then the identical request cut after 1.5 s, when ~302 tokens had arrived. The balance dropped by the same $0.00147, and was unchanged 20, 40 and 60 s later. So a stop saves waiting, not money. Since T03 triage a stop doesn't cancel the request at all: the server drains the rest and records its real cost (see **stop**).

## Turns, regeneration and edits

- **turn** `(conversation, brain = default, content?)`. If `content` is not empty, append a player message and save. Then generate a response from `brain` and append it as a new brain message. With empty content, it just asks the brain to respond. Example: a Character Portraitist whose system prompt says "unless the player asks for someone specific, paint the most recently introduced character". With empty content it does exactly that; with "(paint the barkeep, give him a leather apron)" it follows the note. No special code is needed. The player message is simply framed like any other, and the brain's prompt decides. Refused when the body wouldn't end with a `user` or `tool` message: the brain's own reply last, or only its system prompt (see above).
  - **Order and failure (T02).** Lock (409) → load → plan (empty system prompt or unknown model: 400, nothing saved) → open the Venice stream and wait for its headers (an up-front refusal: 502, nothing saved) → save the player message, emit `message` → `start` → deltas → save the brain message → `done`. If the stream breaks after that, the player message stays, no partial reply is saved, and the stream ends with `error`, whose message says so and that `turn` with no content retries. (A stop is different: what had arrived is kept; see **stop** below.) A client disconnect doesn't stop anything, even one before the first event: the reply finishes and is saved (T02 QA-2). An empty reply (live, `max_tokens` counts reasoning, so a small budget can end inside the reasoning) is saved as it came, and the `done` note says "no reply text" (T02 QA-6); the UI should show an empty bubble as such, and T03's regenerate and delete can replace it.
- **regenerate** `(messageId = the last message, steer?)`. Only allowed when `messageId` is the **last** ledger message and has a brain author (`not_last_message`, `not_a_brain_message`); the message's own brain writes it. The result becomes a **new version** of the message, appended after the others, and the active one. The steer text is stored on that version for display, with `steeredFrom` (the version it revised). It is never sent again. A steer is trimmed; a blank one means a plain re-roll. Image brains: T05.
  - **Order and failure (T03, like turn).** Lock (409) → load → plan (refusals: 400, nothing sent) → open the Venice stream → `start` (with `regenerate: true` and the `steer`, so a UI or follower renders it in the message's slot) → deltas → save the new version → `done` with the whole updated message. If the stream breaks, no version is saved and the error says the message keeps its current version.
  - **Without a steer** it is a fresh re-roll: build the request for that message's brain with `excludeFromMessageId: messageId`. If that body then ends with the same brain's own earlier `assistant` message (two of its messages in a row), it is refused with `nothing_to_answer`: `reviewBody` reports it for the preview, and the send path refuses it anyway.
  - **With a steer** (changed in T02, see the live probe above): keep the message in, so its active version is the brain's own last `assistant` message (or tool call), followed by the reminder if any, then the rendered steer. The model needs to see what "your previous response" is. Only this one request carries the old version and the steer; later prompts see only whichever version is active.
- **select-version.** Go back to version 2 of 10, decide it's the good one, and keep playing from it. Switching the active version changes what every brain sees from then on. Any message, at any depth. Commands number versions from 1, as the CLI shows them (`--version 2` is `activeVersion: 1`); a steer on the re-selected version revises it, and the result is added as the newest version.
- **edit** `(messageId, content)`. Edits the active version in place (`edited: true`; no change, no flag). Any message can be edited, player or brain, at any depth. Blank text is refused (delete the message instead). For an image message, saving a new prompt starts a new image generation. The old image stays on screen until the new one is ready. (T03 refuses image messages until T05 does that.)
- **delete** `(messageId)`. Any message, with all its versions. Deleting an image message deletes its image files (T03 refuses messages with images until T05 does that).
- **stop** `(conversation)` (T03, `generation.stop`). Aborts the running turn or regenerate and returns once it has settled. **What had arrived is kept**, marked `stopped: true`: a turn's partial reply is saved as the brain's message, a regenerate's as a new active version, so it can be edited, regenerated (with a steer, too) or deleted like any reply. Jason sees the text as it streams, so it is his to keep; throwing it away would also leave a turn's player message unanswered, with no reply to regenerate. If no reply text had arrived (still connecting, or only reasoning), nothing is saved and the stream ends with error `stopped` (status 499), whose message says what was kept: a turn keeps only the player message; a regenerate keeps the current version.
  - **A stop doesn't cancel the Venice request (T03 triage, QA-2).** Venice finishes and bills the whole reply anyway (measured, above), so cancelling would save nothing and lose the number. When the stop arrives, `relayReply` stops relaying at once and returns what had arrived plus the unread rest of the stream. The generation saves it, ends and frees its lock as before. A detached **drain** (`drainStopped` in `src/commands/chat.ts`, on its own `forkVault` key copy) then reads the rest quietly, discards the text, and adds the usage and cost Venice reports at the end to `spentUsd` and to the stopped version, if one was saved. A stop before Venice has answered drains too, once Venice answers. Whether Venice bills that case is unmeasured live; the drain records whatever Venice reports. A stop before anything was sent sends nothing. If the drain's stream breaks, or the conversation is deleted meanwhile, nothing is recorded.
  - **Say so wherever a stop is offered:** "Stopping saves waiting, not money: Venice still writes and bills the whole reply, so its cost is added to the conversation once Venice reports it." That sentence is `STOP_BILL_NOTE`, returned as `generation.stop`'s `note`, so the browser can show the server's own words. A stopped version's cost appears a little after the stop: live, within seconds; on the mock with `MOCK_SLOW`, once the rest of the reply has been sent.
- **add** `(author = player | brain, content)`. Appends an authored message without generating anything. This is how you put words in the GM's mouth for the opening scene. Authoring an image-brain message starts image generation for that prompt.
- Brains: add anytime. Edit anytime: name, system prompt, reminder, tool text. Delete only if no ledger message references the brain, **and not while a generation for it is running** (its reply isn't in the ledger yet). Change the default anytime. Kind is locked once the brain has messages.

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
`{type:"following", startedAt}` (`generation.follow` only, first: a reply is running) · `{type:"message", message}` (player message saved) · `{type:"start", brainId, brainName, messageId, regenerate?, steer?}` (the id the new brain message will have, so a UI can key its streaming bubble; for `message.regenerate`, the id of the message getting a new version, with `regenerate: true` and its steer, if any) · `{type:"reasoning", delta}` · `{type:"delta", delta}` · `{type:"tool_args", delta}` · `{type:"image_pending", messageId, imageId}` · `{type:"image_done", messageId, imageId}` · `{type:"image_error", messageId, error}` · `{type:"done", message, note?}` (`note` is a one-line summary such as `Assistant · 52 in / 34 out · $0.000056`, which the CLI prints to stderr; `message` is `null` only from `generation.follow` when nothing was running) · `{type:"error", error: {code, message}}`

Every stream ends with exactly one `done` or `error` event; the CLI treats anything else as a broken stream. The CLI prints `delta` and `tool_args` to stdout as they arrive and `reasoning` and status lines to stderr, so `./ss turn ... > reply.md` captures only the reply.

### HTTP contract (implemented in T01, `src/server/app.ts`)

- `POST /api/<name>` with a JSON object body (an empty body means `{}`) and `Content-Type: application/json`, which is required even when the body is empty; anything else gets a 415 `unsupported_media_type`. With curl, add `-H 'content-type: application/json'`. Args are validated with the command's zod schema in strict mode, so unknown keys are a 400.
- Success: the JSON result, status 200. Failure: `{"error": {"code", "message", "details?"}}` with a real status: 400 `bad_args`/`bad_json`, 401 `unauthenticated`/`wrong_password`, 404 `not_found`/`unknown_command`, 405, 409 `conflict`, 502 `venice_error`, 500 `internal` (whose details go only to the log).
- Stream commands: the adapter pulls the first event *before* sending headers, so a failure up front (unknown id, 409 busy) is a normal HTTP error rather than a 200 stream with an error inside. After that, it keeps draining the generator even if the client disconnects, so work finishes and persists. **The work never waits on the client (T02 QA-2):** writes to the response are queued, never awaited, and once the request's signal says the client has gone they stop. A client that left before the response started is never read from or cancelled by @hono/node-server, so an awaited write there blocked forever and kept the 409 lock and the request's key copy until a restart. Handlers that should stop on disconnect can watch `ctx.signal`.
- `GET /api/<name>?k=v` works only for binary commands (so `<img src>` works) and `health`. State-changing commands can't be triggered by a link. Query values arrive as strings.
- Local-only guard: requests whose `Host` isn't `localhost`, `127.0.0.1` or `[::1]` are refused (DNS rebinding), and so is any request with a non-loopback `Origin` (CSRF). The Vite dev server on another localhost port is still allowed. Pages on *other* localhost ports are stopped by the JSON requirement instead: without a CORS preflight a page can only send `text/plain` or form bodies, and the server never approves a preflight (it sends no CORS headers), so a blind cookie-carrying POST from, say, `localhost:3000` gets a 415 (T01 QA-4).
- `x-ss-cli: 1` asks for `{result, text}`, where `text` is the command's own `format()` rendering. The CLI uses it; the browser doesn't need it.
- Everything else under `GET /` serves `web/dist` with an SPA fallback to `index.html`, or a placeholder page when there's no build.

### Writing a command

`command({...})`, `streamCommand({...})` or `binaryCommand({...})` from `src/registry.ts`, registered in `src/commands/index.ts`. Each one has a `name`, a `description` (the first line is the summary in `./ss help`), a zod `args` object, `auth` (default `true`, meaning login required) and optional `examples`. JSON commands can add `format(result)` for CLI text. Mark a password-like arg with `.meta({ secret: true, prompt: "Password for {username}: " })` and the CLI prompts for it with hidden input when it's omitted (`confirm: true` asks twice). With no terminal, it reads the first line of stdin, and empty stdin is a usage error rather than an empty password. A secret flag value is literal, except that `-` reads stdin: no `@file` expansion. `ctx.requireSession().vault` is this request's own key copy, valid until the handler (or the stream) finishes. Don't name args `json`, `help` or `out`, since those are CLI global flags. The catalog the CLI parses flags from is `help`, which returns each command's JSON Schema.

Implemented in T02 (`src/commands/conversations.ts`, `brains.ts`, `chat.ts`):
- `conversation.create --title --system-prompt [--text-model]`: the system prompt is required and must have real text. Returns the whole document.
- `conversation.list` → `{conversations: [...summaries], unreadable: [{id, error}]}`. A file that can't be read (bad JSON, wrong encryption, missing fields) is listed under `unreadable` with a content-free reason instead of failing the whole list (T02 QA-4).
- `conversation.get --id`, `conversation.delete --id` (409 while generating).
- `conversation.update --id [--title] [--settings.text-model|max-tokens|temperature|image-model] [--templates.player|other-brain-text|other-brain-image|steer]`. Only the fields given change; `null` unsets maxTokens or temperature (`--settings '{"maxTokens": null}'`). The templates are here already because hard requirement 1 says every word sent must be editable, and the player template is sent from T02 on.
- `brain.update --conversation [--brain] [--name --color --system-prompt --reasoning.enabled --reasoning.effort --final-reminder.enabled --final-reminder.content]`, for the same reason: the system prompt is sent, so it must be editable before T04. T04 adds `brain.add/delete/set-default` and kind/tool/safeMode.
- `turn --conversation [--content] [--brain]` (stream) and `prompt.preview --conversation [--brain] [--content]`. `--brain` takes a name (case-insensitive) or an id everywhere, through `resolveBrain`.
- `generation.follow --conversation` (stream, T02 frontend): re-attach to the reply being generated right now, from a reloaded browser tab or a second terminal. It sends `following`, then what has streamed so far (merged: one `reasoning`, one `delta`), then the rest live, and ends with the generation's own `done` or error. With nothing running it ends at once with `{type:"done", message: null}`; an unknown conversation is a 404. A later generating command (T03's regenerate) gets it for free by relaying through `gen.relay`.
- Error messages reach both clients, so they name no CLI flags as the only way out (T02 frontend): `nothing_to_answer` says "Write a message for it first.", and a broken stream says "To retry, send again with no new message: turn without --content, or Retry in the browser."

Implemented in T03 (`src/commands/messages.ts`, `chat.ts`):
- `message.regenerate --conversation [--message] [--steer]` (stream). `--message` defaults to the last message, and naming any other one is refused (`not_last_message`). Events and saving: see "Turns, regeneration and edits".
- `prompt.preview --regenerate [--message] [--steer]`: the exact body `message.regenerate` would send. `--message`/`--steer` without `--regenerate`, or `--regenerate` with `--content`/`--brain`, is a 400.
- `message.get --conversation --message`: one message with every version (steer, source, cost), for picking one from the terminal. The browser has them all from `conversation.get`.
- `message.edit --conversation --message --content`, `message.delete --conversation --message`, `message.select-version --conversation --message --version <1-based>`. Each returns the message (delete: `{deleted, messageCount}`), and each is a 409 while a reply is being generated.
- `generation.stop --conversation` → `{stopped, message, error?, note?}`: `message` is what the stopped generation saved (or null), `error` is its `stopped` error when it saved nothing, and `note` is the billing sentence above. With nothing running, `{stopped: false, message: null}`; an unknown conversation is a 404.
- T03 triage: `conversation.update` refuses a template without its placeholder (400 `bad_args` on `templates.<name>`). `message.delete` keeps the message's cost in `spentUsd`. `conversation.list`'s `costUsd` and `conversation.get`'s header both show `spentUsd`.
- `conversation.get`'s text view shows `version 2/3` and the active version's steer; `message.get` shows them all.

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

## Web app (`web/`)

React 19 + Vite + Tailwind v4, dark only, built to `web/dist` by `npm run up` and served by the same server. It is a skin over the commands: every server call goes through `web/src/api/client.ts` to `POST /api/<command>` (or `GET` for a binary command's `<img src>`), typed by the command maps in `web/src/api/types.ts`. There are no UI-only endpoints and no other fetches.

- **Errors.** Every failure is an `ApiError {status, code, message}`: the server's own error body, or `network`, `stream_broken` or `bad_stream` from the client. `status` is 0 when there was no HTTP error status. Views show `message` inline where it happened, or as a sticky error toast.
- **Streams.** `api.stream()` yields each NDJSON event as its line completes. A server `error` event, a dropped connection and a stream that ends without `done` all throw, so a consumer keeps the text it already has and still sees the failure. Aborting stops reading only; the server finishes and saves anyway.
- **Types.** The conversation document and model types are the server's own (`import type` from `src/conversations/types.ts` and `src/venice/models.ts`, both dependency-free), so the UI can't drift from what is on disk. Command args are still written out in `web/src/api/types.ts`.
- **Chat view (T02).** `/` is the new-conversation form and `/c/<id>` the chat. `features/chat/useChat.ts` holds one conversation: the ledger as saved, plus at most one *live reply* (streaming, or failed with its partial text). `turn` and `generation.follow` share one event reducer; deltas are buffered and painted once per animation frame. On load (and when the tab regains focus) it calls `conversation.get` then `generation.follow`, so a reload mid-reply picks the stream back up where it is. Leaving the view only stops reading. A 409 on send shows the error, gives the text back to the composer and follows whoever is replying (another tab, the CLI). Unsent drafts live in memory only, never in browser storage (an encrypted user's text must not land on disk).
- **Markdown.** `components/Markdown.tsx`: `react-markdown` + `remark-gfm` + `remark-breaks` (a single newline is a line break, as typed) + `rehype-highlight`, code blocks with a copy button, tables that scroll sideways. Raw HTML is never rendered and never dropped: it shows as faint literal text, because models here see and sometimes echo `<!-- from: ... -->` framing, and nothing a model wrote or will read should be invisible.
- **Every word sent is editable.** The settings panel (docked beside the chat when wide, a drawer when narrow) edits each brain's system prompt, reasoning (with the provider note) and final reminder, and the four framing templates, each with explicit Save/Revert (a half-typed prompt is never sent). "Payload" shows `prompt.preview` for the default brain *including the unsent composer text*: each message verbatim, or the raw JSON.
- **Session.** The UI mirrors `auth.whoami`: at boot, after login and logout, and whenever the tab regains focus. A response carrying `x-ss-session: invalid`, or a 401 `unauthenticated`/`session_ended`, sends the UI back to the login screen with a "session ended" notice and keeps the URL, so logging in again returns to it. Logout goes to `/`, so the next user doesn't land on someone else's conversation URL. Focusing a tab whose cookie now belongs to another user (logged in from another tab) switches to that user. The last username is remembered in `localStorage`; nothing else is stored in the browser.

## Mock Venice

`src/dev/mock-venice.ts` is a small HTTP server that speaks the Venice protocol: `/models`, `/chat/completions` (SSE streaming, including reasoning and forced tool calls), `/image/generate` (a tiny real image) and `/api_keys/rate_limits`. `npm run up:mock` starts it on port 4748 and points the app at it with `VENICE_BASE_URL`. In mock mode the server never loads `.env`, so the real key can't reach the mock. Tests start it in-process with `startMockVenice({ port: 0, delayMs: 0 })`.

Mock replies are deterministic and echo structure: `MOCK reply to brain "<system prompt, first 30 chars>"; saw N messages; last: "<last message, up to 60 chars>"`. A longer last message shows its first 30 and last 29 characters around `…` (T03), so a steer's instruction, which comes at the end of the steer template, shows in the reply. QA can then confirm what each brain saw without spending money. Because a reply echoes its input, a steered mock version quotes its own steer; checking "no trace of the steer" against the mock means checking the roles and the non-assistant messages, not grepping the whole body. Automated tests always use the mock or pure functions, never the live API.

Implemented in T01:
- The model list is a handful of entries copied verbatim from the live `/models` response (`src/dev/mock-models.ts`): `deepseek-v4-1-flash` (reasoning effort), `venice-uncensored-1-2` (no reasoning), `gemini-3-6-flash` (anonymized) and three image models covering the three image-pricing shapes.
- Chat streams match the live wire format captured on 2026-10-13: a role chunk, `reasoning_content` deltas (when the model reasons and `reasoning_effort` isn't `"none"`), `content` deltas or `tool_calls` argument fragments, a `finish_reason` chunk, then, with `stream_options.include_usage`, a final chunk with `choices: []`, `usage` and `cost: {usd, diem}`, then `data: [DONE]`. `stream: false` returns a plain `chat.completion`. For models without reasoning, the role chunk is `{role: "assistant", content: ""}`, as it is live.
- `max_tokens` is honored, counted in words, reasoning first and then content, as live: the reply is cut, `finish_reason` is `"length"`, and the last content delta rides in the finish chunk. A small budget with reasoning on leaves no content at all, like live (T02 QA-6).
- It **rejects** chat requests without `venice_parameters.include_venice_system_prompt: false`, so a regression on that hard rule fails tests.
- Images are always PNG, whatever `format` asks for, with the size taken from `width`/`height` (capped at 256 px). T05 should sniff the content type from the magic bytes rather than trust the requested format. `return_binary: true` returns raw bytes. Image responses carry `x-venice-is-blurred: false` and `x-venice-is-content-violation: false`, like live; the mock never blurs.
- A mock balance starts at $10 and goes down by each call's computed cost.
- `GET /_mock/requests` returns the last 20 request bodies, newest first. Compare it with `prompt.preview` to prove the real send matches the preview.
- Triggers in the last message (chat) or the prompt (image): `MOCK_ERROR` returns an HTTP error, `MOCK_SLOW` makes it slow (useful for 409 and stop tests), and `MOCK_MIDSTREAM_ERROR` drops the connection halfway through. `MOCK_MARKDOWN` (T02 frontend) appends a long Markdown reply after the echo line (`src/dev/mock-markdown.ts`: headings, nested and task lists, code in three languages, an aligned table, nested quotes, a footnote, an HTML comment), about 7 s at the default delay, which is also long enough to reload mid-stream.
- T02: it also refuses a chat request whose first message isn't a non-empty `system` message (hard rule 1). `MOCK_SLOW`'s per-chunk delay is `slowDelayMs` (default 250 ms; tests use 20). `MOCK_MIDSTREAM_ERROR` waits for what it wrote to reach the client before dropping, so even with no delay it is a real mid-stream failure.
