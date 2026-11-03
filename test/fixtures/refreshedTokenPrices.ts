import source from './modelsDevPrices.json';
import previous from './previousTokenPrices.json';
import previousProviders from './previousTokenPriceProviders.json';
import retained from './retainedTokenPrices.json';
import preRefreshProviders from './preRefreshTokenPriceProviders.json';

// https://models.dev/api.json, retrieved 2026-11-03 (235 providers, 8,933 base models).
// Raw response SHA-256: 1f1715e750516001bea2d3ba95bdaded62ee4b42c515474aa43d29354cbefff9.
// modelsDevPrices.json retains only public provider/ID/canonical ID, base costs and mode costs.
// Sorted by provider then model key; canonical_model_id -> canonical, cost -> cost,
// experimental.modes[*].cost -> modes[*] (null without cost); keep only input/output/cache_read.
// previousTokenPrices.json is the pre-refresh 299-entry config, NOT generated from the new output.
// retainedTokenPrices.json contains only additional pre-November prices no longer priced
// by the selected source. preRefreshTokenPriceIds.json independently records all 3,957
// pre-November IDs; neither baseline is generated from the refreshed runtime output.
// Pre-November runtime JSON SHA-256: 367f39186fdfe04746db3e3fab7d30bf59e8c71aa043a862464dde3e1a29de30.
// opencodeModelPrices.json is a sanitized V2 /api/model capture: public provider/model
// runtime IDs, upstream modelIDs and text costs only; no runtime variants collapsed.
// All explicit API rates agree
// with models.dev. OAuth cost: [] means unpriced and NEVER overrides public prices.
// USD/million text tokens; cache_read -> cached (omitted cache_read defaults to zero).
// Missing input/output is unpriced, not free. Tiers, cache writes and non-text rates are out of scope.
// Modes use ID-mode, inherit base costs unless overridden; explicit zeros remain zero.
// previousTokenPriceProviders.json pins all 299 previous IDs to their inferred provider.
// Mistral-family aliases use Mistral, dated Claude aliases Anthropic, GPT chat aliases OpenAI.
// Other prior six-provider IDs use their prior Zen/direct/Go lane. For ambiguous shared
// equal-price IDs, pin Zen (prior priority), except explicitly preserved OpenAI pro models.
// Historical chat-latest/jev/qwen3.7-max are inferred Zen aliases. These are continuity
// assumptions, not claims that old records contained provider metadata. Pins NEVER depend
// on current numeric equality. Missing/unpriced pinned sources retain historical prices.
// preRefreshTokenPriceProviders.json pins the other 3,650 traceable pre-November IDs
// by running the EXACT October 27 selector on its source fixture from commit
// e45387314d07edc8dce0e434d8ee9715cf311a86, not by price
// matching. The eight remaining old IDs have no traceable source; no provenance is
// invented for them. Additional missing/unpriced pinned sources also retain old rates.
// New IDs: Zen > originating provider > Go > other providers, then lexical provider ID.
// Originating providers are canonical-ID namespaces; a provider's own model/alias or
// a non-aliased model in that namespace is direct. OpenAI/Anthropic/Google/Mistral also
// publish older models without canonical metadata.
interface Cost { input?: number; output?: number; cache_read?: number }
interface SourceModel {
    provider: string;
    id: string;
    canonical?: string;
    cost: Cost;
    modes?: Record<string, Cost | null>;
}
export interface Candidate { provider: string; direct: boolean; rates: [number, number, number] }

// Canonical publisher namespaces which differ from models.dev provider IDs.
const originProviders: Record<string, string[]> = {
    amazon: ['amazon-bedrock'],
    ibm: ['watsonx'],
    'bytedance-seed': ['volcengine'],
    tencent: ['tencent-tokenhub'],
    inclusionai: ['bailing'],
    'arcee-ai': ['arcee'],
    fireworks: ['fireworks-ai'],
    'inference-net': ['inference'],
    zhipuai: ['zhipuai', 'zai']
};

export const sourceModels: SourceModel[] = source;
const origins = new Set(['openai', 'anthropic', 'google', 'mistral', ...sourceModels
    .flatMap((model) => model.canonical ? [model.canonical.split('/')[0]] : [])]);
export const priceCandidates = new Map<string, Candidate[]>();
const sourceIds = new Set<string>();
for (const model of sourceModels) {
    const variants: [string, Cost][] = [[model.id, model.cost], ...Object.entries(model.modes ?? {})
        .map(([mode, override]): [string, Cost] => [`${model.id}-${mode}`, { ...model.cost, ...override }])];
    for (const [id, cost] of variants) {
        sourceIds.add(id);
        if (cost.input === undefined || cost.output === undefined) continue;
        const origin = model.canonical?.split('/')[0];
        const direct = origin
            ? (originProviders[origin] ?? [origin]).includes(model.provider)
            : origins.has(model.provider);
        const candidates = priceCandidates.get(id) ?? [];
        candidates.push({ provider: model.provider, direct, rates: [cost.input, cost.cache_read ?? 0, cost.output] });
        priceCandidates.set(id, candidates);
    }
}

export const previousTokenPrices = previous as [string, number, number, number][];
export const previousTokenPriceProviders: Record<string, string> = previousProviders;
export const preRefreshTokenPriceProviders: Record<string, string> = preRefreshProviders;
export const pinnedTokenPriceProviders = { ...preRefreshTokenPriceProviders, ...previousTokenPriceProviders };
export const retainedTokenPrices = retained as [string, number, number, number][];
const previousById = new Map([...previousTokenPrices, ...retainedTokenPrices].map(([id, ...rates]) => [id, rates]));
function rank(candidate: Candidate): number {
    if (candidate.provider === 'opencode') return 0;
    if (candidate.direct) return 1;
    if (candidate.provider === 'opencode-go') return 2;
    return 3;
}
export function selectPriceCandidate(candidates: Candidate[], pinnedProvider?: string): Candidate | undefined {
    if (pinnedProvider !== undefined) return candidates.find((candidate) => candidate.provider === pinnedProvider);
    return [...candidates].sort((a, b) => rank(a) - rank(b) || (a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0))[0];
}
export const refreshedTokenPrices: [string, number, number, number][] = [...priceCandidates].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .flatMap(([id, candidates]) => {
        const chosen = selectPriceCandidate(candidates, pinnedTokenPriceProviders[id]);
        return chosen ? [[id, ...chosen.rates] as [string, number, number, number]] : [];
    });
export const historicalTokenPrices = [...previousTokenPrices, ...retainedTokenPrices].filter(([id]) =>
    !selectPriceCandidate(priceCandidates.get(id) ?? [], pinnedTokenPriceProviders[id]));
export const unpricedModelIds = [...sourceIds].filter((id) => !priceCandidates.has(id) && !previousById.has(id));
