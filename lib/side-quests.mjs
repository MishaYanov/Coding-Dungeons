import refactoring from '../data/workbench/refactoring.mjs';
import systemDesign from '../data/workbench/system-design.mjs';
import rateLimiter from '../data/workbench/rate-limiter.mjs';
import typedNotice from '../data/workbench/typed-notice.mjs';
import cancellableRelay from '../data/workbench/cancellable-relay.mjs';
import rogueRust from '../data/workbench/rogue-rust.mjs';
import rogueGo from '../data/workbench/rogue-go.mjs';

const entries = [
  {world:'javascript', key:'refactoring', slug:'refactoring', level:14, catalog:refactoring},
  {world:'javascript', key:'systemDesign', slug:'system-design', level:13, catalog:systemDesign},
  {world:'javascript', key:'rateLimiter', slug:'rate-limiter', level:12, catalog:rateLimiter},
  {world:'typescript', key:'typedNotice', slug:'typed-notice', level:11, catalog:typedNotice},
  {world:'go', key:'cancellableRelay', slug:'cancellable-relay', level:12, catalog:cancellableRelay},
  {world:'rust', key:'rogueRust', slug:'rogue-rust', level:28, catalog:rogueRust},
  {world:'go', key:'rogueGo', slug:'rogue-go', level:14, catalog:rogueGo},
];

export const sideQuestRoutes = new Map(entries.map(entry => [`/api/${entry.slug}`, entry]));

export function sideQuestsFor(world, levels) {
  const quests = new Map();
  for (const [path, entry] of sideQuestRoutes) {
    if (entry.world !== world) continue;
    const page = levels.find(level => level.level === entry.level)?.sidePage;
    if (page) quests.set(path, {...entry, page});
  }
  return quests;
}

export function publicSideQuest({key, slug, page, catalog:{title, description}}) {
  return {key, slug, page, title, description};
}
