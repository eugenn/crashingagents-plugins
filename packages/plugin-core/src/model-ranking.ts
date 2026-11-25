export interface RankableModel {
  model: string;
  displayName: string;
  description?: string;
}

/**
 * 0 = fast and economical, 3 = no hint. Hosts rarely expose comparable prices or latency,
 * so this reads the model family and description.
 */
export function modelSuitability(model: RankableModel): number {
  const family = (model.model + ' ' + model.displayName).toLowerCase();
  const description = (model.description ?? '').toLowerCase();
  const lightweight = /\b(nano|mini|haiku|flash|lite|luna)\b/.test(family);
  const economical =
    lightweight || /\b(affordable|cheaper|cheap|inexpensive|low.cost|budget)\b/.test(description);
  const fast = lightweight || /\b(fastest|fast|quick|low.latency)\b/.test(description);
  if (economical && fast) return 0;
  if (economical) return 1;
  if (fast) return 2;
  return 3;
}

/** Fast, low-cost models first. Keeps the provider's order within a tier. */
export function rankModels<T extends RankableModel>(models: T[]): T[] {
  return [...models].sort((a, b) => modelSuitability(a) - modelSuitability(b));
}
