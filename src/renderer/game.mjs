const draftKey = 'ferrum-prompt-drafts-v2';
const lastPageKey = 'ferrum-last-page-v2';
const selectedHeroKey = 'ferrum-selected-hero-v1';
const heroRoutes = /^\/api\/(?:progress(?:\/|$)|profile$|answers(?:\/|$)|grade$|encounters\/|levels\/|workbench\/|combat\/|trials(?:\/|$)|diamond(?:[/?]|$)|refactoring$|system-design$)/;
const emptyProgress = () => ({
  levels: new Map(), responses: new Map(), attempts: [], workbenchModes: new Map(),
  hardClears: new Set(), hardExerciseClears: new Set(), exerciseClears: null, progressError: '', forgeAnimation: null,
});

export function pageNumber(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function hashPage() {
  return pageNumber(location.hash.match(/^#page=(\d+)$/)?.[1]);
}

function readLocal(key) {
  try {
    return window.codingDungeonsStorage ? window.codingDungeonsStorage.get(key) : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key, value) {
  try {
    if (window.codingDungeonsStorage) return window.codingDungeonsStorage.set(key, value);
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function readDrafts(hero) {
  try {
    const value = JSON.parse(readLocal(`${draftKey}:${hero.id}`) || '{}');
    return new Map(Object.entries(value).filter(([, draft]) => typeof draft === 'string'));
  } catch {
    return new Map();
  }
}

function selectedKey(world) {
  return world.id === 'rust' ? selectedHeroKey : `${selectedHeroKey}:${world.id}`;
}

function rememberHero(world, id) {
  try {
    if (id) sessionStorage.setItem(selectedKey(world), id);
    else sessionStorage.removeItem(selectedKey(world));
  } catch {
    // The current hero still works if session storage is disabled.
  }
}

function savedHero(world) {
  try {
    return sessionStorage.getItem(selectedKey(world));
  } catch {
    return null;
  }
}

export function createGame() {
  let game = {
    ...emptyProgress(), worlds: [], world: null, campaign: {}, campaignError: '',
    hero: null, profile: { callsign: 'Explorer', path: '' }, drafts: new Map(),
    combat: null, combatNotice: '', potionBusy: false, switchingHero: false,
    diamond: null, diamonds: 0, diamondStarting: false, diamondFocus: false,
    runner: '', runnerDetail: '', storage: '', page: null, total: null, zoom: 1, dialog: null,
    loading: true, ready: false, readerMessage: 'Opening the campaign book…',
    pageError: null, toast: '',
  };
  const listeners = new Set();
  let booted = false;
  let manualHeroSelection = false;
  let pageRequest = 0;
  let progressRequest = 0;
  let combatVersion = 0;
  let pendingCombat;
  let toastTimer;
  let positionWrites = Promise.resolve();

  const update = (changes) => {
    game = { ...game, ...changes };
    for (const listener of listeners) listener();
  };

  async function api(path, { method = 'GET', body, hero = game.hero, signal } = {}) {
    const headers = { Accept: 'application/json' };
    if (game.world) headers['X-Ferrum-World'] = game.world.id;
    if (method !== 'GET') {
      headers['X-Ferrum-Request'] = '1';
      headers['Content-Type'] = 'application/json';
    }
    if (heroRoutes.test(path)) {
      if (!hero) throw new Error('Choose a hero to save your expedition.');
      headers['X-Ferrum-Hero'] = hero.id;
    }
    const response = await fetch(path, {
      method, headers, signal, cache: 'no-store', credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 204) return {};
    const data = await response.json().catch(() => {
      throw new Error(`The server returned an unreadable response (${response.status}).`);
    });
    if (!response.ok) throw new Error(data?.error || data?.message || `Request failed (${response.status}).`);
    return data || {};
  }

  function toast(copy) {
    clearTimeout(toastTimer);
    update({ toast: copy });
    toastTimer = setTimeout(() => update({ toast: '' }), 4500);
  }

  const isCurrentHero = (hero) => hero === game.hero;

  function persistDraft(key, value) {
    if (!game.hero) return false;
    const drafts = new Map(game.drafts).set(key, value);
    update({ drafts });
    return writeLocal(`${draftKey}:${game.hero.id}`, JSON.stringify(Object.fromEntries(drafts)));
  }

  function clearDraft(key, submittedValue) {
    if (!game.hero || game.drafts.get(key) !== submittedValue) return;
    const drafts = new Map(game.drafts);
    drafts.delete(key);
    update({ drafts });
    writeLocal(`${draftKey}:${game.hero.id}`, JSON.stringify(Object.fromEntries(drafts)));
  }

  function combatNotice(event) {
    if (!event) return game.combatNotice;
    const { damage, healing, potionsEarned } = event;
    return [
      damage && `−${damage} HP`, healing && `+${healing} HP`,
      potionsEarned && `+${potionsEarned} ${potionsEarned === 1 ? 'potion' : 'potions'}`,
    ].filter(Boolean).join(' · ');
  }

  async function submitExpedition(path, options = {}) {
    const hero = game.hero;
    if (!hero || game.switchingHero) throw new Error('Choose a hero to submit.');
    if (game.combat?.fallen) throw new Error('Your hero has fallen.');
    if (pendingCombat) throw new Error('Your previous submission is still being checked.');
    const request = {};
    pendingCombat = request;
    try {
      const result = await api(path, {
        ...options, hero, method: 'POST',
        body: { ...options.body, submissionId: crypto.randomUUID() },
      });
      if (isCurrentHero(hero)) {
        combatVersion++;
        if (result.combat) update({ combat: result.combat, combatNotice: combatNotice(result.combatEvent) });
      }
      return result;
    } finally {
      if (pendingCombat === request) pendingCombat = null;
    }
  }

  async function drinkPotion() {
    const { hero, combat, potionBusy } = game;
    if (!hero || !combat?.oneLife || potionBusy || combat.fallen || !combat.potions || combat.hp === combat.maxHp) return;
    update({ potionBusy: true });
    try {
      await submitExpedition('/api/combat/potion');
    } catch (error) {
      if (isCurrentHero(hero)) update({ combatNotice: error.message });
    } finally {
      if (isCurrentHero(hero)) update({ potionBusy: false });
    }
  }

  async function refreshProgress({ animateForgeLevel = null } = {}) {
    const hero = game.hero;
    if (!hero) return;
    const request = ++progressRequest;
    const healthVersion = combatVersion;
    try {
      const progress = await api('/api/progress', { hero });
      if (!isCurrentHero(hero) || request !== progressRequest) return;
      const profile = progress.profile ?? {};
      update({
        profile: { callsign: profile.callsign || hero.name || 'Explorer',
          path: profile.path === 'all' ? '' : profile.path || '', lastPage: pageNumber(profile.lastPage) },
        levels: new Map((progress.levels ?? []).map((level) => [Number(level.level), level])),
        responses: new Map((progress.responses ?? []).map((response) => [`${response.page}:${response.promptId}`, response])),
        attempts: progress.attempts ?? [],
        workbenchModes: new Map((progress.workbench?.modes ?? []).map((mode) => [Number(mode.level), mode])),
        hardClears: new Set(progress.workbench?.hardClears ?? []),
        hardExerciseClears: new Set(progress.workbench?.hardExerciseClears ?? []),
        exerciseClears: Array.isArray(progress.workbench?.clears) ? new Set(progress.workbench.clears) : null,
        ...(healthVersion === combatVersion && progress.combat ? { combat: progress.combat } : {}),
        progressError: '',
        forgeAnimation: animateForgeLevel,
      });
    } catch (error) {
      if (!isCurrentHero(hero) || request !== progressRequest) return;
      update({ progressError: error.message });
      throw error;
    }
  }

  async function setMode(level, mode) {
    const hero = game.hero;
    const result = await api(`/api/workbench/${level}/mode`, { hero, method: 'PATCH', body: { mode } });
    if (isCurrentHero(hero)) {
      progressRequest++;
      update({ workbenchModes: new Map(game.workbenchModes).set(Number(level), result) });
    }
    return result;
  }

  function recordResponse(hero, response) {
    if (!isCurrentHero(hero)) return;
    progressRequest++;
    const key = `${response.page}:${response.promptId}`;
    update({ responses: new Map(game.responses).set(key, response) });
  }

  function saveReadingPosition(page, hero) {
    writeLocal(`${lastPageKey}:${hero.id}`, String(page));
    positionWrites = positionWrites.then(async () => {
      if (isCurrentHero(hero) && game.profile.lastPage === page) return;
      try {
        await api('/api/profile', { hero, method: 'PATCH', body: { lastPage: page } });
        if (isCurrentHero(hero)) update({ profile: { ...game.profile, lastPage: page } });
      } catch {
        // The local copy still restores the page if the write fails.
      }
    });
  }

  function setDiamond(diamond) {
    update({ diamond, diamonds: diamond?.diamonds ?? 0 });
  }

  async function loadDiamond(page, request, hero) {
    if (game.diamond?.encounter || game.diamondStarting) return;
    try {
      const diamond = await api(`/api/diamond?page=${page}`, { hero });
      if (isCurrentHero(hero) && pageRequest === request && !game.diamondStarting && !game.diamond?.encounter) {
        setDiamond(diamond);
      }
    } catch {
      // The book remains available when an optional encounter cannot load.
    }
  }

  async function startDiamond() {
    const { hero, page, diamond, combat, diamondStarting, switchingHero } = game;
    if (!hero || !page || !diamond?.sparkle || combat?.fallen || diamondStarting || switchingHero) return;
    const request = pageRequest;
    update({ diamondStarting: true });
    try {
      const started = await api('/api/diamond/start', { hero, method: 'POST', body: { page: page.page } });
      if (isCurrentHero(hero)) update({ diamond: started, diamonds: started.diamonds ?? 0, diamondFocus: true });
    } catch (error) {
      if (isCurrentHero(hero)) toast(error.message);
    } finally {
      if (isCurrentHero(hero)) {
        update({ diamondStarting: false });
        if (!game.loading && game.page && pageRequest !== request) void loadDiamond(game.page.page, pageRequest, hero);
      }
    }
  }

  async function loadPage(number) {
    const hero = game.hero;
    if (!hero) return;
    const request = ++pageRequest;
    update({
      loading: true, pageError: null, readerMessage: `Opening page ${number}…`, forgeAnimation: null,
      diamond: game.diamond?.encounter ? game.diamond : null,
    });
    try {
      const data = await api(`/api/pages/${number}`);
      if (!isCurrentHero(hero) || request !== pageRequest) return;
      const page = pageNumber(data.page);
      const total = pageNumber(data.total);
      if (!page || !total || page > total) throw new Error('The book page metadata is incomplete.');
      update({ page: { ...data, page }, total, loading: false });
      saveReadingPosition(page, hero);
      void loadDiamond(page, request, hero);
    } catch (error) {
      if (!isCurrentHero(hero) || request !== pageRequest) return;
      update({ loading: false, readerMessage: error.message, pageError: number });
    }
  }

  function openPage(value) {
    const page = pageNumber(value);
    if (!page || !game.hero || game.switchingHero) return;
    const target = game.total ? Math.min(page, game.total) : page;
    if (hashPage() !== target) location.hash = `page=${target}`;
    else if (game.page?.page !== target || game.pageError) void loadPage(target);
  }

  function readHash() {
    const page = hashPage();
    if (!game.ready || game.switchingHero || !page) return;
    const target = game.total ? Math.min(page, game.total) : page;
    if (target !== game.page?.page) {
      void loadPage(target);
    } else if (game.loading || game.pageError) {
      const request = ++pageRequest;
      update({ loading: false, pageError: null });
      void loadDiamond(target, request, game.hero);
    }
  }

  function changeZoom(value) {
    update({ zoom: Math.max(.65, Math.min(1.85, Math.round(value * 100) / 100)) });
  }

  function openDialog(name) {
    if (name === 'world' || (name === 'hero' && game.world) || game.hero) {
      update({ dialog: name });
      if (name === 'log') refreshProgress().catch((error) => toast(error.message));
    }
  }

  function closeDialog() {
    if (game.dialog === 'world') {
      if (game.world) update({ dialog: game.hero ? null : 'hero' });
    } else if (game.dialog === 'hero') {
      if (game.hero && !game.switchingHero) update({ dialog: null });
    } else {
      update({ dialog: null });
    }
  }

  async function activateHero(hero, preferredPage) {
    if (typeof hero?.id !== 'string' || !hero.id) throw new Error('The server did not return a hero save slot.');
    clearTimeout(toastTimer);
    pageRequest++;
    progressRequest++;
    combatVersion = 0;
    pendingCombat = null;
    update({
      ...emptyProgress(), hero, drafts: readDrafts(hero), combat: hero.combat || null,
      combatNotice: '', potionBusy: false, diamond: null, diamonds: 0,
      diamondStarting: false, diamondFocus: false, page: null, pageError: null,
      profile: { callsign: hero.name || 'Explorer', path: hero.path === 'all' ? '' : hero.path || '',
        lastPage: pageNumber(hero.lastPage) },
      ready: false, loading: true, readerMessage: 'Opening your expedition…', toast: '',
    });
    rememberHero(game.world, hero.id);
    await refreshProgress().catch(() => {});
    if (!isCurrentHero(hero)) return;
    const rememberedPage = pageNumber(readLocal(`${lastPageKey}:${hero.id}`));
    const requested = preferredPage || rememberedPage || game.profile.lastPage || 1;
    const page = game.total ? Math.min(requested, game.total) : requested;
    history.replaceState(null, '', `#page=${page}`);
    update({ ready: true });
    await loadPage(page);
  }

  async function selectHero(path, body, preferredPage = null) {
    if (game.switchingHero) return false;
    manualHeroSelection = true;
    update({ switchingHero: true });
    try {
      const { hero } = await api(path, { method: 'POST', body });
      await activateHero(hero, preferredPage);
      update({ dialog: null });
      return true;
    } finally {
      update({ switchingHero: false });
    }
  }

  async function saveProfile(callsign, path) {
    const hero = game.hero;
    const result = await api('/api/profile', { hero, method: 'PATCH', body: { callsign, path } });
    if (!isCurrentHero(hero)) return false;
    update({ profile: {
      ...game.profile, callsign: result.hero?.name || callsign || 'Explorer',
      path: result.hero?.path === 'all' ? '' : result.hero?.path || path,
    } });
    return true;
  }

  async function boot() {
    if (booted) return;
    booted = true;
    try {
      const { worlds = [] } = await api('/api/worlds');
      const selection = new URLSearchParams(location.search).get('world') || (hashPage() ? 'rust' : '');
      const world = worlds.find((candidate) => candidate.id === selection) || null;
      update({ worlds, world });
      if (!world) {
        update({ dialog: 'world', loading: false, readerMessage: 'Choose a world to open its book.' });
        return;
      }
      const [campaign, status] = await Promise.allSettled([api('/api/campaign'), api('/api/status')]);
      update({
        campaign: campaign.value ?? {}, campaignError: campaign.reason?.message ?? '',
        total: pageNumber(campaign.value?.total), runner: status.value?.runner ?? '',
        runnerDetail: status.value?.runnerDetail ?? '', storage: status.value?.storage ?? '',
      });
      if (manualHeroSelection) return;
      const saved = savedHero(world);
      if (saved) {
        try {
          const { hero } = await api('/api/heroes/load', { method: 'POST', body: { id: saved } });
          if (!manualHeroSelection) await activateHero(hero, hashPage());
          return;
        } catch {
          if (manualHeroSelection) return;
          rememberHero(world, null);
        }
      }
      update({ dialog: 'hero', loading: false, readerMessage: 'Choose a hero to open the campaign book.' });
    } catch {
      update({ dialog: 'world', loading: false, readerMessage: 'The worlds could not be loaded.' });
    }
  }

  return {
    getSnapshot: () => game,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    actions: {
      api, boot, isCurrentHero, submitExpedition, persistDraft, clearDraft, refreshProgress, setMode, recordResponse,
      openPage, loadPage, readHash, changeZoom, openDialog, closeDialog, selectHero, saveProfile,
      drinkPotion, startDiamond, setDiamond, toast,
    },
  };
}
