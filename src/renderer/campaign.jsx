import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createGame } from './game.mjs';
import { Dialogs } from './dialogs.jsx';
import { Guide } from './guide.jsx';
import { DiamondEncounter, DiamondGem, SpecialEncounter, diamondPosition } from './encounters.jsx';

const model = createGame();
const { actions } = model;

function CampaignHeader({ game }) {
  const { world, profile } = game;
  return (
    <header className="app-header">
      <div className="identity">
        <span className="brand-icon" aria-hidden="true">
          <svg viewBox="0 0 40 40" fill="none" width="40" height="40">
            <path d="M20 3 35 11.5v17L20 37 5 28.5v-17L20 3Z" stroke="currentColor" strokeWidth="1.5" />
            <path d="M12 13h16l-4 4h-8v3.5h8l-4 4h-4v5l-4-2.3V13Z" fill="currentColor" />
          </svg>
        </span>
        <div>
          <p className="brand-word">FERRUM</p>
          <p className="brand-caption" id="world-caption">{world ? `World ${world.number} · ${world.name}` : 'Campaign worlds'}</p>
        </div>
      </div>
      <nav className="app-nav" aria-label="Campaign">
        <button className="nav-button" id="open-worlds" type="button" onClick={() => actions.openDialog('world')}>Worlds</button>
        <button className="nav-button" id="open-map" type="button" onClick={() => actions.openDialog('map')}>
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15" strokeLinejoin="round" /></svg>
          <span>World map</span>
        </button>
        <button className="nav-button" id="open-trials" type="button" aria-haspopup="dialog" onClick={() => actions.openDialog('trial')}>Trials</button>
        <button className="nav-button" id="open-log" type="button" onClick={() => actions.openDialog('log')}>
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v16H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm-2 15a2 2 0 0 1 2-2h13M8 7h7m-7 4h7" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>Character sheet</span>
        </button>
        <button className="nav-button" id="open-heroes" type="button" onClick={() => actions.openDialog('hero')}>Switch hero</button>
        <button className="profile-button" id="open-profile" type="button" aria-label="Edit explorer profile"
          title={`Edit ${profile.callsign}`} onClick={() => actions.openDialog('profile')}>
          <span className="profile-mark" aria-hidden="true">F</span><span id="header-callsign">{profile.callsign}</span>
        </button>
      </nav>
    </header>
  );
}

function pageImage(world, data) {
  const prefix = world.id === 'rust' ? '/book/pages/' : `/book/${world.id}/pages/`;
  try {
    const url = new URL(data.image, location.origin);
    if (url.origin === location.origin && url.pathname.startsWith(prefix)) return url.href;
  } catch {
    // Use the standard book asset when metadata omits its URL.
  }
  return `${prefix}${data.page}.webp`;
}

function hotspotProps(link, total) {
  const [x, y, width, height] = [link.x, link.y, link.w, link.h].map(Number);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0 || x >= 100 || y >= 100) return null;
  const left = Math.max(0, x);
  const top = Math.max(0, y);
  const style = {
    left: `${left}%`, top: `${top}%`,
    width: `${Math.min(width, 100 - left)}%`, height: `${Math.min(height, 100 - top)}%`,
  };
  const page = Number(link.page);
  if (Number.isSafeInteger(page) && page >= 1 && page <= total) {
    return { style, href: `#page=${page}`, 'aria-label': link.title || `Open book page ${page}` };
  }
  try {
    const url = new URL(link.url);
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    return { style, href: url.href, target: '_blank', rel: 'noopener noreferrer',
      'aria-label': link.title || `Open ${url.hostname} in a new tab` };
  } catch {
    return null;
  }
}

function BookPage({ game, width }) {
  const { world, page, total, diamond, zoom } = game;
  const [imageState, setImageState] = useState('loading');
  const bookName = world.id === 'rust' ? 'Ferrum campaign book' : `${world.name} campaign book`;
  const sparkle = game.combat?.fallen ? null : diamond?.sparkle;
  const position = Number.isFinite(sparkle?.x) && Number.isFinite(sparkle?.y)
    ? diamondPosition(sparkle, page.links ?? []) : null;
  return (
    <>
      <div className="reader-placeholder" id="reader-placeholder" aria-live="polite" hidden={imageState === 'ready'}>
        {imageState === 'loading' && <span className="loading-mark" aria-hidden="true" />}
        {imageState === 'error' ? (
          <><p>The image for page {page.page} could not be loaded.</p>
            <button className="button" type="button" onClick={() => actions.loadPage(page.page)}>Try again</button></>
        ) : <p>Opening page {page.page}…</p>}
      </div>
      <div className="page-frame" id="page-frame" hidden={imageState !== 'ready'} style={{ width: Math.round(width * zoom) }}>
        <img id="book-page" decoding="async" src={pageImage(world, page)}
          alt={`${bookName}, page ${page.page}${page.title ? ` · ${page.title}` : ''}`}
          onLoad={() => setImageState('ready')} onError={() => setImageState('error')} />
        <div className="page-hotspots" id="page-hotspots" aria-label="Interactions on this book page">
          {(page.links ?? []).map((link, index) => {
            const props = hotspotProps(link, total);
            return props && <a key={index} className="page-hotspot" {...props} />;
          })}
          {position && <DiamondGem position={position} onClick={actions.startDiamond} disabled={game.diamondStarting} />}
        </div>
      </div>
    </>
  );
}

function BookReader({ game }) {
  const { page, total, hero, zoom, loading, pageError } = game;
  const [number, setNumber] = useState(1);
  const [width, setWidth] = useState(720);
  const viewport = useRef(null);
  const focusedHero = useRef(null);
  const pageValue = page?.page ?? 1;
  const quest = game.campaign.quests?.find((entry) => Number(entry.level) === Number(page?.level));
  const zone = game.campaign.zones?.find((entry) => Number(page?.level) >= entry.first && Number(page?.level) <= entry.last);
  const caption = quest && zone ? `${zone.name} · Level ${quest.level}`
    : page?.title || (page ? `Page ${pageValue}` : 'Opening the archive');
  useLayoutEffect(() => {
    setNumber(pageValue);
  }, [pageValue, hero]);
  useLayoutEffect(() => {
    const node = viewport.current;
    const resize = () => {
      const style = getComputedStyle(node);
      const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      setWidth(Math.max(120, Math.min(720, node.clientWidth - padding)));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!page) return;
    viewport.current.scrollTo(0, 0);
    if (matchMedia('(max-width: 800px)').matches) window.scrollTo(0, 0);
  }, [page]);
  useLayoutEffect(() => {
    if (hero && hero !== focusedHero.current && game.ready && !game.dialog && !game.switchingHero) {
      focusedHero.current = hero;
      viewport.current.focus({ preventScroll: true });
    }
  }, [hero, game.ready, game.dialog, game.switchingHero]);

  return (
    <section className="reader-panel" aria-label="Book reader">
      <div className="reader-toolbar">
        <div className="reader-caption">
          <span className="eyebrow">CAMPAIGN BOOK</span>
          <span className="reader-location" id="reader-location">{caption}</span>
        </div>
        <div className="reader-controls">
          <button id="previous-page" className="icon-button" type="button" aria-label="Previous page"
            disabled={loading || !page || pageValue <= 1} onClick={() => actions.openPage(pageValue - 1)}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m14 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <form className="jump-form" id="page-jump" onSubmit={(event) => { event.preventDefault(); actions.openPage(number); }}>
            <label className="visually-hidden" htmlFor="page-number">Page number. Press Enter to open.</label>
            <input id="page-number" type="number" inputMode="numeric" min="1" max={total ?? undefined} step="1"
              value={number} onChange={(event) => setNumber(event.target.value)} required disabled={!hero} />
            <span id="page-total">{total ? `/ ${total}` : '/ …'}</span>
          </form>
          <button id="next-page" className="icon-button" type="button" aria-label="Next page"
            disabled={loading || !page || pageValue >= total} onClick={() => actions.openPage(pageValue + 1)}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m10 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <span className="toolbar-divider" aria-hidden="true" />
          <button id="zoom-out" className="icon-button" type="button" aria-label="Zoom out" disabled={zoom <= .65} onClick={() => actions.changeZoom(zoom - .15)}>−</button>
          <button id="zoom-fit" className="fit-button" type="button" aria-label="Reset to fit width" onClick={() => actions.changeZoom(1)}>{zoom === 1 ? 'Fit' : `${Math.round(zoom * 100)}%`}</button>
          <button id="zoom-in" className="icon-button" type="button" aria-label="Zoom in" disabled={zoom >= 1.85} onClick={() => actions.changeZoom(zoom + .15)}>+</button>
        </div>
        <div className="keyboard-tip" aria-label="A and D, or left and right arrows, turn pages">
          <kbd>A</kbd><kbd>D</kbd><span>or</span><kbd>←</kbd><kbd>→</kbd><span>turn pages</span>
        </div>
      </div>
      <div ref={viewport} className="reader-viewport" id="reader-viewport" tabIndex={0} aria-label="Book page view">
        {page && !loading && !pageError ? <BookPage key={pageValue} game={game} width={width} /> : (
          <div className="reader-placeholder" id="reader-placeholder" aria-live="polite">
            {loading && <span className="loading-mark" aria-hidden="true" />}
            <p>{game.readerMessage}</p>
            {pageError && <button className="button" type="button" onClick={() => actions.loadPage(pageError)}>Try again</button>}
          </div>
        )}
      </div>
    </section>
  );
}

function CombatStatus({ game }) {
  const { combat, combatNotice, potionBusy } = game;
  if (!combat?.oneLife) return null;
  const feedback = [combatNotice, combat.fallen && 'Your hero has fallen. Choose another hero to keep submitting.'].filter(Boolean).join(' · ');
  return (
    <section className="combat-status" id="combat-status" aria-label="One Life status" data-fallen={combat.fallen}>
      <div className="combat-health">
        <p className="eyebrow">ONE LIFE</p>
        <strong id="combat-hp">{combat.hp} / {combat.maxHp} HP</strong>
        <progress id="combat-meter" className="combat-meter" aria-label="Hero health" max={combat.maxHp} value={combat.hp} />
      </div>
      <div className="combat-inventory">
        <span id="combat-potions">{combat.potions} {combat.potions === 1 ? 'potion' : 'potions'}</span>
        <button type="button" id="drink-potion" className="button button-quiet" title="Restore up to 20 HP"
          disabled={potionBusy || combat.fallen || !combat.potions || combat.hp === combat.maxHp} onClick={actions.drinkPotion}>Drink potion</button>
      </div>
      <p id="combat-feedback" className="fine-print" role="status" hidden={!feedback}>{feedback}</p>
    </section>
  );
}

function GameMaster({ game }) {
  const { world, campaign, runner, storage, page, hero, profile } = game;
  const ready = runner.toLowerCase() === 'available';
  const guided = world && world.id !== 'rust' && !campaign.exercises?.length;
  const runnerLabel = !world ? 'Choose a world' : guided ? 'Guided practice'
    : ready ? `${world.name} runner ready` : runner ? `${world.name} runner offline` : 'Runner status unknown';
  const runnerTitle = guided ? 'Save your code and check it against the encounter debrief'
    : [storage, runner && `${world?.name} runner ${runner}`].filter(Boolean).join(' · ') || 'Practice status';
  const title = page?.title || (hero ? profile.callsign : 'Your expedition');
  return (
    <section className="guide-panel" id="guide-panel" aria-labelledby="guide-title" tabIndex={-1}>
      <header className="guide-header">
        <div className="guide-identity">
          <span className="guide-icon" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="25" height="25" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M16 3v5m0 16v5M3 16h5m16 0h5M7 7l3.5 3.5m11 11L25 25M7 25l3.5-3.5m11-11L25 7Z" strokeLinecap="round" /><circle cx="16" cy="16" r="2" stroke="none" fill="currentColor" /></svg>
          </span>
          <div><p className="eyebrow">FERRUM GAME MASTER</p><h1 id="guide-title">{title}</h1></div>
        </div>
        <span id="runner-status" className="status-pill" title={runnerTitle}
          data-state={ready || guided ? 'ready' : runner ? 'limited' : 'unknown'}><span className="status-light" aria-hidden="true" /><span>{runnerLabel}</span></span>
      </header>
      <CombatStatus game={game} />
      <Guide game={game} actions={actions} SpecialEncounter={SpecialEncounter} DiamondEncounter={DiamondEncounter} />
    </section>
  );
}

export function CampaignReader() {
  const game = useSyncExternalStore(model.subscribe, model.getSnapshot);
  useEffect(() => {
    void actions.boot();
    window.addEventListener('hashchange', actions.readHash);
    function turnPage(event) {
      const { page, loading, switchingHero, dialog, total } = model.getSnapshot();
      if (!page || loading || switchingHero || dialog || event.defaultPrevented || event.isComposing || event.keyCode === 229
        || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.target.isContentEditable
        || event.target.closest?.('input, textarea, select, [role=textbox], [role=combobox], [role=radio], [role=slider]')) return;
      const key = !event.code || event.code === 'Unidentified' ? event.key.toLowerCase() : '';
      const direction = event.key === 'ArrowLeft' || event.code === 'KeyA' || key === 'a' ? -1
        : event.key === 'ArrowRight' || event.code === 'KeyD' || key === 'd' ? 1 : 0;
      const destination = page.page + direction;
      if (!direction || destination < 1 || destination > total) return;
      event.preventDefault();
      actions.openPage(destination);
    }
    document.addEventListener('keydown', turnPage);
    return () => {
      window.removeEventListener('hashchange', actions.readHash);
      document.removeEventListener('keydown', turnPage);
    };
  }, []);
  useEffect(() => {
    if (!game.world) return;
    document.title = `Ferrum | World ${game.world.number} · ${game.world.name}`;
    document.body.dataset.world = game.world.id;
  }, [game.world]);

  return (
    <>
      <a className="skip-link" href="#guide-panel">Skip to the field guide</a>
      <CampaignHeader game={game} />
      <main className="workspace"><BookReader game={game} /><GameMaster game={game} /></main>
      <Dialogs game={game} actions={actions} />
      <div id="toast" className="toast" role="status" aria-live="polite" hidden={!game.toast}>{game.toast}</div>
    </>
  );
}
