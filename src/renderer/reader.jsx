import React from 'react';

function CampaignHeader() {
  return (
    <header className="app-header">
      <div className="identity">
        <span className="brand-icon" aria-hidden="true">
          <svg viewBox="0 0 40 40" fill="none" width="40" height="40">
            <path d="M20 3 35 11.5v17L20 37 5 28.5v-17L20 3Z" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M12 13h16l-4 4h-8v3.5h8l-4 4h-4v5l-4-2.3V13Z" fill="currentColor"/>
          </svg>
        </span>
        <div>
          <p className="brand-word">FERRUM</p>
          <p className="brand-caption" id="world-caption">Campaign worlds</p>
        </div>
      </div>
      <nav className="app-nav" aria-label="Campaign">
        <button className="nav-button" id="open-worlds" type="button">Worlds</button>
        <button className="nav-button" id="open-map" type="button">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15" strokeLinejoin="round"/></svg>
          <span>World map</span>
        </button>
        <button className="nav-button" id="open-trials" type="button" aria-haspopup="dialog">Trials</button>
        <button className="nav-button" id="open-log" type="button">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v16H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm-2 15a2 2 0 0 1 2-2h13M8 7h7m-7 4h7" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <span>Character sheet</span>
        </button>
        <button className="nav-button" id="open-heroes" type="button"><span>Switch hero</span></button>
        <button className="profile-button" id="open-profile" type="button" aria-label="Edit explorer profile">
          <span className="profile-mark" aria-hidden="true">F</span>
          <span id="header-callsign">Explorer</span>
        </button>
      </nav>
    </header>
  );
}

function BookReader() {
  return (
    <section className="reader-panel" aria-label="Book reader">
      <div className="reader-toolbar">
        <div className="reader-caption">
          <span className="eyebrow">CAMPAIGN BOOK</span>
          <span className="reader-location" id="reader-location">Opening the archive</span>
        </div>
        <div className="reader-controls">
          <button id="previous-page" className="icon-button" type="button" aria-label="Previous page" disabled>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m14 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <form className="jump-form" id="page-jump">
            <label className="visually-hidden" htmlFor="page-number">Page number. Press Enter to open.</label>
            <input id="page-number" type="number" inputMode="numeric" min="1" step="1" defaultValue="1" required />
            <span id="page-total">/ …</span>
          </form>
          <button id="next-page" className="icon-button" type="button" aria-label="Next page" disabled>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m10 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <span className="toolbar-divider" aria-hidden="true"></span>
          <button id="zoom-out" className="icon-button" type="button" aria-label="Zoom out">−</button>
          <button id="zoom-fit" className="fit-button" type="button" aria-label="Reset to fit width">Fit</button>
          <button id="zoom-in" className="icon-button" type="button" aria-label="Zoom in">+</button>
        </div>
        <div className="keyboard-tip" aria-label="A and D, or left and right arrows, turn pages">
          <kbd>A</kbd><kbd>D</kbd><span>or</span><kbd>←</kbd><kbd>→</kbd><span>turn pages</span>
        </div>
      </div>
      <div className="reader-viewport" id="reader-viewport" tabIndex="0" aria-label="Book page view">
        <div className="reader-placeholder" id="reader-placeholder" aria-live="polite">
          <span className="loading-mark" aria-hidden="true"></span>
          <p>Opening the campaign book…</p>
        </div>
        <div className="page-frame" id="page-frame" hidden>
          <img id="book-page" alt="" decoding="async" />
          <div className="page-hotspots" id="page-hotspots" aria-label="Links on this book page"></div>
        </div>
      </div>
    </section>
  );
}

function GameMaster() {
  return (
    <section className="guide-panel" id="guide-panel" aria-labelledby="guide-title">
      <header className="guide-header">
        <div className="guide-identity">
          <span className="guide-icon" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="25" height="25" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M16 3v5m0 16v5M3 16h5m16 0h5M7 7l3.5 3.5m11 11L25 25M7 25l3.5-3.5m11-11L25 7" strokeLinecap="round"/><path d="m16 9 7 7-7 7-7-7 7-7Z" strokeLinejoin="round"/><circle cx="16" cy="16" r="2" fill="currentColor" stroke="none"/></svg>
          </span>
          <div>
            <p className="eyebrow">FERRUM GAME MASTER</p>
            <h1 id="guide-title">Your expedition</h1>
          </div>
        </div>
    <span id="runner-status" className="status-pill" title="Practice status"><span className="status-light" aria-hidden="true"></span><span>Choose a world</span></span>
      </header>
      <section className="combat-status" id="combat-status" aria-label="One Life status" hidden>
        <div className="combat-health">
          <p className="eyebrow">ONE LIFE</p>
          <strong id="combat-hp"></strong>
          <progress id="combat-meter" className="combat-meter" aria-label="Hero health"></progress>
        </div>
        <div className="combat-inventory">
          <span id="combat-potions"></span>
          <button type="button" id="drink-potion" className="button button-quiet" title="Restore up to 20 HP">Drink potion</button>
        </div>
        <p id="combat-feedback" className="fine-print" role="status" hidden></p>
      </section>
      <div className="guide-scroll" id="guide-scroll">
        <div id="guide-content" className="guide-content" aria-busy="true">
          <p className="muted">The field guide will follow your book page.</p>
        </div>
      </div>
    </section>
  );
}

function WorldMap() {
  return (
    <dialog className="drawer" id="map-dialog" aria-labelledby="map-title">
      <div className="dialog-header">
        <div><p className="eyebrow" id="map-caption">CAMPAIGN LEVELS</p><h2 id="map-title">World map</h2></div>
        <button type="button" className="icon-button close-button" data-close-dialog aria-label="Close world map">×</button>
      </div>
      <div className="dialog-content">
        <div className="map-controls">
          <label className="control-label" htmlFor="map-search">Find a level<input id="map-search" type="search" placeholder="Level number or title" autoComplete="off" /></label>
          <label className="control-label" htmlFor="map-path">Filter by path<select id="map-path"><option value="">All paths</option></select></label>
        </div>
        <div className="map-downloads">
          <a id="download-book" href="/book/ferrum-expedition.pdf" download="Ferrum-Expedition.pdf" className="button button-quiet">Download PDF</a>
          <a id="download-kit" href="/book/ferrum-field-kit.zip" download="Ferrum-Field-Kit.zip" className="button button-quiet">Download field kit</a>
        </div>
        <div id="map-description"></div>
        <div id="map-levels" className="map-levels"></div>
      </div>
    </dialog>
  );
}

function TrialBoard() {
  return (
    <dialog className="drawer" id="trial-dialog" aria-labelledby="trial-title">
      <div className="dialog-header">
        <div><p className="eyebrow">FERRUM CHALLENGES</p><h2 id="trial-title">Trials</h2></div>
        <button type="button" className="icon-button close-button" data-close-dialog aria-label="Close trials">×</button>
      </div>
      <div className="dialog-content">
        <div className="trial-survival" id="trial-survival" hidden>
          <p id="trial-health" role="status"></p>
          <button type="button" id="trial-potion" className="button button-quiet" title="Restore up to 20 HP">Drink potion</button>
        </div>
        <p className="trial-rules muted" id="trial-rules"></p>
        <div className="trial-content" id="trial-content"></div>
      </div>
    </dialog>
  );
}

function CharacterSheet() {
  return (
    <dialog className="drawer sheet-dialog" id="log-dialog" aria-labelledby="log-title">
      <div className="dialog-header">
        <div><p className="eyebrow">EXPEDITION RECORD</p><h2 id="log-title">Character sheet</h2></div>
        <button type="button" className="icon-button close-button" data-close-dialog aria-label="Close character sheet">×</button>
      </div>
      <div id="log-content" className="dialog-content"></div>
    </dialog>
  );
}

function HeroProfile() {
  return (
    <dialog className="profile-dialog" id="profile-dialog" aria-labelledby="profile-title">
      <div className="dialog-header">
        <div><p className="eyebrow">EXPLORER PROFILE</p><h2 id="profile-title">Set your loadout</h2></div>
        <button type="button" className="icon-button close-button" data-close-dialog aria-label="Close profile">×</button>
      </div>
      <form id="profile-form" className="dialog-content profile-form">
        <label className="control-label" htmlFor="callsign-input">Callsign<input id="callsign-input" type="text" maxLength="40" placeholder="Explorer" autoComplete="off" /></label>
        <label className="control-label" htmlFor="path-input">Expedition path<select id="path-input" aria-describedby="profile-path-description"><option value="">Explore freely</option></select></label>
        <div id="profile-path-description" className="path-summary" aria-live="polite" aria-atomic="true"></div>
        <div className="profile-actions"><button type="submit" className="button button-primary">Save profile</button><span id="profile-feedback" className="inline-status" aria-live="polite"></span></div>
      </form>
    </dialog>
  );
}

function WorldPicker() {
  return (
    <dialog className="hero-dialog world-dialog" id="world-dialog" aria-labelledby="world-title" aria-describedby="world-summary">
      <div className="dialog-header hero-header">
        <div className="guide-identity">
          <span className="hero-emblem" aria-hidden="true">F</span>
          <div><p className="eyebrow">FERRUM EXPEDITIONS</p><h2 id="world-title">Choose a world</h2></div>
        </div>
        <button type="button" id="close-worlds" className="icon-button close-button" data-close-dialog aria-label="Close world selection" hidden>×</button>
      </div>
      <div className="dialog-content hero-content">
        <p id="world-summary" className="muted">Choose a language to open its book, routes, and challenges. Each world keeps its own heroes and quest progress.</p>
        <div className="world-list" id="world-list"></div>
      </div>
    </dialog>
  );
}

function HeroPicker() {
  return (
    <dialog className="hero-dialog" id="hero-dialog" aria-labelledby="hero-title" aria-describedby="hero-summary">
      <div className="dialog-header hero-header">
        <div className="guide-identity">
          <span className="hero-emblem" aria-hidden="true">F</span>
          <div><p className="eyebrow" id="hero-world-caption">FERRUM SAVE SLOTS</p><h2 id="hero-title">Choose your hero</h2></div>
        </div>
        <button type="button" id="close-heroes" className="icon-button close-button" data-close-dialog aria-label="Close hero selection" hidden>×</button>
      </div>
      <div className="dialog-content hero-content">
        <p id="hero-summary" className="muted">Create a hero or return to a saved expedition. Each hero keeps their own page, answers, and quest log.</p>
        <div className="hero-columns">
          <section className="hero-section" aria-labelledby="hero-load-title">
            <h3 id="hero-load-title">Load a hero</h3>
            <div className="hero-list" id="hero-list" aria-live="polite"></div>
          </section>
          <form id="hero-form" className="hero-section" aria-labelledby="hero-create-title">
            <h3 id="hero-create-title">Create a hero</h3>
            <label className="control-label" htmlFor="hero-name">Hero name<input id="hero-name" type="text" required maxLength="40" placeholder="Name your hero" autoComplete="off" /></label>
            <label className="control-label" htmlFor="hero-path">Expedition path<select id="hero-path" aria-describedby="hero-path-description"><option value="">Explore freely</option></select></label>
            <div id="hero-path-description" className="path-summary" aria-live="polite" aria-atomic="true"></div>
            <label className="one-life-option"><input id="hero-one-life" type="checkbox" aria-describedby="one-life-rules" /> <span>One Life</span></label>
            <p id="one-life-rules" className="fine-print">Start with 100 HP and one potion. A wrong graded submission costs 5 HP. At 0 HP your hero falls.</p>
            <button type="submit" className="button button-primary" id="create-hero">Create hero</button>
          </form>
        </div>
        <div className="hero-footer">
          <p className="inline-status" id="hero-feedback" role="status" aria-live="polite"></p>
          <button className="button button-quiet" id="hero-worlds" type="button">Change world</button>
          <button className="button button-quiet" id="edit-active-hero" type="button" hidden>Edit current hero</button>
        </div>
      </div>
    </dialog>
  );
}

export function CampaignReader() {
  return (
    <>
      <a className="skip-link" href="#guide-panel">Skip to the field guide</a>
      <CampaignHeader />
      <main className="workspace">
        <BookReader />
        <GameMaster />
      </main>
      <WorldMap />
      <TrialBoard />
      <CharacterSheet />
      <HeroProfile />
      <WorldPicker />
      <HeroPicker />
      <div id="toast" className="toast" role="status" aria-live="polite" hidden />
    </>
  );
}
