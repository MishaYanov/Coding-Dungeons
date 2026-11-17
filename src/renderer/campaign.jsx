import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createGame } from './game.mjs';
import { Dialogs } from './dialogs.jsx';
import { Guide } from './guide.jsx';
import { DiamondEncounter, DiamondGem, SpecialEncounter, diamondPosition } from './encounters.jsx';

const model = createGame();
const { actions } = model;
const mobile = import.meta.env.MODE === 'mobile';
const phoneLayout = '(max-width: 800px)';

function subscribeToPhoneLayout(notify) {
  const query = window.matchMedia(phoneLayout);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
}

function CampaignActions({ profile, merchant, onSelect, compact }) {
  return <>
    <button className="nav-button" id="open-worlds" type="button" onClick={() => onSelect('world')}>
      {compact ? 'Change world' : 'Worlds'}
    </button>
    <button className="nav-button" id="open-map" type="button" onClick={() => onSelect('map')}>
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15" strokeLinejoin="round" /></svg>
      <span>World map</span>
    </button>
    <button className="nav-button" id="open-trials" type="button" aria-haspopup="dialog" onClick={() => onSelect('trial')}>Trials</button>
    <button className="nav-button" id="open-merchant" type="button" aria-haspopup="dialog" onClick={() => onSelect('merchant')}>Merchant</button>
    <button className="nav-button" id="open-log" type="button" onClick={() => onSelect('log')}>
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v16H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm-2 15a2 2 0 0 1 2-2h13M8 7h7m-7 4h7" strokeLinecap="round" strokeLinejoin="round" /></svg>
      <span>Character sheet</span>
    </button>
    <button className="nav-button" id="open-heroes" type="button" onClick={() => onSelect('hero')}>Switch hero</button>
    <button className={compact ? 'nav-button' : 'profile-button'} id="open-profile" type="button"
      aria-label="Edit explorer profile" title={compact ? undefined : `Edit ${profile.callsign}`} onClick={() => onSelect('profile')}>
      {compact ? 'Edit profile' : <>
        <span className="profile-mark" data-hero-skin={merchant?.equipped.skin || undefined} aria-hidden="true">F</span>
        <span id="header-callsign">{profile.callsign}{merchant?.equipped.title === 'gemkeeper' && ' · Gemkeeper'}</span>
      </>}
    </button>
  </>;
}

function CampaignHeader({ game, compact, tabs, mobileControls: MobileControls, onZoom }) {
  const { world, profile } = game;
  const [open, setOpen] = useState(false);
  const drawer = useRef(null);

  function closeDrawer() {
    drawer.current?.close();
    setOpen(false);
  }

  useEffect(() => {
    if (!compact) setOpen(false);
    else if (game.dialog && drawer.current?.open) closeDrawer();
  }, [compact, game.dialog]);

  function selectDialog(name) {
    closeDrawer();
    actions.openDialog(name);
  }

  return (
    <header className={compact ? 'app-header compact-header' : 'app-header'}>
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
      {compact ? <nav className="compact-nav" aria-label="Campaign">
        {tabs}
          <button className="nav-button options-trigger" type="button" aria-label="More options" aria-haspopup="dialog"
            aria-expanded={open} aria-controls="campaign-options" onClick={(event) => {
              event.currentTarget.focus({preventScroll:true});
              drawer.current.showModal();
              setOpen(true);
            }}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
              <circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" />
            </svg>
          </button>
          <dialog ref={drawer} id="campaign-options" className="drawer campaign-drawer"
            aria-labelledby="campaign-options-title" onCancel={(event) => {
              event.preventDefault();
              closeDrawer();
            }}>
            <header className="dialog-header">
              <h2 id="campaign-options-title">Campaign menu</h2>
              <button type="button" className="icon-button close-button" aria-label="Close campaign menu"
                onClick={closeDrawer}>×</button>
            </header>
            <div className="dialog-content campaign-drawer-content">
              <CampaignActions profile={profile} merchant={game.merchant} onSelect={selectDialog} compact />
              {game.hero && <ZoomControls zoom={game.zoom} onZoom={(zoom) => {
                closeDrawer();
                onZoom(zoom);
              }} />}
              {MobileControls && game.hero && <MobileControls game={game} actions={actions} />}
            </div>
          </dialog>
      </nav> : <nav className="app-nav" aria-label="Campaign">
        <CampaignActions profile={profile} merchant={game.merchant} onSelect={actions.openDialog} />
      </nav>}
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

function BookPage({ game, width, onDiamond }) {
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
          {position && <DiamondGem position={position} onClick={onDiamond} disabled={game.diamondStarting} />}
        </div>
      </div>
    </>
  );
}

function PageControls({ game, compact }) {
  const { page, total, hero, loading } = game;
  const [number, setNumber] = useState(1);
  const pageValue = page?.page ?? 1;
  useLayoutEffect(() => {
    setNumber(pageValue);
  }, [pageValue, hero]);

  return <>
    <button id="previous-page" className="icon-button" type="button" aria-label="Previous page"
      disabled={loading || !page || pageValue <= 1} onClick={() => actions.openPage(pageValue - 1)}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m14 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    <form className="jump-form" id="page-jump" onSubmit={(event) => { event.preventDefault(); actions.openPage(number); }}>
      <label className={compact ? undefined : 'visually-hidden'} htmlFor="page-number">
        {compact ? 'Page' : 'Page number. Press Enter to open.'}
      </label>
      <input id="page-number" type="number" inputMode="numeric" min="1" max={total ?? undefined} step="1"
        value={number} onChange={(event) => setNumber(event.target.value)} required disabled={!hero} />
      <span id="page-total">{total ? `/ ${total}` : '/ …'}</span>
      {compact && <button type="submit" className="button button-quiet" disabled={!hero}>Go</button>}
    </form>
    <button id="next-page" className="icon-button" type="button" aria-label="Next page"
      disabled={loading || !page || pageValue >= total} onClick={() => actions.openPage(pageValue + 1)}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m10 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  </>;
}

function ZoomControls({zoom, onZoom = actions.changeZoom}) {
  return <div className="zoom-controls" role="group" aria-label="Book zoom">
    <button id="zoom-out" className="icon-button" type="button" aria-label="Zoom out" disabled={zoom <= .65} onClick={() => onZoom(zoom - .15)}>−</button>
    <button id="zoom-fit" className="fit-button" type="button" aria-label="Reset to fit width" onClick={() => onZoom(1)}>{zoom === 1 ? 'Fit' : `${Math.round(zoom * 100)}%`}</button>
    <button id="zoom-in" className="icon-button" type="button" aria-label="Zoom in" disabled={zoom >= 1.85} onClick={() => onZoom(zoom + .15)}>+</button>
  </div>;
}

function BookReader({ game, compact, hidden, onDiamond }) {
  const { page, hero, zoom, loading, pageError } = game;
  const [width, setWidth] = useState(720);
  const viewport = useRef(null);
  const focusedHero = useRef(null);
  const pageValue = page?.page ?? 1;
  const quest = game.campaign.quests?.find((entry) => Number(entry.level) === Number(page?.level));
  const zone = game.campaign.zones?.find((entry) => Number(page?.level) >= entry.first && Number(page?.level) <= entry.last);
  const caption = quest && zone ? `${zone.name} · Level ${quest.level}`
    : page?.title || (page ? `Page ${pageValue}` : 'Opening the archive');
  useLayoutEffect(() => {
    const node = viewport.current;
    const resize = () => {
      if (!node.clientWidth) return;
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
    if (compact) window.scrollTo(0, 0);
  }, [page, compact]);
  useLayoutEffect(() => {
    if (!hidden && hero && hero !== focusedHero.current && game.ready && !game.dialog && !game.switchingHero) {
      focusedHero.current = hero;
      viewport.current.focus({ preventScroll: true });
    }
  }, [hidden, hero, game.ready, game.dialog, game.switchingHero]);

  return (
    <section className="reader-panel" id={compact ? 'book-panel' : undefined} hidden={hidden}
      role={compact ? 'tabpanel' : undefined} aria-labelledby={compact ? 'mobile-book-tab' : undefined}
      aria-label={compact ? undefined : 'Book reader'}>
      {!compact && <div className="reader-toolbar">
        <div className="reader-caption">
          <span className="eyebrow">CAMPAIGN BOOK</span>
          <span className="reader-location" id="reader-location">{caption}</span>
        </div>
        <div className="reader-controls">
          <PageControls game={game} /><span className="toolbar-divider" aria-hidden="true" />
          <ZoomControls zoom={zoom} />
        </div>
        <div className="keyboard-tip" aria-label="A and D, or left and right arrows, turn pages">
          <kbd>A</kbd><kbd>D</kbd><span>or</span><kbd>←</kbd><kbd>→</kbd><span>turn pages</span>
        </div>
      </div>}
      <div ref={viewport} className="reader-viewport" id="reader-viewport" tabIndex={0} aria-label="Book page view">
        {page && !loading && !pageError ? <BookPage key={pageValue} game={game} width={width} onDiamond={onDiamond} /> : (
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

function GameMaster({ game, compact, hidden, panelRef }) {
  const { world, campaign, runner, runnerDetail, storage, page, hero, profile } = game;
  const ready = runner.toLowerCase() === 'available';
  const guided = world && world.id !== 'rust' && !campaign.exercises?.length;
  const unavailable = mobile ? `${world?.name} runner unavailable on mobile` : `${world?.name} runner offline`;
  const runnerLabel = !world ? 'Choose a world' : guided ? 'Guided practice'
    : ready ? `${world.name} runner ready` : runner ? unavailable : 'Runner status unknown';
  const runnerTitle = guided ? (world.id === 'csharp'
    ? 'Save your code here and run the field-kit files with the .NET 10 SDK'
    : 'Save your code and check it against the encounter debrief')
    : [storage, runnerDetail || (runner && `${world?.name} runner ${runner}`)].filter(Boolean).join(' · ') || 'Practice status';
  const title = page?.title || (hero ? profile.callsign : 'Your expedition');
  return (
    <section className="guide-panel" id="guide-panel" ref={panelRef} hidden={hidden}
      role={compact ? 'tabpanel' : undefined} aria-labelledby={compact ? 'mobile-gm-tab' : 'guide-title'} tabIndex={-1}>
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

export function CampaignReader({ mobileControls: MobileControls }) {
  const game = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const compact = useSyncExternalStore(subscribeToPhoneLayout, () => window.matchMedia(phoneLayout).matches);
  const [panel, setPanel] = useState('book');
  const bookTab = useRef(null);
  const gmTab = useRef(null);
  const guidePanel = useRef(null);
  const focusGuide = useRef(false);
  useLayoutEffect(() => {
    if (panel === 'gm' && focusGuide.current) {
      focusGuide.current = false;
      guidePanel.current?.focus({ preventScroll: true });
    }
  }, [panel]);

  function showPanel(next) {
    setPanel(next);
    if (next !== panel) window.scrollTo(0, 0);
  }

  function changeTabWithKey(event) {
    const next = event.key === 'Home' ? 'book' : event.key === 'End' ? 'gm'
      : event.key === 'ArrowRight' || event.key === 'ArrowLeft' ? panel === 'book' ? 'gm' : 'book' : null;
    if (!next) return;
    event.preventDefault();
    showPanel(next);
    (next === 'book' ? bookTab : gmTab).current.focus();
  }

  function openDiamond() {
    if (compact) showPanel('gm');
    void actions.startDiamond();
  }
  useEffect(() => {
    void actions.boot();
    window.addEventListener('hashchange', actions.readHash);
    function turnPage(event) {
      const { page, loading, switchingHero, dialog, total } = model.getSnapshot();
      if (!page || loading || switchingHero || dialog || event.defaultPrevented || event.isComposing || event.keyCode === 229
        || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.target.isContentEditable
        || document.querySelector('.campaign-drawer[open]')
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
    <div className={[mobile && 'mobile-app', compact && 'compact-layout'].filter(Boolean).join(' ') || undefined}>
      <a className="skip-link" href="#guide-panel" onClick={compact ? (event) => {
        event.preventDefault();
        if (panel === 'gm') guidePanel.current?.focus();
        else {
          focusGuide.current = true;
          showPanel('gm');
        }
      } : undefined}>Skip to the field guide</a>
      <CampaignHeader game={game} compact={compact} mobileControls={mobile ? MobileControls : undefined}
        onZoom={(zoom) => { showPanel('book'); actions.changeZoom(zoom); }}
        tabs={<div className="mobile-tabs" role="tablist" aria-label="Reader panels" onKeyDown={changeTabWithKey}>
          <button type="button" id="mobile-book-tab" ref={bookTab} role="tab" aria-controls="book-panel"
            aria-selected={panel === 'book'} tabIndex={panel === 'book' ? 0 : -1} onClick={() => showPanel('book')}>World</button>
          <button type="button" id="mobile-gm-tab" ref={gmTab} role="tab" aria-controls="guide-panel"
            aria-selected={panel === 'gm'} tabIndex={panel === 'gm' ? 0 : -1} onClick={() => showPanel('gm')}>GM</button>
        </div>} />
      {mobile && !compact && MobileControls && game.hero && <MobileControls game={game} actions={actions} />}
      <main className="workspace">
        <BookReader game={game} compact={compact} hidden={compact && panel !== 'book'} onDiamond={openDiamond} />
        <GameMaster game={game} compact={compact} hidden={compact && panel !== 'gm'} panelRef={guidePanel} />
      </main>
      {compact && game.hero && <nav className="mobile-page-controls" aria-label="Book pages"><PageControls game={game} compact /></nav>}
      <Dialogs game={game} actions={actions} mobileControls={mobile ? MobileControls : undefined} />
      <div id="toast" className="toast" role="status" aria-live="polite" hidden={!game.toast}>{game.toast}</div>
    </div>
  );
}
