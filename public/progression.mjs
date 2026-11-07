const CORE_MARKS = ["scout", "forge", "explain"];
const HERO_LEVEL_CAP = 10;
export const SKILL_LEVEL_CAP = 5;

const earnedMark = (value) => value === true || value === 1 || value === "1";

export function characterProgress(campaign, levels, pathId) {
  const worldLevels = new Set((campaign.quests ?? []).map((quest) => Number(quest.level)));
  const counts = { scout: 0, forge: 0, explain: 0, side: 0 };
  const coreMarksByLevel = new Map();
  for (const level of worldLevels) {
    const record = levels.get(level);
    let marks = 0;
    for (const mark of CORE_MARKS) {
      if (earnedMark(record?.[mark])) {
        counts[mark] += 1;
        marks += 1;
      }
    }
    if (earnedMark(record?.side)) counts.side += 1;
    coreMarksByLevel.set(level, marks);
  }

  const isComplete = (level) => coreMarksByLevel.get(level) === CORE_MARKS.length;
  const total = worldLevels.size;
  const completed = [...worldLevels].filter(isComplete).length;
  const marks = counts.scout + counts.forge + counts.explain;
  const marksTotal = total * CORE_MARKS.length;

  // Each core mark gives one XP. The nine level-ups divide the world's XP evenly.
  const heroLevel = marksTotal ? 1 + Math.floor(marks * (HERO_LEVEL_CAP - 1) / marksTotal) : 1;
  const nextLevelXp = marksTotal && heroLevel < HERO_LEVEL_CAP
    ? Math.ceil(heroLevel * marksTotal / (HERO_LEVEL_CAP - 1))
    : null;

  const path = (campaign.paths ?? []).find((item) => item.id === pathId);
  let route = null;
  if (path) {
    const pathLevels = [...new Set(path.levels.map(Number))].filter((level) => worldLevels.has(level));
    route = { name: path.name, completed: pathLevels.filter(isComplete).length, total: pathLevels.length };
  }

  const skills = [];
  for (const zone of campaign.zones ?? []) {
    const zoneLevels = [...worldLevels].filter((level) => level >= zone.first && level <= zone.last);
    if (!zoneLevels.length) continue;
    const earned = zoneLevels.reduce((sum, level) => sum + coreMarksByLevel.get(level), 0);
    const available = zoneLevels.length * CORE_MARKS.length;
    // Each fifth of a zone's core marks adds one skill level.
    skills.push({ name: zone.skill || zone.name, level: Math.floor(earned * SKILL_LEVEL_CAP / available), earned, total: available });
  }

  return {
    heroLevel, heroLevelCap: HERO_LEVEL_CAP, xp: marks, xpMax: marksTotal, nextLevelXp,
    completed, total, marks, marksTotal, counts, route, skills,
  };
}
