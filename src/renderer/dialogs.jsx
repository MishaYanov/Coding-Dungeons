import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { characterProgress, SKILL_LEVEL_CAP } from '../../public/progression.mjs';

const pathTopics = new Map([
  ['architect', 'Borrowing and lifetimes, traits and generics, dynamic dispatch, error design, and evolving library APIs.'],
  ['warden', 'Threads, locks and channels, atomic ordering, futures and pinning, cancellation, and graceful shutdown.'],
  ['delver', 'Memory layout, pointer validity, initialization and cleanup, C interoperability, and testing unsafe code.'],
  ['pathfinder', 'Borrowing parsers, transactional stores, bounded pipelines, reconnects and retries, and a final system design project.'],
]);
const rustZones = [
  { name: 'Borrowed Citadel', skill: 'Ownership and borrowing', first: 1, last: 8 },
  { name: 'Trait Foundry', skill: 'Traits and API design', first: 9, last: 18 },
  { name: 'Clockwork Wilds', skill: 'Concurrency and async', first: 19, last: 28 },
  { name: 'Unsafe Depths', skill: 'Unsafe Rust and memory', first: 29, last: 36 },
  { name: 'Endgame', skill: 'Systems design', first: 37, last: 42 },
];
const marks = [['scout', 'Scout'], ['forge', 'Forge'], ['explain', 'Explain'], ['side', 'Side quest']];
const enabled = (value) => value === true || value === 1 || value === '1';
const zonesFor = (campaign) => campaign.zones?.length ? campaign.zones : rustZones;

function pageNumber(value) {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : null;
}

function questPage(campaign, quest, level) {
  return pageNumber(quest?.page ?? quest?.startPage ?? campaign.levelPages?.[level]);
}

function Modal({ id, title, caption, className, description, closeLabel, closeId, close, blocked, emblem, children }) {
  const ref = useRef(null);
  const titleId = id + '-title';
  useLayoutEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  const heading = <div><p className="eyebrow">{caption}</p><h2 id={titleId}>{title}</h2></div>;
  return (
    <dialog ref={ref} id={id + '-dialog'} className={className} aria-labelledby={titleId} aria-describedby={description}
      onCancel={(event) => {
        event.preventDefault();
        if (!blocked) close?.();
      }}>
      <div className={'dialog-header' + (emblem ? ' hero-header' : '')}>
        {emblem ? <div className="guide-identity"><span className="hero-emblem" aria-hidden="true">F</span>{heading}</div> : heading}
        {close && <button type="button" id={closeId} className="icon-button close-button" aria-label={closeLabel}
          disabled={blocked} onClick={close}>×</button>}
      </div>
      {children}
    </dialog>
  );
}

function PathOptions({ paths, firstLabel }) {
  return <><option value="">{firstLabel}</option>{paths.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}</>;
}

function PathPreview({ path, count }) {
  if (!path) return <p>Explore freely through all {count} levels. You can pick a path later.</p>;
  const topics = path.topics || pathTopics.get(path.id);
  return (
    <>
      <p className="path-summary-heading"><strong>{path.name}</strong><span>{path.levels.length} levels</span></p>
      <p>{path.description}</p>
      {topics && <p><strong className="path-summary-label">What you’ll cover</strong> {topics}</p>}
    </>
  );
}

function BookLink({ page, actions, children, ...props }) {
  return (
    <a {...props} href={'#page=' + page} onClick={(event) => {
      if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      event.preventDefault();
      actions.closeDialog();
      actions.openPage(page);
    }}>{children}</a>
  );
}

function WorldPicker({ game, actions }) {
  return (
    <Modal id="world" title="Choose a world" caption="FERRUM EXPEDITIONS" className="hero-dialog world-dialog"
      emblem description="world-summary" closeLabel="Close world selection" closeId="close-worlds"
      close={game.world ? actions.closeDialog : undefined}>
      <div className="dialog-content hero-content">
        <p id="world-summary" className="muted">Choose a language to open its book, routes, and challenges. Each world keeps its own heroes and quest progress.</p>
        <div id="world-list" className="world-list">
          {game.worlds.map((world) => (
            <a className="world-card" key={world.id} data-world={world.id} href={'?world=' + encodeURIComponent(world.id)}
              aria-current={world.id === game.world?.id ? 'true' : undefined}>
              <span className="world-card-number">World {world.number}</span>
              <strong className="world-card-title">{world.name}</strong>
              <span className="world-card-copy">{world.subtitle}</span>
            </a>
          ))}
          {!game.worlds.length && <><p className="muted">The worlds could not be loaded.</p>
            <button type="button" className="button" onClick={() => location.reload()}>Retry loading worlds</button></>}
        </div>
      </div>
    </Modal>
  );
}

function HeroSlot({ slot, hero, paths, busy, load }) {
  const name = slot.name || 'Explorer';
  const active = slot.id === hero?.id;
  const pathLabel = paths.find(({ id }) => id === slot.path)?.name || 'Open expedition';
  const survival = slot.combat?.oneLife ? (slot.combat.fallen ? 'One Life · Fallen' : 'One Life') : '';
  const labels = ['Page ' + (pageNumber(slot.lastPage) || 1), pathLabel, survival, active && 'Current hero'];
  return (
    <button type="button" className="button hero-slot" data-hero-id={slot.id} disabled={busy || active} onClick={() => load(slot.id)}>
      <span className="profile-mark" aria-hidden="true">{[...name][0].toUpperCase()}</span>
      <span className="hero-slot-copy"><strong>{name}</strong><span className="hero-slot-meta">{labels.filter(Boolean).join(' · ')}</span></span>
    </button>
  );
}

function HeroPicker({ game, actions }) {
  const { hero, world, campaign } = game;
  const paths = campaign.paths ?? [];
  const [heroes, setHeroes] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [oneLife, setOneLife] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState({ copy: '', error: false });
  const nameInput = useRef(null);
  const { api } = actions;

  useEffect(() => {
    let current = true;
    api('/api/heroes').then(({ heroes }) => {
      if (!current) return;
      const slots = (heroes ?? []).filter(({ id }) => typeof id === 'string' && id);
      setHeroes(slots);
    }).catch((error) => {
      if (current) setLoadError(error.message);
    });
    return () => { current = false; };
  }, [api, retry, world.id]);

  useLayoutEffect(() => {
    if (heroes?.length === 0 && !busy) nameInput.current?.focus();
  }, [heroes, busy]);

  async function select(endpoint, body, preferredPage) {
    if (busy) return;
    setBusy(true);
    setFeedback({ copy: 'Opening your expedition…', error: false });
    try {
      await actions.selectHero(endpoint, body, preferredPage);
    } catch (error) {
      setFeedback({ copy: error.message, error: true });
    } finally {
      setBusy(false);
    }
  }

  function createHero(event) {
    event.preventDefault();
    if (!heroes && !loadError) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setFeedback({ copy: 'Enter a hero name.', error: true });
      nameInput.current?.focus();
      return;
    }
    const preferredPage = !hero && heroes?.length === 0 ? pageNumber(location.hash.match(/^#page=([0-9]+)$/)?.[1]) : null;
    void select('/api/heroes', { name: trimmed, path, oneLife }, preferredPage);
  }

  return (
    <Modal id="hero" title="Choose your hero" caption={'World ' + world.number + ' · ' + world.name} className="hero-dialog"
      emblem description="hero-summary" closeLabel="Close hero selection" closeId="close-heroes" blocked={busy}
      close={hero ? actions.closeDialog : undefined}>
      <div className="dialog-content hero-content">
        <p id="hero-summary" className="muted">Create a hero or return to a saved expedition. Each hero keeps their own page, answers, and quest log.</p>
        <div className="hero-columns">
          <section className="hero-section" aria-labelledby="hero-load-title">
            <h3 id="hero-load-title">Load a hero</h3>
            <div className="hero-list" id="hero-list" aria-live="polite">
              {loadError ? <><p className="muted">{loadError}</p><button type="button" className="button" onClick={() => {
                setLoadError('');
                setRetry((count) => count + 1);
              }}>Try again</button></> : !heroes ? <p className="muted">Loading saved heroes…</p> :
                !heroes.length ? <p className="muted">Your saved heroes will appear here.</p> : heroes.map((slot) =>
                  <HeroSlot key={slot.id} slot={slot} hero={hero} paths={paths} busy={busy} load={(id) => select('/api/heroes/load', { id })} />)}
            </div>
          </section>
          <form id="hero-form" className="hero-section" aria-labelledby="hero-create-title" onSubmit={createHero}>
            <h3 id="hero-create-title">Create a hero</h3>
            <label className="control-label" htmlFor="hero-name">Hero name<input ref={nameInput} id="hero-name" type="text"
              required maxLength={40} placeholder="Name your hero" autoComplete="off" value={name} disabled={busy}
              onChange={(event) => setName(event.target.value)} /></label>
            <label className="control-label" htmlFor="hero-path">Expedition path<select id="hero-path" aria-describedby="hero-path-description"
              value={path} disabled={busy} onChange={(event) => setPath(event.target.value)}><PathOptions paths={paths} firstLabel="Explore freely" /></select></label>
            <div id="hero-path-description" className="path-summary" aria-live="polite" aria-atomic="true">
              <PathPreview path={paths.find(({ id }) => id === path)} count={campaign.quests?.length ?? 0} />
            </div>
            <label className="one-life-option"><input id="hero-one-life" type="checkbox" aria-describedby="one-life-rules"
              checked={oneLife} disabled={busy} onChange={(event) => setOneLife(event.target.checked)} /> <span>One Life</span></label>
            <p id="one-life-rules" className="fine-print">Start with 100 HP and one potion. Failed combat submissions cost 5 HP. Written GM reviews are safe. At 0 HP your hero falls.</p>
            <button type="submit" className="button button-primary" id="create-hero" disabled={busy || (!heroes && !loadError)}>Create hero</button>
          </form>
        </div>
        <div className="hero-footer">
          <p className="inline-status" id="hero-feedback" role="status" data-error={feedback.error}>{feedback.copy}</p>
          <button className="button button-quiet" id="hero-worlds" type="button" disabled={busy} onClick={() => actions.openDialog('world')}>Change world</button>
          {hero && <button className="button button-quiet" id="edit-active-hero" type="button" disabled={busy}
            onClick={() => actions.openDialog('profile')}>Edit current hero</button>}
        </div>
      </div>
    </Modal>
  );
}

function HeroProfile({ game, actions }) {
  const [callsign, setCallsign] = useState(game.profile.callsign);
  const [path, setPath] = useState(game.profile.path);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState({ copy: '', error: false });
  const paths = game.campaign.paths ?? [];

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFeedback({ copy: 'Saving…', error: false });
    try {
      if (await actions.saveProfile(callsign.trim() || 'Explorer', path)) {
        actions.closeDialog();
        actions.toast('Explorer profile saved');
      }
    } catch (error) {
      setFeedback({ copy: error.message, error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal id="profile" title="Set your loadout" caption="EXPLORER PROFILE" className="profile-dialog"
      closeLabel="Close profile" close={actions.closeDialog} blocked={busy}>
      <form id="profile-form" className="dialog-content profile-form" onSubmit={submit}>
        <label className="control-label" htmlFor="callsign-input">Callsign<input id="callsign-input" type="text" maxLength={40}
          placeholder="Explorer" autoComplete="off" value={callsign} onChange={(event) => setCallsign(event.target.value)} /></label>
        <label className="control-label" htmlFor="path-input">Expedition path<select id="path-input" aria-describedby="profile-path-description"
          value={path} onChange={(event) => setPath(event.target.value)}><PathOptions paths={paths} firstLabel="Explore freely" /></select></label>
        <div id="profile-path-description" className="path-summary" aria-live="polite" aria-atomic="true">
          <PathPreview path={paths.find(({ id }) => id === path)} count={game.campaign.quests?.length ?? 0} />
        </div>
        <div className="profile-actions">
          <button type="submit" className="button button-primary" disabled={busy}>Save profile</button>
          <span id="profile-feedback" className="inline-status" data-error={feedback.error} aria-live="polite">{feedback.copy}</span>
        </div>
      </form>
    </Modal>
  );
}

function MapLevel({ campaign, quest, game, actions }) {
  const level = Number(quest.level);
  const page = questPage(campaign, quest, level);
  const record = game.levels.get(level);
  const checkpoints = [record?.scout, record?.forge, record?.explain];
  const completed = checkpoints.every(enabled);
  const started = checkpoints.some(enabled) || enabled(record?.side);
  const props = { className: 'map-level', 'aria-current': level === Number(game.page?.level) ? 'page' : undefined };
  const children = <><span className="map-number">{String(level).padStart(2, '0')}</span><span>{quest.mission_title}</span>
    <span className="map-page" data-complete={completed}>{completed ? 'Cleared' : started ? 'Started' : page ? 'p. ' + page : 'Unavailable'}</span></>;
  return page ? <BookLink {...props} page={page} actions={actions}>{children}</BookLink> : <div {...props}>{children}</div>;
}

function WorldMap({ game, actions }) {
  const { campaign, world, profile } = game;
  const [query, setQuery] = useState('');
  const [pathId, setPathId] = useState(profile.path);
  const [equipping, setEquipping] = useState(false);
  const paths = campaign.paths ?? [];
  const quests = campaign.quests ?? [];
  const path = paths.find(({ id }) => id === pathId);
  const specials = campaign.specialEncounters ?? [];
  const pathLevels = new Set(path?.levels.map(Number));
  const filter = query.trim().toLowerCase();
  const groups = zonesFor(campaign).map((zone, index) => ({ zone, index, candidates: quests.filter((quest) => {
    const level = Number(quest.level);
    const title = [level, String(level).padStart(2, '0'), 'level', level, quest.mission_title].join(' ').toLowerCase();
    return level >= zone.first && level <= zone.last && (!path || pathLevels.has(level)) && title.includes(filter);
  }) })).filter(({ candidates }) => candidates.length);

  async function equip() {
    setEquipping(true);
    try {
      if (await actions.saveProfile(profile.callsign, pathId)) actions.toast(path.name + ' equipped');
    } catch (error) {
      actions.toast(error.message);
    } finally {
      setEquipping(false);
    }
  }

  return (
    <Modal id="map" title="World map" caption={'World ' + world.number + ' · ' + world.name + ' · ' + quests.length + ' levels'} className="drawer"
      closeLabel="Close world map" close={actions.closeDialog}>
      <div className="dialog-content">
        <div className="map-controls">
          <label className="control-label" htmlFor="map-search">Find a level<input id="map-search" type="search" placeholder="Level number or title"
            autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <label className="control-label" htmlFor="map-path">Filter by path<select id="map-path" value={pathId}
            onChange={(event) => setPathId(event.target.value)}><PathOptions paths={paths} firstLabel="All paths" /></select></label>
        </div>
        <div className="map-downloads">
          <a id="download-book" href={world.bookUrl} download={'Ferrum-' + world.name + '.pdf'} className="button button-quiet">Download PDF</a>
          {world.kitUrl && <a id="download-kit" href={world.kitUrl} download={world.id === 'rust' ? 'Ferrum-Field-Kit.zip' : 'Ferrum-' + world.name + '-Field-Kit.zip'}
            className="button button-quiet">Download field kit</a>}
        </div>
        {!game.campaignError && <div id="map-description">
          {path && <div className="path-summary"><PathPreview path={path} count={quests.length} />
            <button type="button" className="button" disabled={equipping || profile.path === pathId} onClick={equip}>
              {profile.path === pathId ? 'Current path' : 'Choose this path'}
            </button></div>}
          {specials.length > 0 && <section className="special-map">
            <h3 className="zone-title">Special encounters</h3>
            {specials.map((special) => <div className="special-map-entry" key={special.id}>
              <BookLink page={special.page} actions={actions}>{special.title}</BookLink>
              <span className="fine-print">{special.kind === 'elite' ? 'Elite boss' : 'Bug Hunt'} · Level {special.level}</span>
            </div>)}
          </section>}
        </div>}
        <div id="map-levels" className="map-levels">
          {game.campaignError ? <p className="muted">The world map could not load. {game.campaignError}</p> : !groups.length ?
            <p className="muted">No levels match this search.</p> : groups.map(({ zone, index, candidates }) => <section className="map-zone" key={zone.name}>
              <h3 className="zone-title">Zone {index + 1} · {zone.name}</h3>
              {candidates.map((quest) => <MapLevel key={quest.level} campaign={campaign} quest={quest} game={game} actions={actions} />)}
            </section>)}
        </div>
      </div>
    </Modal>
  );
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function ProgressMeter({ value, total, label }) {
  return <progress className="sheet-meter" max={Math.max(1, total)} value={value} aria-label={label} />;
}

function QuestLog({ campaign, levels, hardClears, actions }) {
  const entries = [...levels.entries()].filter(([, record]) => marks.some(([field]) => enabled(record[field])))
    .sort(([left], [right]) => left - right);
  return <div className="log-list">
    {!entries.length && <p className="muted">Your level checkpoints will appear here.</p>}
    {entries.map(([level, record]) => {
      const quest = campaign.quests?.find((item) => Number(item.level) === level);
      const title = 'Level ' + level + ' · ' + (quest?.mission_title ?? '');
      const page = questPage(campaign, quest, level);
      return <div className="log-entry" key={level}>
        {page ? <BookLink page={page} actions={actions}>{title}</BookLink> : <p>{title}</p>}
        <div className="log-badges">
          {marks.filter(([field]) => enabled(record[field])).map(([field, label]) => <span key={field} className="badge" data-done="true">{label}</span>)}
          {hardClears.has(level) && <span className="badge" data-done="true">Hard Clear</span>}
        </div>
      </div>;
    })}
  </div>;
}

function RecentRuns({ exercises, attempts, world, actions }) {
  return <>
    <h3 className="log-content-heading">Recent {world.name} runs</h3>
    <div className="log-list">
      {!attempts.length && <p className="muted">No {world.name} test runs yet.</p>}
      {attempts.slice(0, 10).map((attempt, index) => {
        const exercise = exercises.find(({ id }) => String(id) === String(attempt.exerciseId));
        const page = pageNumber(attempt.page);
        return <div className="log-entry" key={attempt.id ?? index}>
          <strong>{exercise?.title || 'Level ' + attempt.level}</strong>
          <p className="fine-print">{[attempt.verdict, formatDate(attempt.createdAt)].filter(Boolean).join(' · ')}</p>
          {page && <BookLink page={page} actions={actions}>Return to page {page}</BookLink>}
        </div>;
      })}
    </div>
  </>;
}

function CharacterSheet({ game, actions }) {
  const { campaign, combat, world, profile, levels, attempts, hardClears } = game;
  const progress = characterProgress({ ...campaign, zones: zonesFor(campaign) }, levels, profile.path);
  const { heroLevel, heroLevelCap, xp, xpMax, nextLevelXp, counts, route, skills } = progress;
  const exercises = campaign.exercises ?? [];
  const stats = marks.map(([field, label]) => [counts[field], field === 'side' ? 'Side quests' : label]);
  if (hardClears.size) stats.push([hardClears.size, 'Hard Clears']);
  const xpDetail = nextLevelXp === null ? (xpMax ? 'Max hero level' : 'No checkpoints yet') :
    (nextLevelXp - xp) + ' XP to level ' + (heroLevel + 1);

  return (
    <Modal id="log" title="Character sheet" caption="EXPEDITION RECORD" className="drawer sheet-dialog"
      closeLabel="Close character sheet" close={actions.closeDialog}>
      <div id="log-content" className="dialog-content">
        <div className="sheet-hero">
          <div className="sheet-identity"><div className="sheet-name"><p className="eyebrow">{world.name}</p><h3>{profile.callsign}</h3>
            <p className="fine-print">{route?.name || 'Open expedition'}</p></div>
            <strong className="sheet-level">Hero level {heroLevel} / {heroLevelCap}</strong></div>
          <div className="sheet-line"><strong>{xp} / {xpMax} XP</strong><span className="fine-print">{xpDetail}</span></div>
          <ProgressMeter value={xp} total={xpMax} label="World experience" />
          <div className="sheet-milestones">
            <p>World: {progress.completed} of {progress.total} levels complete</p>
            <p id="diamond-total">Diamonds collected · {game.diamond?.diamonds ?? 0}</p>
            {combat && <p>Trials cleared · {combat.completedTrials.length}</p>}
            {combat?.oneLife && <p>One Life · {combat.hp} / {combat.maxHp} HP · {combat.potions} {combat.potions === 1 ? 'potion' : 'potions'}{combat.fallen ? ' · Fallen' : ''}</p>}
            {route && <p>Active path: {route.completed} of {route.total} levels complete</p>}
          </div>
        </div>
        {game.progressError && <p className="muted">{game.progressError}</p>}
        <div className="stat-grid">{stats.map(([count, label]) => <div className="stat-tile" key={label}><strong>{count}</strong><span>{label}</span></div>)}</div>
        <h3 className="log-content-heading">Skill levels</h3>
        <ul className="sheet-skills">{skills.map((skill) => <li className="sheet-skill" key={skill.name}>
          <div className="sheet-line"><strong>{skill.name}</strong><span className="sheet-rank">Level {skill.level} / {SKILL_LEVEL_CAP}</span></div>
          <ProgressMeter value={skill.earned} total={skill.total} label={skill.name + ' checkpoint marks'} />
          <p className="fine-print">{skill.earned} of {skill.total} marks</p>
        </li>)}</ul>
        <details className="sheet-rules"><summary>How progression works</summary>
          <p>Each Scout, Forge, or Explain mark gives 1 XP. Earn all three to complete a level. Hero levels track XP across this world, and each fifth of a skill’s marks raises that skill by one level. Side quests have their own tally. These levels reflect your in-game checkpoints.</p>
          {world.id === 'rust' && <p>The printable Rust quest journal uses its own tabletop XP rules.</p>}
        </details>
        <h3 className="log-content-heading">Quest log</h3>
        <QuestLog campaign={campaign} levels={levels} hardClears={hardClears} actions={actions} />
        {exercises.length > 0 && <RecentRuns exercises={exercises} attempts={attempts} world={world} actions={actions} />}
      </div>
    </Modal>
  );
}

function TrialForm({ trial, combat, actions }) {
  const [answers, setAnswers] = useState({});
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const cleared = combat?.completedTrials.includes(trial.id);
  const disabled = Boolean(busy || cleared || combat?.fallen);

  async function submit(event) {
    event.preventDefault();
    if (disabled) return;
    setBusy(true);
    setError('');
    setReport(null);
    try {
      setReport(await actions.submitExpedition('/api/trials/' + encodeURIComponent(trial.id), { body: { answers } }));
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }

  const status = error || (busy ? 'The GM is checking your trial…' : report ? report.passed + ' / ' + report.total + ' correct' : '');
  return (
    <form className="field-card trial-form" onSubmit={submit}>
      <h3>{trial.title}</h3><p className="muted">{trial.description}</p>
      <div className="trial-questions">
        {trial.questions.map((question) => <fieldset key={question.id} className="choice-group" disabled={disabled}>
          <legend>{question.text}</legend>
          {question.options.map((option) => <label className="choice-option trial-option" key={option.id}>
            <span>{option.text}</span><input type="radio" name={question.id} value={option.id} required checked={answers[question.id] === option.id}
              onChange={() => setAnswers((current) => ({ ...current, [question.id]: option.id }))} />
          </label>)}
        </fieldset>)}
      </div>
      <div className="form-actions">
        <button type="submit" className="button button-primary" disabled={disabled} data-expedition-submit="" data-trial-id={trial.id}>
          {cleared ? 'Trial cleared' : 'Submit trial'}
        </button>
        <p className="inline-status" role="status" data-error={Boolean(error || (report && !report.correct))}>{status}</p>
      </div>
      {report && <ol className="trial-feedback">{report.feedback.map((item, index) => <li key={index}>{item.correct ? 'Correct' : 'Review'} · {item.explanation}</li>)}</ol>}
    </form>
  );
}

function TrialBoard({ game, actions }) {
  const { hero, combat, combatNotice, potionBusy } = game;
  const [trials, setTrials] = useState(null);
  const [error, setError] = useState('');
  const { api } = actions;

  useEffect(() => {
    let current = true;
    api('/api/trials', { hero }).then(({ trials }) => {
      if (current) setTrials(trials);
    }).catch((error) => {
      if (current) setError(error.message);
    });
    return () => { current = false; };
  }, [api, hero]);

  const health = combat?.oneLife ? [
    combat.hp + ' / ' + combat.maxHp + ' HP',
    combat.potions + (combat.potions === 1 ? ' potion' : ' potions'),
    combatNotice,
    combat.fallen && 'Your hero has fallen. Choose another hero to keep submitting.',
  ].filter(Boolean).join(' · ') : '';
  return (
    <Modal id="trial" title="Trials" caption="FERRUM CHALLENGES" className="drawer" closeLabel="Close trials" close={actions.closeDialog}>
      <div className="dialog-content">
        {combat?.oneLife && <div className="trial-survival" id="trial-survival">
          <p id="trial-health" role="status">{health}</p>
          <button type="button" id="trial-potion" className="button button-quiet" title="Restore up to 20 HP"
            disabled={potionBusy || combat.fallen || !combat.potions || combat.hp === combat.maxHp} onClick={actions.drinkPotion}>Drink potion</button>
        </div>}
        <p className="trial-rules muted" id="trial-rules">{combat?.oneLife ? 'Answer every question correctly to earn a healing potion on your first clear.' : 'Answer every question correctly to clear a trial.'}</p>
        <div className="trial-content" id="trial-content">
          {error ? <p className="muted">{error}</p> : !trials ? <p className="muted">Opening the trial board…</p> : !trials.length ?
            <p className="muted">This world has no trials yet.</p> : trials.map((trial) => <TrialForm key={trial.id} trial={trial} combat={combat} actions={actions} />)}
        </div>
      </div>
    </Modal>
  );
}

export function Dialogs({ game, actions }) {
  if (game.dialog === 'world') return <WorldPicker game={game} actions={actions} />;
  if (game.dialog === 'hero' && game.world) return <HeroPicker game={game} actions={actions} />;
  if (!game.hero) return null;
  switch (game.dialog) {
    case 'map': return <WorldMap game={game} actions={actions} />;
    case 'profile': return <HeroProfile game={game} actions={actions} />;
    case 'log': return <CharacterSheet game={game} actions={actions} />;
    case 'trial': return <TrialBoard game={game} actions={actions} />;
    default: return null;
  }
}
