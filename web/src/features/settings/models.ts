import { useEffect, useState } from "react";
import { api } from "../../api/client.ts";
import { errorMessage } from "../../api/errors.ts";
import type { ModelInfo } from "../../api/types.ts";

/**
 * Venice's models (models.list, cached ~10 min on the server, and once per page here, per type). The text list
 * says what a model can do (reasoning, effort levels) and feeds the text model pickers; the image list feeds the
 * image model pickers and prices.
 *
 * T18: the pickers offer the model list (models.ini, T19), but a conversation or a brain may be on any model Venice
 * lists (set by id, or listed once and since taken out). `find(id)` looks a model up in the offered list and, for
 * an id it hasn't got (`wanted`: the models in use), in everything Venice lists (models.list --all, fetched only
 * then), so a brain on such a model still gets that model's reasoning switch and price. `find` is undefined while
 * loading (or when the list couldn't load: callers don't block on it), null when Venice doesn't list the id at all.
 */
export type ModelList = {
  models: ModelInfo[] | null;
  error: string | null;
  find(id: string): ModelInfo | null | undefined;
};

const cached: Partial<Record<ModelInfo["type"], Promise<ModelInfo[]>>> = {};
const cachedAll: Partial<Record<ModelInfo["type"], Promise<ModelInfo[]>>> = {};

export function useModels(type: ModelInfo["type"], wanted: readonly string[] = []): ModelList {
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState<ModelInfo[] | null>(null);
  useEffect(() => {
    let live = true;
    const p = (cached[type] ??= api.call("models.list", { type }).then((r) => r.models));
    p.then(
      (m) => live && setModels(m),
      (err) => {
        delete cached[type]; // try again next time
        if (live) setError(errorMessage(err));
      },
    );
    return () => {
      live = false;
    };
  }, [type]);

  // The ids in use that the offered list hasn't got, as one stable string (the effect runs when that set changes).
  const missing = models ? [...new Set(wanted)].filter((id) => !models.some((m) => m.id === id)).sort().join("\n") : "";
  useEffect(() => {
    if (!missing) return;
    let live = true;
    const p = (cachedAll[type] ??= api.call("models.list", { type, all: true }).then((r) => r.models));
    p.then(
      (m) => live && setAll(m),
      () => {
        delete cachedAll[type]; // unknown, not "Venice doesn't list it": find stays undefined
      },
    );
    return () => {
      live = false;
    };
  }, [type, missing]);

  const find = (id: string): ModelInfo | null | undefined => {
    if (!models) return undefined;
    const offered = models.find((m) => m.id === id);
    if (offered) return offered;
    return all ? (all.find((m) => m.id === id) ?? null) : undefined;
  };
  return { models, error, find };
}
