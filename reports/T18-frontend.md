# T18 frontend: a model per brain, in the browser

Mock only. No live calls were needed: the browser's part is our own commands, and the engineer already proved that a brain on its own model reaches Venice with it. `npm run typecheck` is clean and `npm test` passes 233/233 (one new test).

**I left Jason's server on 4747 alone.** I didn't restart or stop it, and I didn't rebuild `web/dist`. I built the web app into my scratchpad and served it from my own server on :4907, with a scratch mock on :4908. Both had their own `SS_DATA_DIR` and `SS_RUN_DIR`, and the only user was `dev-t18-fe`. I killed both processes at the end.

## What Jason will see

- **A brain's card** (Settings → Brains → the brain) now has a **Text model** picker right after Kind. An image brain also gets an **Image model** picker.
  - The first option is "Conversation default (DeepSeek V4.1 Flash)". It saves `null`, so the brain follows the conversation's model when that changes.
  - The curated list follows. Picking any model there makes it the brain's own.
  - The line under each picker says which model is in use and whose it is ("z-ai-glm-5-3 · its own · $1.75/M in … · always reasons").
  - For an image model, the line gives the price per image at this brain's shape and the conversation's resolution ("krea-2-turbo · its own · $0.06/image · 2K, 3:2"). Each option is priced the same way.
- **Reasoning moved up**, right under the text model it depends on (it used to sit below the system prompt). Everything there follows the brain's own model:
  - the switch, which is disabled for a model that can't reason;
  - the effort levels;
  - GLM's always-reasons note;
  - the new `effortNote` when the stored level isn't one the model lists, in the payload view's exact words. Example: "Grok 4.7 doesn't list the reasoning effort "max" (it lists low, medium, high)…".
- **A maker's blueprint** (the Character Creator) has the same two pickers, "Their text model" and "Their image model". Its reasoning follows the blueprint's model.
- **Closed cards** add a tag for a brain's own model: "on GLM 5.3", "paints with Krea 2 Turbo". The tag is amber with "(not listed)" when Venice no longer lists that model.
- **Models outside the curated list.**
  - A brain or conversation on a model the curated list hasn't got keeps it as the current option, by name: "Grok 4.7 (not in the curated list)". The card still uses that model's real reasoning levels and price.
  - A model Venice doesn't list at all shows as "gone-model (Venice doesn't list it)", with a warning that every request on it is refused.
- **Every place that names "the conversation's model" stays true:**
  - **Chat header:** "grok-4-7 · Co-GM: z-ai-glm-5-3" when one brain writes with another model, or "· 2 brains on their own" when several do. The tooltip names every brain with a model of its own, painters included.
  - **Conversation tab:** each picker's description says it is the default for brains without their own. Under each picker is a list of the brains that keep their own model, each with its model; clicking a brain's badge opens its card.
  - **Clone from here:** "For every brain but Co-GM, which keeps its own (GLM 5.3)". This matches what `conversation.clone --text-model` does.
  - **Payload view:** the first line is "Text model GLM 5.3 z-ai-glm-5-3 · Co-GM's own (the conversation's is deepseek-v4-1-flash)". An image brain gets a second line for its image model. Both come from `preview.models`.
  - **Brain lists:** the empty conversation's brain rows, the preset and example casts, and the add-brain picker tag a brain's own model id (`BrainTags`).
- **Images → Resolution** offers every resolution that an image model in use lists: the conversation's model, plus each image brain's own. That is `conversation.update`'s rule.
  - Each option's tooltip says which model offers it.
  - The note names any model in use that won't get the resolution. Example: with the conversation on Z-Image and the Scene Painter on Krea, it reads "Sets the price of krea-2-turbo (Scene Painter's). z-image-turbo (the conversation's) has no resolution setting…".
  - "Clear it" still appears for a resolution that no model in use takes.

## Code

- `web/src/features/settings/models.ts`: `useModels(type, wanted)` now returns `find(id)`.
  - It is undefined while loading and null when Venice doesn't list the id.
  - For an id in use that the curated list lacks, it fetches `models.list --all` once (cached per page).
  - `SettingsPanel` passes every model in use: the conversation's, each brain's and each blueprint's.
- `ModelPicker.tsx` (new): the Conversation tab's picker, moved out and extended with `inherit` (the "Conversation default" option, which saves `null`) and named options for models outside the list. `textModelDetail` moved here with it.
- `BrainModels.tsx` (new): the card's pickers. `imageFacts` holds the price and size, built on the server's own `buildImageRequest` and `imagePriceUsd`.
- `PromptFields.tsx`: the reasoning block is now its own `ReasoningFields`, which takes the brain's text model and shows `effortNote`. `PromptFields` no longer takes `imagePlan` or `model`.
- `BrainEditor`, `MakerSettings` and `BrainsTab` pass `settings` and the model lists down, instead of the conversation's single `model`.
- `ImageSettings` takes the model list and works out the models in use.
- `web/src/lib/models.ts` (new, DOM-free): `ownModels`, `otherTextModels`, `imageModelsInUse`, `resolutionChoices`, `whoseImageModel`.
- `ChatHeader`, `CloneMenu` (`CloneSource.ownText`, built in `Scrollback` from a string key so the memo holds), `PayloadDialog` (`ModelsLine`), `Cast.tsx` (`BrainTags`' `models`) and `ChatView` (passes `onOpenBrain` to `SettingsPanel`).
- `web/src/api/types.ts` re-exports `effortNote` and `resolutionsOf`.
- **No server change, no new command.** Everything the browser needed was already there: `brain.update --text-model/--image-model`, `models.list --all` and `preview.models`.

**Test:** `test/web-api.test.ts`, "T18: a model per brain…". It covers:
- the web client's shapes: a brain's own model, then `null`; a blueprint's model; `preview.models`; `models.list --all`;
- `ownModels` / `otherTextModels`;
- `effortNote`, compared with the server's own;
- the resolution rule, checked against the server. A painter is put on each mock image model in turn, and for 1K, 2K and 4K, `resolutionChoices` must agree with whether `conversation.update` accepts it.

I mutation-checked it: limiting `resolutionChoices` to the conversation's model fails with "1K with the painter on grok-imagine-image-2-0".

## Verified in Chrome (DevTools MCP, :4907, user `dev-t18-fe`, the Tabletop RPG preset)

**Scratch mock.** Every mock model is curated. To see a model Venice lists but the curated list leaves out, I ran the mock from a scratch wrapper script that pushed a "Grok 4.7" entry before calling `startMockVenice`. The entry is a copy of DeepSeek's with id `grok-4-7` and effort levels low/medium/high. The repo's mock is unchanged.

1. **A brain on its own text model.** I picked GLM 5.3 in the Co-GM's card.
   - The server saved it, and the line under the picker read "its own · always reasons".
   - GLM's always-reasons note appeared at once under the switch.
   - The card tag became "on GLM 5.3", and the header became "deepseek-v4-1-flash · Co-GM: z-ai-glm-5-3".
   - Sent from Co-GM's chip, the mock refused it as Venice does (reasoning off). I clicked the Co-GM badge in the Conversation tab, which opened its card, switched reasoning on and sent again. The reply's meta said `z-ai-glm-5-3`.
2. **A model outside the curated list, and an unlisted effort.** I set Show Me the Odds to `grok-4-7` with effort `max` from the CLI.
   - Its picker showed "Grok 4.7 (not in the curated list)" with Grok's levels.
   - The effort note matched `prompt.preview`'s note word for word.
   - Picking "Conversation default" brought the card back to DeepSeek and the note went away.
   - I then put the whole conversation on `grok-4-7`. The Conversation tab's picker and every brain's "Conversation default (Grok 4.7)" kept it, with Grok's caps.
   - Screenshot: `reports/screens/T18-brain-own-model.png`.
3. **An image brain on its own image model.** I picked Krea 2 Turbo in the Scene Painter's card.
   - Each option was priced for its landscape shape.
   - In the Conversation tab, Resolution offered 1K and 2K although Z-Image has none, and 2K saved.
   - The painter's card then read "$0.06/image · 2K, 3:2".
   - Sent from its chip, the picture was painted with `krea-2-turbo` at 2K. I checked both the mock's `/image/generate` body and the version's meta.
   - Putting the painter back on the default made the section say "The resolution 2K is kept from another model but isn't sent. Clear it".
   - Screenshot: `reports/screens/T18-conversation-images.png`.
4. **Payload view.** The Co-GM's showed the model line, the GLM note and `"model": "z-ai-glm-5-3"`. The Scene Painter's showed both models as the conversation's.
   - Screenshot: `reports/screens/T18-payload-own-model.png`.
5. **Clone from here** said "For every brain but Co-GM, which keeps its own (GLM 5.3)". I cloned under Venice Uncensored 1.2, and the copy's header read "venice-uncensored-1-2 · Co-GM: z-ai-glm-5-3".
6. **A model Venice doesn't list.** I edited the clone's plaintext file to give the GM `gone-text-model` and a painter `gone-image-model`.
   - The picker read "(Venice doesn't list it)", with the warning.
   - The card tags were amber, "(not listed)".
   - The reasoning switch didn't block.
7. **Blueprint.** "Their text model" set to GLM 5.3 saved as `makes.blueprint.textModel`, and the blueprint's reasoning followed GLM.
8. **The empty conversation's brain rows** tagged the Co-GM's `z-ai-glm-5-3`.
9. **Width.** At 1024 px the settings panel is a drawer, and the tags fit: `reports/screens/T18-brain-cards.png`. With the drawer closed, the header's model line fits beside the title.

No console errors or warnings. Every request went to `/api/<command>`, and `models.list` with `all` was requested once, only because a model in use was missing from the curated list.

## Left over / known gaps

- Grok 4.7 drops out of a brain's picker once you pick another model, since it is no longer curated. That is Jason's decision; setting it again is `--text-model grok-4-7` from the terminal.
- With a model Venice doesn't list, the card can't offer effort levels: it doesn't know them. Every request on that model is refused anyway, and the warning says so.
- The live reply's header doesn't name the model while it streams. The message's meta does, on hover, as before.

## Clean-up

I killed the scratch mock and server. The scratch data (the `dev-t18-fe` user) lived only in my scratchpad.
