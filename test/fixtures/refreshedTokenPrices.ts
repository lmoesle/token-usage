import source from './modelsDevPrices.json';
import previous from './previousTokenPrices.json';
import previousProviders from './previousTokenPriceProviders.json';
import retained from './retainedTokenPrices.json';
import preRefreshProviders from './preRefreshTokenPriceProviders.json';
import november3 from './november3TokenPriceAdditions.json';

// https://models.dev/api.json, retrieved 2026-11-18 (324 providers, 9,981 base models).
// Raw response SHA-256: d386013a3df274d61c0807cd88a75a0060913f4ce5b79736dae6b40480d8a839.
// modelsDevPrices.json retains only public provider/ID/canonical ID, base costs and mode costs.
// Sorted by provider then model key; canonical_model_id -> canonical, cost -> cost,
// experimental.modes[*].cost -> modes[*] (null without cost); keep only input/output/cache_read.
// previousTokenPrices.json is the pre-refresh 299-entry config, NOT generated from the new output.
// retainedTokenPrices.json records carried-forward rates from older snapshots and overrides
// earlier historical rates when an ID subsequently changed price before losing its source.
// The entries added on November 18 are taken from the prior runtime JSON at bc13bfb.
// preRefreshTokenPriceIds.json independently records all 3,957 pre-November IDs.
// Pre-November runtime JSON SHA-256: 367f39186fdfe04746db3e3fab7d30bf59e8c71aa043a862464dde3e1a29de30.
// november3TokenPriceAdditions.json independently records the 75 additional November 3 IDs,
// with their prices from the old runtime JSON and their provider from the exact old selector
// and minimized source at bc13bfb. The two ID baselines cover all 4,032 prior runtime IDs.
// Prior runtime JSON SHA-256: 50e414c7765f1c428be277d233cb6818d5a1fe35ea4fac057df0c040c7fc362e.
// opencodeLegacyModelPrices.json and opencodeModelPrices.json are sanitized November 18
// captures of V1 `models --refresh --verbose` and V2 `/api/model`, respectively.
// They retain only provider/model IDs, upstream IDs and observed text costs. Local V1 OAuth
// zero prices and V2 empty OAuth prices never override public prices. The V1 Voxtral Mini
// and Voxtral Mini TTS `latest` aliases also showed local zeros but lack public text rates.
// USD/million text tokens; cache_read -> cached (omitted cache_read defaults to zero).
// Missing input/output is unpriced, not free. Tiers, cache writes and non-text rates are out of scope.
// Modes use ID-mode, inherit base costs unless overridden; explicit zeros remain zero.
// Within a provider, an explicit model ID takes precedence over any synthesized mode ID
// with the same spelling, regardless of source order; cross-provider ranking is unchanged.
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
export function collectPriceCandidates(models: SourceModel[]) {
    const origins = new Set(['openai', 'anthropic', 'google', 'mistral', ...models
        .flatMap((model) => model.canonical ? [model.canonical.split('/')[0]] : [])]);
    const explicitIds = new Map<string, Set<string>>();
    for (const { provider, id } of models) {
        const ids = explicitIds.get(provider) ?? new Set<string>();
        ids.add(id);
        explicitIds.set(provider, ids);
    }
    const candidatesById = new Map<string, Candidate[]>();
    const sourceIds = new Set<string>();
    for (const model of models) {
        const variants: [string, Cost][] = [[model.id, model.cost]];
        for (const [mode, override] of Object.entries(model.modes ?? {})) {
            const id = `${model.id}-${mode}`;
            if (!explicitIds.get(model.provider)?.has(id)) {
                variants.push([id, { ...model.cost, ...override }]);
            }
        }
        for (const [id, cost] of variants) {
            sourceIds.add(id);
            if (cost.input === undefined || cost.output === undefined) continue;
            const origin = model.canonical?.split('/')[0];
            const direct = origin
                ? (originProviders[origin] ?? [origin]).includes(model.provider)
                : origins.has(model.provider);
            const candidates = candidatesById.get(id) ?? [];
            candidates.push({ provider: model.provider, direct, rates: [cost.input, cost.cache_read ?? 0, cost.output] });
            candidatesById.set(id, candidates);
        }
    }
    return { candidatesById, sourceIds };
}
const { candidatesById: priceCandidates, sourceIds } = collectPriceCandidates(sourceModels);
export { priceCandidates };

type PriceRow = [string, number, number, number];
export const previousTokenPrices = previous as PriceRow[];
export const previousTokenPriceProviders: Record<string, string> = previousProviders;
export const preRefreshTokenPriceProviders: Record<string, string> = preRefreshProviders;
export const november3TokenPriceAdditions = november3 as [string, string, number, number, number][];
const november3Providers = Object.fromEntries(november3TokenPriceAdditions.map(([id, provider]) => [id, provider]));
export const pinnedTokenPriceProviders: Record<string, string> = {
    ...preRefreshTokenPriceProviders, ...previousTokenPriceProviders, ...november3Providers
};
const november3Prices: PriceRow[] = november3TokenPriceAdditions.map(([id, , ...rates]) => [id, ...rates]);
const previousById = new Map([...previousTokenPrices, ...retained as PriceRow[], ...november3Prices]
    .map((row) => [row[0], row]));
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
export const refreshedTokenPrices: PriceRow[] = [...priceCandidates].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .flatMap(([id, candidates]) => {
        const chosen = selectPriceCandidate(candidates, pinnedTokenPriceProviders[id]);
        return chosen ? [[id, ...chosen.rates] as PriceRow] : [];
    });
export const historicalTokenPrices = [...previousById.values()].filter(([id]) =>
    !selectPriceCandidate(priceCandidates.get(id) ?? [], pinnedTokenPriceProviders[id]));
export const unpricedModelIds = [...sourceIds].filter((id) => !priceCandidates.has(id) && !previousById.has(id));
