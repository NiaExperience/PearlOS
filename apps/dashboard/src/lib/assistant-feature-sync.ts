import { FeatureKeys, type FeatureKey, isFeatureEnabled } from '@nia/features';

export function coerceFeatureKeyList(raw: unknown): FeatureKey[] {
    if (!Array.isArray(raw)) {
        return [];
    }

    const set = new Set<FeatureKey>();
    for (const item of raw) {
        if (typeof item === 'string' && FeatureKeys.includes(item as FeatureKey)) {
            set.add(item as FeatureKey);
        }
    }

    return FeatureKeys.filter(key => set.has(key));
}

export function featureListsEqual(a: FeatureKey[], b: FeatureKey[]): boolean {
    if (a.length !== b.length) {
        return false;
    }

    return a.every((value, index) => value === b[index]);
}
