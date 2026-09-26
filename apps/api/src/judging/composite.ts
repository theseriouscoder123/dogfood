// A review's single number: each criterion is rescaled to [0,1] by its own range,
// averaged with the rubric weights, then mapped onto a 1-5 display scale.
// Weights are read at compute time, so re-weighting never needs re-scoring.
export type CriterionSpec = { id: string; key: string; weight: number; minScore: number; maxScore: number };

export function compositeScore(values: Map<string, number>, criteria: CriterionSpec[]): number | null {
  let weighted = 0;
  let totalWeight = 0;
  for (const c of criteria) {
    const v = values.get(c.id);
    if (v === undefined) continue;
    weighted += c.weight * ((v - c.minScore) / (c.maxScore - c.minScore));
    totalWeight += c.weight;
  }
  return totalWeight === 0 ? null : 1 + 4 * (weighted / totalWeight);
}
