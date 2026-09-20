#!/usr/bin/env node
/*
 * The Godfather Organic Farm — site builder.
 *
 * Renders index.html from content/*.json. No dependencies, no npm install:
 *
 *     node build.mjs
 *
 * Everything a person would normally want to change — copy, photos, crops,
 * phone numbers — lives in content/. This file holds the page structure and
 * the handful of inline SVGs, and should rarely need touching.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
/* GF_NO_MINIFY=1 emits the page and assets unminified, for debugging
   and for diffing against a minified build. */
const MINIFY = process.env.GF_NO_MINIFY !== '1';
const load = f => JSON.parse(readFileSync(join(root, f), 'utf8'));

const S = load('content/site.json');
const { photos } = load('content/photos.json');
const { crops } = load('content/crops.json');

/* ---- helpers --------------------------------------------------------- */

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* A bilingual pair. The page ships both and hides one via html[lang]. */
const P = (o, tag = 'span', attrs = '') => {
  const a = attrs ? ' ' + attrs : '';
  return `<${tag} data-lang="en"${a}>${esc(o.en)}</${tag}>` +
         `<${tag} data-lang="ar" lang="ar"${a}>${esc(o.ar)}</${tag}>`;
};

/* Same, but only one language has text (the verse gloss). */
const only = (o, lang, tag = 'span', attrs = '') => {
  if (!o || !o[lang]) return '';
  const a = attrs ? ' ' + attrs : '';
  const l = lang === 'ar' ? ` lang="ar"` : '';
  return `<${tag} data-lang="${lang}"${l}${a}>${esc(o[lang])}</${tag}>`;
};

const byPlace = place => photos.filter(p => p.place === place);
const firstAt = place => byPlace(place)[0];

function img(p, { cls = '', eager = false } = {}) {
  const a = [];
  if (cls) a.push(`class="${cls}"`);
  a.push(`src="assets/photos/${p.file}"`);
  a.push(`alt="${esc(p.alt)}"`);
  a.push(`width="${p.width}"`, `height="${p.height}"`);
  if (p.objectPosition) a.push(`style="object-position:${esc(p.objectPosition)}"`);
  if (p.gallery !== false) a.push('data-gal', `data-tile="${esc(p.tile || 'wide')}"`);
  if (eager) a.push('fetchpriority="high"', 'decoding="async"');
  else a.push('loading="lazy"', 'decoding="async"');
  return `<img ${a.join(' ')}>`;
}

const caption = p => p.caption ? `<figcaption>${P(p.caption)}</figcaption>` : '';
const figure = (p, opts) => `<figure>\n        ${img(p, opts)}\n        ${caption(p)}\n      </figure>`;

const { lat, lon } = S.business.coords;
const mapsUrl = `https://www.google.com/maps/search/?api=1&amp;query=${lat},${lon}`;
const waUrl = `https://wa.me/${S.business.whatsapp.number}` +
              `?text=${encodeURIComponent(S.business.whatsapp.prefill)}`;
const siteUrl = S.site.url.replace(/\/?$/, '/');

/* ---- minifiers -------------------------------------------------------
 * Deliberately conservative. These make the delivered files smaller and
 * tedious to read; they are not a security measure, and the readable
 * sources still live in this repository.
 */

/* Whitespace only matters between two structural characters, so this only
   strips it next to { } ; : , and >. Every line break in site.css follows
   one of those, which is what makes this safe. */
function minifyCss(css) {
  let out = '', i = 0, quote = null;
  const structural = /[{};:,>]/;
  while (i < css.length) {
    const ch = css[i];
    if (quote) {
      out += ch;
      if (ch === '\\') out += css[++i] || '';
      else if (ch === quote) quote = null;
      i++; continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; out += ch; i++; continue; }
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? css.length : end + 2;
      continue;
    }
    if (/\s/.test(ch)) {
      let j = i;
      while (j < css.length && /\s/.test(css[j])) j++;
      const prev = out[out.length - 1], next = css[j];
      if (prev && next && !structural.test(prev) && !structural.test(next)) out += ' ';
      i = j; continue;
    }
    out += ch; i++;
  }
  return out.replace(/;}/g, '}').trim();
}

/* Line-based, so automatic semicolon insertion cannot change meaning:
   newlines are kept, only indentation, blank lines and whole-line comments
   go. Refuses to touch a file containing a backtick, since a template
   literal could carry significant leading whitespace across lines. */
function minifyJs(js) {
  if (js.indexOf('`') !== -1) return js;
  const lines = js.split('\n');
  const out = [];
  let inBlock = false;
  for (let line of lines) {
    let t = line.trim();
    if (inBlock) {
      const end = t.indexOf('*/');
      if (end === -1) continue;
      inBlock = false;
      t = t.slice(end + 2).trim();
      if (!t) continue;
    }
    if (t.startsWith('/*')) {
      const end = t.indexOf('*/');
      if (end === -1) { inBlock = true; continue; }
      t = t.slice(end + 2).trim();
      if (!t) continue;
    }
    if (!t || t.startsWith('//')) continue;
    out.push(t);
  }
  return out.join('\n');
}

/* HTML collapses any whitespace run to a single space when it renders, so
   replacing each run that spans a line with one space is exactly equivalent
   — and removes every scrap of indentation. Script and style bodies are
   left alone. There is no <pre> or <textarea> on the page to protect. */
function minifyHtml(html) {
  const parts = html.split(/(<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>)/i);
  return parts.map((part, i) => {
    if (i % 2) return part;                      // untouched script/style block
    return part
      .replace(/<!--(?!\[if)[\s\S]*?-->/g, '')  // drop comments
      .replace(/\s*\n\s*/g, ' ');               // indentation -> single space
  }).join('').trim();
}

/* ---- inline SVG (structure, not content) ------------------------------ */

const SEAL_SVG = `<svg class="mark-seal" width="42" height="42" viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r="30" fill="none" stroke="var(--gold)" stroke-width="2.4"/>
        <circle cx="32" cy="32" r="25.6" fill="none" stroke="var(--gold)" stroke-width=".9"/>
        <g fill="currentColor">
          <path d="M32 14.8c2.7 0 4.8 2.1 4.8 4.8 0 1.5-.7 2.8-1.8 3.7l.6 1.4h-7.2l.6-1.4c-1.1-.9-1.8-2.2-1.8-3.7 0-2.7 2.1-4.8 4.8-4.8z"/>
          <path d="M29 24.4h6l1.2 8.8c.2 1.6-.7 2.8-2 3.1h-4.4c-1.3-.3-2.2-1.5-2-3.1z"/>
          <path d="M29.9 35.6h4.2l1.5 10.6-1.7-1.5-1.9 2.9-1.9-2.9-1.7 1.5z"/>
          <g id="gf-wing"><path d="M34.8 25.4C41.5 21.8 49.6 17.6 56.2 14.4C57.2 14.2 57.6 14.6 57 15L57 15Q56.4 17.4 54.2 18.3Q53.5 20.7 51.2 21.5Q50.5 23.9 48.2 24.7Q47.4 27.1 45 27.8Q44.2 30 41.9 30.5Q40.9 32.6 38.6 32.9Q37.6 34.8 35.4 34.8Z"/></g>
          <use href="#gf-wing" transform="translate(64,0) scale(-1,1)"/>
        </g>
        <g stroke="var(--leaf)" stroke-width="1.1" fill="none" stroke-linecap="round">
          <path d="M32 50.4c-4.4-.5-7.9-2.8-9.9-6.4"/><path d="M32 50.4c4.4-.5 7.9-2.8 9.9-6.4"/>
        </g>
        <g fill="var(--leaf)">
          <ellipse cx="24.2" cy="43.2" rx="1.9" ry="1" transform="rotate(-40 24.2 43.2)"/>
          <ellipse cx="26.8" cy="46.8" rx="1.9" ry="1" transform="rotate(-22 26.8 46.8)"/>
          <ellipse cx="30.2" cy="49.4" rx="1.9" ry="1" transform="rotate(-8 30.2 49.4)"/>
          <ellipse cx="39.8" cy="43.2" rx="1.9" ry="1" transform="rotate(40 39.8 43.2)"/>
          <ellipse cx="37.2" cy="46.8" rx="1.9" ry="1" transform="rotate(22 37.2 46.8)"/>
          <ellipse cx="33.8" cy="49.4" rx="1.9" ry="1" transform="rotate(8 33.8 49.4)"/>
        </g>
      </svg>`;

const HERO_RIDGE = `<svg class="hero-art" viewBox="0 0 1200 220" preserveAspectRatio="none" aria-hidden="true">
    <path d="M0 130 L130 80 L220 118 L340 56 L440 110 L550 74 L670 126 L800 80 L910 120 L1020 92 L1130 132 L1200 106 L1200 220 L0 220Z" fill="var(--ridge-far)"/>
    <path d="M0 164 L150 120 L270 156 L390 108 L510 152 L630 118 L770 162 L890 124 L1010 160 L1130 132 L1200 164 L1200 220 L0 220Z" fill="var(--ridge-mid)"/>
    <path d="M0 198 L170 174 L330 196 L490 170 L650 198 L830 174 L990 198 L1150 180 L1200 194 L1200 220 L0 220Z" fill="var(--ridge-near)"/>
  </svg>`;

const POEM_RIDGE = `<svg class="poem-ridge" viewBox="0 0 1200 230" preserveAspectRatio="none" aria-hidden="true">
    <path d="M0 150 L130 96 L220 134 L340 68 L440 126 L550 86 L670 142 L800 92 L910 136 L1020 104 L1130 148 L1200 120 L1200 230 L0 230Z" fill="#3A2A20"/>
    <path d="M0 180 L150 134 L270 172 L390 120 L510 168 L630 130 L770 178 L890 138 L1010 176 L1130 146 L1200 180 L1200 230 L0 230Z" fill="#241A13"/>
    <path d="M0 210 L170 186 L330 208 L490 182 L650 210 L830 186 L990 210 L1150 192 L1200 206 L1200 230 L0 230Z" fill="#120C09"/>
  </svg>`;

const WA_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5.1-1.3A10 10 0 1 0 12 2zm5.6 14.2c-.2.7-1.3 1.3-1.9 1.4-.5.1-1.1.1-1.8-.1-.4-.1-1-.3-1.7-.6-3-1.3-4.9-4.3-5.1-4.5-.1-.2-1.2-1.5-1.2-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.3 0 .5l-.4.5-.3.3c-.1.1-.2.3 0 .5.1.2.6 1 1.3 1.6.9.8 1.6 1 1.9 1.2.2.1.4.1.5-.1l.7-.9c.2-.2.3-.2.5-.1l2 1c.2.1.4.2.4.3.1.1.1.6-.1 1.3z"/></svg>`;

/* ---- sections --------------------------------------------------------- */

const navLinks = (mobile) => S.nav
  .filter(n => mobile || n.desktop !== false)
  .map(n => {
    const l = (mobile && n.mobileLabel) ? n.mobileLabel : n.label;
    return `    <a href="${n.href}">${P(l)}</a>`;
  }).join('\n');

const header = `<header>
  <div class="wrap bar">
    <a class="mark" href="#top">
      ${SEAL_SVG}
      <span class="mark-name">
        ${P(S.business.name, 'b')}
        ${P(S.business.place, 'small')}
      </span>
    </a>
    <nav>
${navLinks(false)}
    </nav>
    <button class="langtoggle" id="langBtn" type="button" aria-label="${esc(S.a11y.langSwitch)}">عربي</button>
    <button class="menubtn" id="menuBtn" type="button" aria-expanded="false" aria-controls="mobnav" aria-label="${esc(S.a11y.menu)}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
    </button>
  </div>
  <div class="wrap"><nav class="mobnav" id="mobnav">
${navLinks(true)}
  </nav></div>
</header>`;

const sealPhoto = firstAt('hero-seal');
const hero = `<div class="hero" id="top">
  <div class="wrap hero-in">
    <div>
      <div class="kicker">${P(S.hero.kicker)}</div>
      ${P(S.hero.headline, 'h1')}
      <div class="arname ar" data-lang="en">${esc(S.hero.crossName.en)}</div>
      <div class="arname" data-lang="ar" style="direction:ltr">${esc(S.hero.crossName.ar)}</div>
      ${P(S.hero.lede, 'p', 'class="lede"')}
      <div class="where"><i></i>
        ${P(S.hero.where)}
      </div>
      <div class="season" id="season" hidden>
        ${P(S.hero.seasonLabel, 'span', 'class="lbl"')}
        <span id="seasonChips"></span>
      </div>
    </div>
    <div class="seal">${img(sealPhoto, { eager: true })}</div>
  </div>
  ${HERO_RIDGE}
</div>`;

const sign = `<div class="sign">
  <div class="wrap sign-in">
    <div>${P(S.sign.promise, 'b')}</div>
    <div>${P(S.sign.hours)}</div>
    <div><a href="tel:${esc(S.business.phone)}">${esc(S.business.phoneDisplay)}</a></div>
  </div>
</div>`;

const storyPair = byPlace('story-pair')
  .map(p => '      ' + figure(p)).join('\n');

const story = `<section id="story">
  <div class="wrap">
    <div class="sec-head">
      ${P(S.story.heading, 'h2')}
      ${P(S.story.intro, 'p')}
    </div>
    <div class="story">
      ${figure(firstAt('story-lead'))}
      <div>
        <div data-lang="en">
${S.story.body.en.map(t => `          <p>${esc(t)}</p>`).join('\n')}
        </div>
        <div data-lang="ar" lang="ar">
${S.story.body.ar.map(t => `          <p>${esc(t)}</p>`).join('\n')}
        </div>
      </div>
    </div>
    <div class="pair">
${storyPair}
    </div>
  </div>
</section>`;

const verseLines = S.verse.lines.map((l, i) => {
  const rest = i === S.verse.breakBefore ? ' rest' : '';
  return `      <span class="poem-line${rest}" style="--i:${i}">${esc(l)}</span>`;
}).join('\n');

const verse = `<section class="poem" id="verse" aria-label="${esc(S.a11y.verseSection)}">
  <div class="poem-glow" aria-hidden="true"></div>
  ${POEM_RIDGE}
  <div class="wrap poem-in">
    <p class="poem-kicker">${P(S.verse.kicker)}</p>
    <blockquote class="poem-verse">
${verseLines}
    </blockquote>
    ${only(S.verse.gloss, 'en', 'p', `class="poem-gloss" style="--i:${S.verse.lines.length}"`)}
  </div>
</section>`;

const growGrid = byPlace('grow-grid')
  .map(p => `      <figure>${img(p)}${caption(p)}</figure>`).join('\n');

const grow = `<section class="alt" id="grow">
  <div class="wrap">
    <div class="sec-head">
      ${P(S.grow.heading, 'h2')}
      ${P(S.grow.intro, 'p')}
    </div>
    <div class="cal">
      <div class="cal-key">
        <div class="clabel">${P(S.grow.cropColumn)}</div>
        <div class="mrow" data-lang="en"><span>J</span><span>F</span><span>M</span><span>A</span><span>M</span><span>J</span><span>J</span><span>A</span><span>S</span><span>O</span><span>N</span><span>D</span></div>
        <div class="mrow" data-lang="ar"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span><span>8</span><span>9</span><span>10</span><span>11</span><span>12</span></div>
      </div>
      <div id="calRows"></div>
    </div>
    <div class="gallery">
${growGrid}
    </div>
  </div>
</section>`;

const bandPhoto = firstAt('band');
const bandFigure = `<figure class="band">
  ${img(bandPhoto)}
  ${caption(bandPhoto)}
</figure>`;
/* Full-bleed is opt-in per photo; by default the band sits in the same
   1060px column as every other picture on the page. */
const band = bandPhoto.fullBleed ? bandFigure : `<div class="wrap band-wrap">${bandFigure}</div>`;

const gallery = `<section id="gallery" class="gal-wrap">
  <div class="wrap">
    <div class="sec-head">
      ${P(S.gallery.heading, 'h2')}
      ${P(S.gallery.intro, 'p')}
    </div>
    <div class="mosaic" id="mosaic"></div>
    <p class="gal-hint">
      ${P(S.gallery.hint)}
    </p>
  </div>
</section>`;

const lightbox = `<div class="lb" id="lb" role="dialog" aria-modal="true" aria-label="${esc(S.a11y.viewer)}">
  <div class="lb-top">
    <span id="lbCount"></span>
    <button class="lb-btn" id="lbClose" type="button" aria-label="${esc(S.a11y.close)}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>
  </div>
  <div class="lb-stage">
    <button class="lb-btn lb-nav lb-prev" id="lbPrev" type="button" aria-label="${esc(S.a11y.prev)}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
    </button>
    <img id="lbImg" alt="">
    <button class="lb-btn lb-nav lb-next" id="lbNext" type="button" aria-label="${esc(S.a11y.next)}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
    </button>
  </div>
  <p class="lb-cap" id="lbCap"></p>
</div>`;

const steps = S.how.steps.map(s => `      <div class="step">
        <div>
          ${P(s.title, 'h3')}
          ${P(s.body, 'p')}
        </div>
      </div>`).join('\n');

const how = `<section id="how">
  <div class="wrap">
    <div class="sec-head">
      ${P(S.how.heading, 'h2')}
      ${P(S.how.intro, 'p')}
    </div>
    <div class="steps">
${steps}
    </div>
  </div>
</section>`;

const facts = S.buy.facts.map(f => {
  let value = P(f.value, 'span', f.numeric ? 'class="num"' : '');
  if (f.numeric) {
    /* only the Arabic run needs the LTR isolate */
    value = `<span data-lang="en">${esc(f.value.en)}</span>` +
            `<span class="num" data-lang="ar" lang="ar">${esc(f.value.ar)}</span>`;
  }
  if (f.link === 'maps') {
    value = `<a href="${mapsUrl}" target="_blank" rel="noopener">${P(f.value)}</a>`;
  }
  return `        <li><span>${P(f.label)}</span><span>${value}</span></li>`;
}).join('\n');

const buyPhoto = firstAt('buy');
const buy = `<section class="alt" id="buy">
  <div class="wrap buy">
    <div>
      <div class="sec-head" style="margin-bottom:1.4rem">
        ${P(S.buy.heading, 'h2')}
        ${P(S.buy.intro, 'p')}
      </div>
      <ul class="facts">
${facts}
      </ul>
      <div class="btnrow">
        <a class="cta wa" href="${esc(waUrl)}" target="_blank" rel="noopener">
          ${WA_ICON}
          ${P(S.buy.buttons.whatsapp)}</a>
        <a class="cta" href="tel:${esc(S.business.phone)}">${P(S.buy.buttons.call)}</a>
        <a class="cta alt-btn" href="${mapsUrl}" target="_blank" rel="noopener">${P(S.buy.buttons.directions)}</a>
      </div>
      <div class="card">
        ${P(S.buy.card.heading, 'h3')}
        ${P(S.buy.card.body, 'p')}
        <p class="ar" data-lang="en" style="margin-top:.8rem">${esc(S.buy.card.crossTagline.en)}</p>
        <p data-lang="ar" style="margin-top:.8rem;direction:ltr">${esc(S.buy.card.crossTagline.ar)}</p>
      </div>
    </div>
    ${figure(buyPhoto)}
  </div>
</section>`;

const blessing = `<section id="blessing">
  <div class="wrap">
    <div class="sec-head">
      ${P(S.blessing.heading, 'h2')}
      ${P(S.blessing.intro, 'p')}
    </div>
    <div class="cert" id="cert">
      <div class="cert-form">
        <label class="cert-field">
          ${P(S.blessing.field)}
          <input id="certName" type="text" maxlength="40" autocomplete="organization"
                 placeholder="${esc(S.blessing.placeholder)}" spellcheck="false">
        </label>
        <div class="cert-actions">
          <button class="btn" id="certAction" type="button" hidden>
            <span class="act" data-act="share">${P(S.blessing.share)}</span>
            <span class="act" data-act="download" hidden>${P(S.blessing.download)}</span>
          </button>
          <p class="cert-nudge" id="certNudge" hidden>${P(S.blessing.nudge)}</p>
          <p class="cert-saved" id="certSaved" role="status" aria-live="polite" hidden>${P(S.blessing.saved)}</p>
        </div>
        ${P(S.blessing.note, 'p', 'class="cert-note"')}
      </div>
      <figure class="cert-stage" id="certStage" hidden>
        <canvas id="certCanvas" width="1200" height="1200" role="img"
                aria-label="${esc(S.a11y.certificate)}"></canvas>
      </figure>
    </div>
  </div>
</section>`;

const footer = `<footer>
  <div class="wrap foot">
    <div>© <span id="yr">${new Date().getFullYear()}</span>
      ${P(S.footer.line)}
    </div>
    <div><span data-lang="en">${esc(S.footer.credit.en)} <b>${esc(S.footer.creditName.en)}</b></span><span data-lang="ar" lang="ar">${esc(S.footer.credit.ar)} <b>${esc(S.footer.creditName.ar)}</b></span></div>
  </div>
</footer>`;

/* ---- data handed to the browser -------------------------------------- */

const runtime = {
  crops,
  certificate: S.blessing.certificate,
  seasonChipLimit: 6,
};
const runtimeJson = JSON.stringify(runtime).replace(/</g, '\\u003c');

/* ---- schema.org ------------------------------------------------------- */

const schema = {
  '@context': 'https://schema.org',
  '@type': ['LocalBusiness', 'Farm'],
  name: S.business.name.en,
  alternateName: S.business.name.ar,
  description: S.meta.schemaDescription,
  url: siteUrl,
  image: siteUrl + S.site.ogImage,
  telephone: S.business.phone,
  priceRange: '$',
  address: {
    '@type': 'PostalAddress',
    streetAddress: S.business.address.street,
    addressLocality: S.business.address.locality,
    addressRegion: S.business.address.region,
    postalCode: S.business.address.postalCode,
    addressCountry: S.business.address.country,
  },
  geo: { '@type': 'GeoCoordinates', latitude: lat, longitude: lon },
  openingHoursSpecification: {
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'],
    opens: '00:00', closes: '23:59',
  },
  founder: { '@type': 'Person', name: S.business.founder },
  knowsLanguage: ['ar', 'en'],
  makesOffer: S.offers.map(n => ({
    '@type': 'Offer', itemOffered: { '@type': 'Product', name: n },
  })),
};

/* ---- the page --------------------------------------------------------- */

/* Runs before first paint so an Arabic visitor never sees a flash of the
   English page. Everything else about language lives in assets/app.js. */
const LANG_BOOT = `(function(){var l=${JSON.stringify(S.site.defaultLang)};try{
var s=localStorage.getItem('gf-lang');
if(s==='ar'||s==='en'){l=s}
else{var n=(navigator.languages&&navigator.languages[0])||navigator.language||'';
if(/^ar(-|$)/i.test(n)){l='ar'}}}catch(e){}
var d=document.documentElement;d.lang=l;d.dir=l==='ar'?'rtl':'ltr';d.classList.add('js');})();`;

const html = `<!DOCTYPE html>
<html lang="${esc(S.site.defaultLang)}" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script>${MINIFY ? minifyJs(LANG_BOOT) : LANG_BOOT}</script>
<meta name="description" content="${esc(S.meta.description)}">
<meta name="robots" content="index,follow">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(S.meta.title)}">
<meta property="og:description" content="${esc(S.meta.ogDescription)}">
<meta property="og:url" content="${esc(siteUrl)}">
<meta property="og:image" content="${esc(siteUrl + S.site.ogImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(S.meta.ogImageAlt)}">
<meta property="og:locale" content="en_US">
<meta property="og:locale:alternate" content="ar_EG">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(S.meta.title)}">
<meta name="twitter:description" content="${esc(S.meta.twitterDescription)}">
<meta name="twitter:image" content="${esc(siteUrl + S.site.ogImage)}">
<meta name="theme-color" content="#F5F0E8" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#16120F" media="(prefers-color-scheme: dark)">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="assets/apple-touch-icon.png">
<link rel="canonical" href="${esc(siteUrl)}">
<title>${esc(S.meta.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800&family=IBM+Plex+Sans+Arabic:wght@300;400;500;600&family=Noto+Kufi+Arabic:wght@500;700&display=swap" rel="stylesheet">
<link rel="preload" as="image" href="assets/photos/${sealPhoto.file}">
<link rel="stylesheet" href="assets/site.min.css">
</head>
<body>

${header}

${hero}

${sign}

${story}

${verse}

${grow}

${band}

${gallery}

${lightbox}

${how}

${buy}

${blessing}

${footer}

<script type="application/json" id="gf-data">${runtimeJson}</script>
<script src="assets/app.min.js" defer></script>

<script type="application/ld+json">
${JSON.stringify(schema)}
</script>
</body>
</html>
`;

const css = readFileSync(join(root, 'assets/site.css'), 'utf8');
const js = readFileSync(join(root, 'assets/app.js'), 'utf8');
const cssMin = MINIFY ? minifyCss(css) : css;
const jsMin = MINIFY ? minifyJs(js) : js;
const htmlMin = MINIFY ? minifyHtml(html) : html;

writeFileSync(join(root, 'assets/site.min.css'), cssMin + '\n');
writeFileSync(join(root, 'assets/app.min.js'), jsMin + '\n');
writeFileSync(join(root, 'index.html'), htmlMin + '\n');

/* ---- report ----------------------------------------------------------- */

const missing = photos.filter(p => !existsSync(join(root, 'assets/photos', p.file)));
if (missing.length) {
  console.error('MISSING photo files:\n' + missing.map(p => '  assets/photos/' + p.file).join('\n'));
  process.exitCode = 1;
}
const inGallery = photos.filter(p => p.gallery !== false).length;
const kb = n => (n / 1024).toFixed(1) + ' KB';
const saved = (a, b) => `${kb(a)} -> ${kb(b)}  (-${Math.round((1 - b / a) * 100)}%)`;
console.log(`index.html     ${saved(html.length, htmlMin.length)}`);
console.log(`site.min.css   ${saved(css.length, cssMin.length)}`);
console.log(`app.min.js     ${saved(js.length, jsMin.length)}`);
console.log(`photos      ${photos.length} (${inGallery} in the mosaic)`);
console.log(`crops       ${crops.length}`);
