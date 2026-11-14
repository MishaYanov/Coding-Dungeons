export const maxHp = 100;
export const wrongSubmissionDamage = 5;
export const potionHealing = 20;

export function submissionDamage(hp, wrong) {
  return wrong && hp !== null ? Math.min(hp, wrongSubmissionDamage) : 0;
}

export function potionRecovery(hp) {
  return Math.min(potionHealing, maxHp - hp);
}
