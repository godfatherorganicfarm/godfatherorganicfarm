(function(){
  /* Crop table, certificate wording and the rest of the runtime copy are
     rendered into the page by build.mjs from content/*.json. */
  var S_SIDE = 1200;
  var DATA = {};
  try {
    DATA = JSON.parse(document.getElementById('gf-data').textContent);
  } catch (e) {}
  var crops = DATA.crops || [];

  var yr = document.getElementById('yr');
  if (yr) yr.textContent = new Date().getFullYear();

  /* ---------- season calendar ---------- */
  var now = new Date().getMonth();
  document.getElementById('calRows').innerHTML = crops.map(function(c){
    var cells = c.months.map(function(v,i){
      return '<div class="m'+(v?' on':'')+(i===now?' now':'')+'"></div>';
    }).join('');
    return '<div class="cal-row"><div class="crop">'+
      '<b data-lang="en">'+c.name.en+'</b><b data-lang="ar" lang="ar">'+c.name.ar+'</b>'+
      '<small data-lang="en">'+c.note.en+'</small>'+
      '<small data-lang="ar" lang="ar">'+c.note.ar+'</small></div>'+
      '<div class="months" role="img" aria-label="'+c.name.en+' season">'+cells+'</div></div>';
  }).join('');

  /* ---------- in-season chips (from the crop table above) ---------- */
  var inSeason = crops.filter(function(c){ return c.months[now]; });
  if (inSeason.length){
    var limit = DATA.seasonChipLimit || 6;
    document.getElementById('seasonChips').innerHTML =
      inSeason.slice(0, limit).map(function(c){
        return '<span class="chip"><span data-lang="en">'+c.name.en+'</span>'+
               '<span data-lang="ar" lang="ar">'+c.name.ar+'</span></span>';
      }).join(' ');
    document.getElementById('season').hidden = false;
  }

  /* ---------- the verse scene: light the lines once, when it comes into view ---------- */
  var poem = document.getElementById('verse');
  if (poem) {
    if (!('IntersectionObserver' in window)) {
      poem.classList.add('lit');
    } else {
      var io = new IntersectionObserver(function(entries, obs){
        entries.forEach(function(e){
          if (e.isIntersecting) { e.target.classList.add('lit'); obs.unobserve(e.target); }
        });
      }, {threshold:.35, rootMargin:'0px 0px -8% 0px'});
      io.observe(poem);
    }
  }

  /* ---------- certificate of the Godfather's blessing ----------
     The certificate paints as the visitor types, so there is never a
     "nothing happened yet" state and only ever one thing to press. */
  var repaintCert = null;
  (function(){
    var input = document.getElementById('certName'),
        action = document.getElementById('certAction'),
        nudge = document.getElementById('certNudge'),
        saved = document.getElementById('certSaved'),
        stage = document.getElementById('certStage'),
        cert = document.getElementById('cert'),
        cv = document.getElementById('certCanvas');
    if (!input || !cv || !cv.getContext) return;
    var ctx = cv.getContext('2d'), file = null, S = S_SIDE;
    var C = DATA.certificate || {};
    var shareEl = action.querySelector('[data-act="share"]'),
        downloadEl = action.querySelector('[data-act="download"]');

    function line(text, font, colour, y, rtl, max){
      ctx.font = font; ctx.fillStyle = colour;
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      try { ctx.direction = rtl ? 'rtl' : 'ltr'; } catch(e){}
      ctx.fillText(text, S/2, y, max || 900);
    }

    function paint(name, ar){
      var seal = document.querySelector('.seal img');
      var pick = function(o){ return o ? (ar ? o.ar : o.en) : ''; };
      ctx.fillStyle = '#F5F0E8'; ctx.fillRect(0,0,S,S);
      // frame
      ctx.strokeStyle = '#A6502C'; ctx.lineWidth = 10;
      ctx.strokeRect(38,38,S-76,S-76);
      ctx.strokeStyle = 'rgba(36,31,28,.22)'; ctx.lineWidth = 2;
      ctx.strokeRect(62,62,S-124,S-124);

      if (seal && seal.complete && seal.naturalWidth) {
        var w = 330, hgt = w * (seal.naturalHeight / seal.naturalWidth);
        ctx.drawImage(seal, (S-w)/2, 118, w, hgt);
      }

      line(pick(C.farmName),
           ar ? '500 30px "Noto Kufi Arabic", sans-serif' : '600 26px "Bricolage Grotesque", sans-serif',
           '#A6502C', 540, ar, 760);

      line(pick(C.suppliedBy),
           ar ? '500 36px "Noto Kufi Arabic", sans-serif' : '400 40px "Bricolage Grotesque", sans-serif',
           '#5D544C', 640, ar, 860);

      line(name,
           ar ? '700 70px "Noto Kufi Arabic", sans-serif' : '800 76px "Bricolage Grotesque", sans-serif',
           '#241F1C', 760, ar, 880);

      line(pick(C.signoff),
           ar ? '700 44px "Noto Kufi Arabic", sans-serif' : '600 48px "Bricolage Grotesque", sans-serif',
           '#3F6B37', 860, ar, 880);

      ctx.strokeStyle = 'rgba(36,31,28,.18)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(360, 930); ctx.lineTo(840, 930); ctx.stroke();

      var when = new Date().toLocaleDateString(ar ? 'ar-EG' : 'en-GB',
                   {day:'numeric', month:'long', year:'numeric'});
      line(pick(C.promise),
           ar ? '400 28px "IBM Plex Sans Arabic", sans-serif' : '400 28px "Bricolage Grotesque", sans-serif',
           '#5D544C', 990, ar, 820);
      line(when,
           ar ? '400 26px "IBM Plex Sans Arabic", sans-serif' : '400 26px "Bricolage Grotesque", sans-serif',
           '#5D544C', 1036, ar, 820);
      line(C.coords || '',
           '400 24px "Bricolage Grotesque", sans-serif', '#8A8078', 1082, false, 820);
    }

    // canvas silently falls back to a system font unless the webfont is
    // already loaded at the size being drawn — resolve once, not per keystroke
    var assets = null;
    function ready(){
      if (assets) return assets;
      var seal = document.querySelector('.seal img');
      var fonts = document.fonts ? Promise.all([
        document.fonts.load('800 76px "Bricolage Grotesque"'),
        document.fonts.load('600 48px "Bricolage Grotesque"'),
        document.fonts.load('400 40px "Bricolage Grotesque"'),
        document.fonts.load('700 70px "Noto Kufi Arabic"'),
        document.fonts.load('500 36px "Noto Kufi Arabic"'),
        document.fonts.load('400 28px "IBM Plex Sans Arabic"')
      ]) : Promise.resolve();
      var sealReady = (seal && seal.decode) ? seal.decode() : Promise.resolve();
      assets = Promise.all([fonts.catch(noop), sealReady.catch(noop)]);
      return assets;
    }
    function noop(){}

    // Share() must be called inside the user gesture, so the PNG is encoded
    // up front rather than on the click.
    function encode(){
      file = null;
      cv.toBlob(function(blob){
        if (!blob) return;
        try { file = new File([blob], C.filename || 'blessing.png', {type:'image/png'}); }
        catch(e) { file = blob; }
        action.disabled = false;
      }, 'image/png');
    }

    function canShareFile(){
      return !!(window.File && file instanceof File &&
                navigator.canShare && navigator.canShare({files:[file]}));
    }

    function labelAction(){
      // say what the button will actually do on this device
      var share = canShareFile();
      shareEl.hidden = !share;
      downloadEl.hidden = share;
    }

    function render(){
      var name = input.value.trim();
      saved.hidden = true;
      if (!name){
        stage.hidden = true; action.hidden = true; nudge.hidden = true;
        cert.classList.remove('drawn');
        file = null;
        return;
      }
      ready().then(function(){
        if (input.value.trim() !== name) return;   // they kept typing
        paint(name, document.documentElement.lang === 'ar');
        stage.hidden = false;
        action.hidden = false;
        nudge.hidden = false;
        cert.classList.add('drawn');
        encode();
        labelAction();
      });
    }

    var timer = null;
    input.addEventListener('input', function(){
      action.disabled = true;
      clearTimeout(timer);
      timer = setTimeout(render, 350);
    });

    // the certificate is language-specific, so redraw it when the page flips
    repaintCert = function(){ if (input.value.trim()) render(); };

    action.addEventListener('click', function(){
      if (!file) return;
      if (canShareFile()){
        navigator.share({files:[file]}).catch(noop);
        return;
      }
      var name = (input.value.trim() || 'blessing').replace(/[^\w\u0600-\u06FF -]/g,'') + '.png';
      var url = URL.createObjectURL(file), a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
      saved.hidden = false;   // a silent download otherwise feels like nothing happened
    });
  })();

  /* ---------- mobile menu ---------- */
  var mBtn = document.getElementById('menuBtn'), mNav = document.getElementById('mobnav');
  mBtn.addEventListener('click', function(){
    var open = mNav.classList.toggle('open');
    mBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  mNav.addEventListener('click', function(e){
    if (e.target.closest('a')){ mNav.classList.remove('open'); mBtn.setAttribute('aria-expanded','false'); }
  });

  /* ---------- gallery: built from the photos already on the page ---------- */
  var sources = [].slice.call(document.querySelectorAll('figure img[data-gal]'));
  var photos = sources.map(function(img){
    var fig = img.closest('figure');
    var cap = fig ? fig.querySelector('figcaption') : null;
    if (fig) fig.classList.add('gal-src');
    return { src: img.getAttribute('src'), alt: img.getAttribute('alt') || '',
             cap: cap ? cap.innerHTML : '',
             size: img.getAttribute('data-tile') || 'wide',
             style: img.getAttribute('style') || '',
             fig: fig };
  });

  var mosaic = document.getElementById('mosaic');
  mosaic.innerHTML = photos.map(function(p, i){
    return '<button class="tile '+p.size+'" type="button" data-i="'+i+'" aria-label="Open photo '+(i+1)+
           ' of '+photos.length+'">'+
           '<img src="'+p.src+'" alt="'+p.alt.replace(/"/g,'&quot;')+'"'+
           (p.style ? ' style="'+p.style.replace(/"/g,'&quot;')+'"' : '')+
           ' loading="lazy" decoding="async">'+
           '<span class="cap">'+p.cap+'</span></button>';
  }).join('');

  /* ---------- lightbox ---------- */
  var lb = document.getElementById('lb'), lbImg = document.getElementById('lbImg'),
      lbCap = document.getElementById('lbCap'), lbCount = document.getElementById('lbCount'),
      lbClose = document.getElementById('lbClose'), lbPrev = document.getElementById('lbPrev'),
      lbNext = document.getElementById('lbNext');
  var idx = 0, lastFocus = null;

  function show(i){
    idx = (i + photos.length) % photos.length;
    var p = photos[idx];
    lbImg.src = p.src; lbImg.alt = p.alt;
    lbCap.innerHTML = p.cap;
    lbCount.textContent = (idx + 1) + ' / ' + photos.length;
  }
  function openLb(i){
    lastFocus = document.activeElement;
    show(i);
    lb.classList.add('open');
    document.body.classList.add('lb-lock');
    lbClose.focus();
  }
  function closeLb(){
    lb.classList.remove('open');
    document.body.classList.remove('lb-lock');
    lbImg.removeAttribute('src');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  mosaic.addEventListener('click', function(e){
    var t = e.target.closest('.tile');
    if (t) openLb(parseInt(t.getAttribute('data-i'), 10));
  });
  photos.forEach(function(p, i){
    if (!p.fig) return;
    p.fig.addEventListener('click', function(e){
      if (e.target.tagName === 'A') return;
      openLb(i);
    });
  });

  lbClose.addEventListener('click', closeLb);
  lbPrev.addEventListener('click', function(){ show(idx - 1); });
  lbNext.addEventListener('click', function(){ show(idx + 1); });
  lb.addEventListener('click', function(e){
    if (e.target === lb || e.target.classList.contains('lb-stage')) closeLb();
  });
  document.addEventListener('keydown', function(e){
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape') closeLb();
    else if (e.key === 'ArrowRight') show(idx + 1);
    else if (e.key === 'ArrowLeft') show(idx - 1);
    else if (e.key === 'Tab'){
      var f = [lbPrev, lbNext, lbClose], k = f.indexOf(document.activeElement);
      e.preventDefault();
      f[(k + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
  });
  var tx = null;
  lb.addEventListener('touchstart', function(e){ tx = e.changedTouches[0].clientX; }, {passive:true});
  lb.addEventListener('touchend', function(e){
    if (tx === null) return;
    var d = e.changedTouches[0].clientX - tx;
    if (Math.abs(d) > 45) show(idx + (d < 0 ? 1 : -1));
    tx = null;
  }, {passive:true});

  /* ---------- language ----------
     The starting language was already decided before first paint by the
     inline script in <head>, so all this does is label the button and
     remember an explicit choice. Only a click writes to localStorage —
     otherwise an Arabic browser would be pinned to whatever it saw once. */
  var root = document.documentElement, btn = document.getElementById('langBtn');
  function apply(l){
    root.lang = l;
    root.dir = (l === 'ar') ? 'rtl' : 'ltr';
    btn.textContent = (l === 'ar') ? 'English' : 'عربي';
  }
  apply(root.lang === 'ar' ? 'ar' : 'en');
  btn.addEventListener('click', function(){
    var l = root.lang === 'ar' ? 'en' : 'ar';
    apply(l);
    if (repaintCert) repaintCert();
    try { localStorage.setItem('gf-lang', l); } catch(e){}
  });
})();
