const cacheLimit = 32;

export function savedCaseKey(rho, epsilon, preset) {
  const r = String(Math.round(rho * 20)).padStart(2, '0');
  const e = String(Math.round(epsilon * 40)).padStart(2, '0');
  return `r${r}-e${e}-${preset}`;
}

async function readReplay(response) {
  if (!response.ok) throw new Error(`Could not load the replay (HTTP ${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  const decoded = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(decoded).json();
}

export function createSavedReplayLoader({runId, defaultCase, defaultReplay}, fetchReplay = fetch) {
  const cache = new Map();
  const pending = new Map();
  const directory = new URL(`./replays/${runId}/`, import.meta.url);

  return async key => {
    if (key === defaultCase) return defaultReplay;
    if (cache.has(key)) {
      const replay = cache.get(key);
      cache.delete(key);
      cache.set(key, replay);
      return replay;
    }
    if (!pending.has(key)) {
      const request = fetchReplay(new URL(`${key}.json.gz`, directory))
        .then(readReplay)
        .then(replay => {
          cache.set(key, replay);
          if (cache.size > cacheLimit) cache.delete(cache.keys().next().value);
          return replay;
        })
        .finally(() => pending.delete(key));
      pending.set(key, request);
    }
    return pending.get(key);
  };
}
