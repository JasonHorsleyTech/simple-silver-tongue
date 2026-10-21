# T18 triage: A model per brain

**Result:** fixed 5, deferred 0, dismissed 0 (one sub-item of the QA-5 nit dismissed). Plus Jason's decision: **Grok 4.7 is out of the curated picker.** `npm test` 232/232, `npm run typecheck` clean.

**Jason's server on 4747 was left alone.** I didn't restart or stop it, and `web/dist` was not rebuilt. I used a scratch mock on :4898 and a server on :4897. Their data, run dir and web dist were in my scratchpad, the user was `dev-t18-tri`, and I killed both and removed the user at the end.

## Decisions

| Finding | Decision | What changed / why |
|---|---|---|
| **QA-1** (major): `conversation.update` accepts a resolution that only a painter's own model lists, but the import of that conversation refuses it | **FIX** | The import (`checkSettings`, campaigns.ts) now takes **any resolution some Venice image model offers**. It refuses only a resolution that no model offers, such as a slip in a hand-written file ("2k"), and the error lists the ones that exist. A conversation can hold a resolution its own image model doesn't take in two ways: only a painter's own model lists it (T18), or it was left by an earlier image model (QA's older sibling). Neither is sent where it isn't listed, and the payload view says so, so the export must import either way. One rule covers both cases. New helpers in `src/images/request.ts`: `resolutionsOf`, `offersResolution`. |
| **QA-2** (minor): Mistral Small 3.2, as a painter's text model, writes text before its forced call and once looped for 2+ minutes holding the lock | **FIX** (a guard) + **recommend** | `relayReply` takes a `textLimit`, which only image brains' requests get (`IMAGE_TEXT_LIMIT` = 2,000, turn.ts). Once that much text has come with no tool call started, the relay ends the reply the way a stop does. The rest of the stream is drained for the cost, the lock is free at once, and `turn` / `message.regenerate` fail with `no_prompt` (502, with the usual `details.retry`). The error says what happened and suggests another text model. Nothing sent changes (hard rule 1 holds), so the payload view has nothing new to show. The error and design.md explain it. The new mock trigger `MOCK_RUNAWAY` plays the loop. Live, Mistral's normal text before the call was 545 characters (below), well under the limit. **The roster is Jason's call:** Mistral stays, with a measured note in curated.ts. |
| **QA-3** (minor): an effort level the brain's model doesn't list is sent as set, silently | **FIX** | A payload-view note, `effortNote` in wording.ts (dependency-free, so the brain card can use it), added by `reviewBody` whenever the sent `reasoning_effort` isn't one the model lists: "DeepSeek V4.1 Flash doesn't list the reasoning effort "medium" (it lists low, high, max). It is sent as set, and Venice may pick a depth of its own or refuse it. Give Game Master a level its model lists." The level is still sent as set. Live (one call): DeepSeek took an unlisted "medium" (200, 39 reasoning tokens) without saying which depth it used. |
| **QA-4** (minor, predates T18): image fields left on a brain or blueprint switched to text make the export unimportable | **FIX** | `brain.update --kind text` keeps those fields on purpose ("in case it goes back"), so the import shouldn't refuse them. `toConversation` now drops tool text, safe mode, shape and image model from a text brain and from a text blueprint (`dropImageFields`) instead of refusing the file. Nothing reads them there. |
| **QA-5** (nit): wording | **FIX** 4 of 5 / **DISMISS** 1 | Fixed: `conversation.update` names a brain once ("Scene Painter (venice-uncensored-1-2; images: krea-2-turbo)"). `brain.import`'s note and the clone/import answer name only the flag that applies (`--image-model null` for an image-only override; "or" between them only when both apply). `presets.list` / `examples.list` text shows a brain's own models. `brain.add`'s help says a painter uses "its image model (the conversation's, unless it has its own)". **Dismissed:** a warning from `brain.update --text-model z-ai-glm-5-3` with reasoning off. `prompt.preview`'s note and the free 400 (with its hint) already say it. The Frontend's brain card shows the always-reasons note beside the switch (ticket scope). Putting it in the CLI's answer would mean changing `brain.update`'s return shape for one sentence. |
| **Jason: Grok 4.7 out of the picker** | done | Removed from `CURATED_TEXT`, with the why in its place (curated.ts). Also updated: design.md "Models" (18 text; Grok in the left-out list; the measurement kept, ending with his decision), AGENTS.md's Defaults line (18 text, why Grok is out), and the README's per-brain example (DeepSeek, not Grok; Grok still works by id). The mock never listed Grok. `test/e2e.test.ts`'s curated-order check now expects `grok-4-7` to be left out. |

## Tests

- `test/brain-models.test.ts`:
  - QA-1: the 2K-on-Krea conversation's export imports (2K and the painter's model kept, 2K still sent to it). The stale sibling imports, with 2K not sent and the payload note in place.
  - QA-4: a text brain with an image model, tool text and safe mode imports with them dropped. So does an image blueprint switched to text.
  - QA-3: the note appears for "medium" on DeepSeek and goes away at "high".
  - QA-2: `MOCK_RUNAWAY` ends just past 2,000 characters (not ~8,600), with `no_prompt`, the retry, the next turn running at once, the drained cost recorded and nothing saved. Mutation check: with the limit not passed, this test fails.
- `test/campaigns.test.ts`: a resolution no model offers ("2k") is refused, naming `settings.image.resolution`. This replaces the old "2K on z-image is refused".
- `test/e2e.test.ts`: the curated order no longer includes Grok.

## Re-verification (scratch mock, QA's commands)

```
$ ./sst conversation.update --settings.image-model z-image-turbo
$ ./sst brain.update --brain "Scene Painter" --image-model krea-2-turbo
$ ./sst conversation.update --settings.image.resolution 2K
Brains on a model of their own, which they keep: Scene Painter (images: krea-2-turbo). The others use the conversation's.
$ ./sst prompt.preview --brain "Scene Painter" --json | jq -c '.image.params|{model,resolution}'
{"model":"krea-2-turbo","resolution":"2K"}
$ ./sst conversation.get --json > export.json && ./sst conversation.import --campaign @export.json
Imported c_8fbsql8zzc "QA1 re" · deepseek-v4-1-flash · images z-image-turbo
Brains: …, Scene Painter (image) (its own image model krea-2-turbo), Character Portraitist (image)
$ # the stale sibling (krea + 2K, then z-image), before the fix: "z-image-turbo has no resolution setting"
Imported c_m13kb33kl3 "Stale" · deepseek-v4-1-flash · images z-image-turbo
$ jq '.settings.image.resolution="2k"' qa1.json > typo.json && ./sst conversation.import --campaign @typo.json
error: The campaign: settings.image.resolution: no Venice image model offers "2k" (they offer 1K, 2K). Fix it in the file, or leave it out for each model's default.

$ # QA-4: an image brain P switched to text, exported, imported (before: "brains.1: safe mode, shape, tool text and an image model are for image brains")
Imported c_g9qpmximlw "Kind switch" · deepseek-v4-1-flash · images z-image-turbo
$ # an image blueprint switched to text: imported, blueprint {"kind":"text","imageModel":null,"tool":false}

$ ./sst brain.update --brain P --reasoning.enabled --reasoning.effort medium && ./sst prompt.preview --brain P --content x
Note: DeepSeek V4.1 Flash doesn't list the reasoning effort "medium" (it lists low, high, max). It is sent as set, and Venice may pick a depth of its own or refuse it. Give P a level its model lists.

$ ./sst turn --brain Painter --content "MOCK_RUNAWAY paint the rain"     # ~1 s, 2,003 characters printed
error: Painter wrote over 2000 characters of text and no generate_image call, so the app ended the reply there (an image brain answers with that call; text beside it isn't kept). Its text model, deepseek-v4-1-flash, may not make the forced call reliably: if this happens again, give Painter another (brain.update --text-model). Your message is saved; the reply isn't. To retry, send again to Painter with no new message: turn --brain b_… without --content, or Retry in the browser.
$ ./sst turn --content "Next."          # runs at once: the lock was free
$ # spentUsd 0.0000333 at once, 0.002652 a few seconds later: the drain recorded the runaway reply's cost

$ ./sst conversation.update --settings.max-tokens 900     # Scene Painter with both models of its own
Brains on a model of their own, which they keep: Scene Painter (venice-uncensored-1-2; images: krea-2-turbo). The others use the conversation's.
$ ./sst conversation.clone --title Clone2                  # image model only
Scene Painter has a model of its own and keeps it; … brain.update --brain <name> --image-model null puts one on the conversation's.

$ # acceptance spot check: Co-GM on its own venice-uncensored-1-2
$ cmp <(prompt.preview --brain Co-GM … | jq -S .body) <(newest /chat/completions body in /_mock/requests | jq -S)
preview == send   (model venice-uncensored-1-2; the GM's preview: deepseek-v4-1-flash)
```

## Live (2 text calls, no images)

The balance went from **$5.59538192 to $5.595155** ($0.00023).
1. **DeepSeek V4.1 Flash with `reasoning_effort: "medium"`** (not in its list), `stream: false`, a two-line body. 200, "Blue", 39 reasoning tokens. Venice accepts the level; which depth it used is unknown. This is the evidence behind `effortNote`'s wording.
2. **Mistral Small 3.2 as the preset Scene Painter's text model** (the real preview body, model swapped), streamed through `openChatStream` + `relayReply` with the new `textLimit`, no image requested. It wrote 545 characters of text (the image prompt itself, as prose) and then a proper `generate_image` call (`finish_reason: tool_calls`), in 9 s. The guard didn't fire: Mistral's normal text before the call is a quarter of the limit.

## For the Frontend pass

- **Grok 4.7 is gone from `models.list`**, so from the pickers. A brain or conversation already on `grok-4-7` (set by id) must still show it as its current value. The Conversation tab's picker already keeps a current model that isn't in the list; the per-brain picker should do the same.
- **The brain card's effort levels** should follow the brain's model (ticket scope). When the stored level isn't among them (a brain moved to another model keeps its effort), show `effortNote` (wording.ts), the payload view's words.
- A runaway image reply ends as a `no_prompt` error with `details.retry`, like a painter that wrote no call. The existing error and Retry handling covers it; the live text the browser showed before the error is not saved.
