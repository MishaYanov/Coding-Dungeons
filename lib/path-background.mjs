const complete = record => record && ['scout','forge','explain'].every(key =>
  record[key] === true || record[key] === 1 || record[key] === '1');

export function prerequisiteBackground(campaign, target, progress = new Map()) {
  const quests = Array.isArray(campaign?.quests) ? campaign.quests : [];
  const quest = quests.find(quest => Number(quest.level) === Number(target));
  const loadout = Array.isArray(quest?.loadout) ? quest.loadout : [];
  return [...new Set(loadout.map(Number))].flatMap(level => {
    const prior = quests.find(quest => Number(quest.level) === level);
    return prior && !complete(progress.get(level)) ? [prior] : [];
  });
}
