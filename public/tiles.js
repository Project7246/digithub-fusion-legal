/* The tiles.
 *
 * What a module looks like when it is being chosen rather than used. The list
 * itself is not here - it is the one list in nav.js, which the rail reads too,
 * so a module added there turns up in both and can never turn up in only one.
 * This file is the drawing of it: the icons, and how a shelf of them is built.
 *
 * nav.js must be on the page first; everything here reads window.APP.sections.
 */
(function(){
  "use strict";

  /* Flat shapes in the brand's own colours - slate for the body of a thing, teal
     for the part being acted on, grey and light grey for what is behind it. No
     outlines and no shading, so they stay legible at 38px. */
  var SL = '#222F34', TL = '#11BAB5', GY = '#7B7B7B', LG = '#BBBBBB';

  var ICONS = {
    book:   '<rect x="8" y="7" width="26" height="34" rx="3" fill="' + SL + '"/>' +
            '<rect x="14" y="13" width="14" height="3" rx="1.5" fill="' + LG + '"/>' +
            '<rect x="14" y="20" width="14" height="3" rx="1.5" fill="' + LG + '"/>' +
            '<circle cx="34" cy="33" r="9" fill="' + TL + '"/>',
    shuffle:'<rect x="6" y="9" width="17" height="17" rx="3" fill="' + GY + '"/>' +
            '<rect x="25" y="22" width="17" height="17" rx="3" fill="' + TL + '"/>' +
            '<path d="M23 17h10v8" stroke="' + SL + '" stroke-width="3" fill="none" stroke-linecap="round"/>',
    up:     '<rect x="7" y="28" width="34" height="13" rx="3" fill="' + SL + '"/>' +
            '<path d="M24 7l10 11H14z" fill="' + TL + '"/>' +
            '<rect x="20" y="16" width="8" height="10" fill="' + TL + '"/>',
    cash:   '<rect x="5" y="12" width="38" height="24" rx="3" fill="' + SL + '"/>' +
            '<circle cx="24" cy="24" r="7" fill="' + TL + '"/>' +
            '<rect x="10" y="17" width="4" height="14" rx="2" fill="' + LG + '"/>' +
            '<rect x="34" y="17" width="4" height="14" rx="2" fill="' + LG + '"/>',
    wallet: '<rect x="6" y="11" width="36" height="26" rx="4" fill="' + SL + '"/>' +
            '<rect x="26" y="19" width="18" height="11" rx="3" fill="' + TL + '"/>' +
            '<circle cx="34" cy="24.5" r="2.6" fill="' + SL + '"/>',
    receipt:'<path d="M10 6h28v36l-5-3-5 3-5-3-5 3-5-3-3 2z" fill="' + SL + '"/>' +
            '<rect x="16" y="14" width="16" height="3" rx="1.5" fill="' + LG + '"/>' +
            '<rect x="16" y="22" width="11" height="3" rx="1.5" fill="' + TL + '"/>',
    find:   '<circle cx="21" cy="20" r="13" fill="' + GY + '"/>' +
            '<circle cx="21" cy="20" r="7" fill="' + LG + '"/>' +
            '<rect x="29" y="29" width="14" height="6" rx="3" transform="rotate(45 29 29)" fill="' + TL + '"/>',
    check:  '<rect x="8" y="6" width="28" height="36" rx="3" fill="' + SL + '"/>' +
            '<rect x="14" y="13" width="16" height="3" rx="1.5" fill="' + LG + '"/>' +
            '<circle cx="33" cy="33" r="10" fill="' + TL + '"/>' +
            '<path d="M29 33l3 3 6-6" stroke="#06251F" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    cart:   '<path d="M5 9h6l5 20h20" stroke="' + SL + '" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
            '<path d="M14 14h27l-4 12H17z" fill="' + TL + '"/>' +
            '<circle cx="19" cy="38" r="3.5" fill="' + SL + '"/><circle cx="34" cy="38" r="3.5" fill="' + SL + '"/>',
    box:    '<path d="M24 5l17 8v22l-17 8-17-8V13z" fill="' + SL + '"/>' +
            '<path d="M24 5l17 8-17 8-17-8z" fill="' + LG + '"/>' +
            '<path d="M24 21v22l17-8V13z" fill="' + GY + '"/>' +
            '<circle cx="24" cy="30" r="5" fill="' + TL + '"/>',
    copy:   '<rect x="6" y="6" width="24" height="28" rx="3" fill="' + LG + '"/>' +
            '<rect x="16" y="14" width="26" height="28" rx="3" fill="' + SL + '"/>' +
            '<rect x="22" y="22" width="14" height="3" rx="1.5" fill="' + TL + '"/>',
    swap:   '<path d="M8 17h26" stroke="' + SL + '" stroke-width="4" fill="none" stroke-linecap="round"/>' +
            '<path d="M28 10l8 7-8 7" fill="' + TL + '"/>' +
            '<path d="M40 31H14" stroke="' + GY + '" stroke-width="4" fill="none" stroke-linecap="round"/>' +
            '<path d="M20 24l-8 7 8 7" fill="' + LG + '"/>',
    ban:    '<circle cx="24" cy="24" r="17" fill="' + SL + '"/>' +
            '<rect x="13" y="21" width="22" height="6" rx="3" transform="rotate(-45 13 21)" fill="' + TL + '"/>',
    truck:  '<rect x="4" y="14" width="23" height="17" rx="2" fill="' + SL + '"/>' +
            '<path d="M27 19h8l6 7v5H27z" fill="' + TL + '"/>' +
            '<circle cx="14" cy="34" r="4.5" fill="' + GY + '"/><circle cx="34" cy="34" r="4.5" fill="' + GY + '"/>',
    pin:    '<path d="M24 5c-7.2 0-13 5.6-13 12.6C11 27 24 43 24 43s13-16 13-25.4C37 10.6 31.2 5 24 5z" fill="' + SL + '"/>' +
            '<circle cx="24" cy="18" r="6" fill="' + TL + '"/>',
    hand:   '<rect x="14" y="5" width="7" height="22" rx="3.5" fill="' + LG + '"/>' +
            '<rect x="22" y="8" width="7" height="19" rx="3.5" fill="' + GY + '"/>' +
            '<path d="M10 22h24v10a9 9 0 01-9 9h-6a9 9 0 01-9-9z" fill="' + SL + '"/>' +
            '<circle cx="22" cy="33" r="4.5" fill="' + TL + '"/>',
    sheet:  '<rect x="7" y="6" width="34" height="36" rx="3" fill="' + SL + '"/>' +
            '<rect x="13" y="13" width="22" height="3" rx="1.5" fill="' + LG + '"/>' +
            '<rect x="13" y="21" width="22" height="3" rx="1.5" fill="' + LG + '"/>' +
            '<rect x="13" y="29" width="13" height="3" rx="1.5" fill="' + TL + '"/>',
    back:   '<circle cx="24" cy="24" r="17" fill="' + GY + '"/>' +
            '<path d="M27 15l-9 9 9 9" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
            '<circle cx="36" cy="12" r="6" fill="' + TL + '"/>',
    tag:    '<path d="M6 6h18l18 18-18 18L6 24z" fill="' + SL + '"/>' +
            '<circle cx="16" cy="16" r="4.5" fill="' + TL + '"/>',
    bag:    '<path d="M9 15h30l-3 27H12z" fill="' + SL + '"/>' +
            '<path d="M17 18V12a7 7 0 0114 0v6" stroke="' + TL + '" stroke-width="4" fill="none" stroke-linecap="round"/>',
    chat:   '<path d="M6 10h36v22H20l-9 8v-8H6z" fill="' + SL + '"/>' +
            '<circle cx="17" cy="21" r="3" fill="' + LG + '"/>' +
            '<circle cx="25" cy="21" r="3" fill="' + LG + '"/>' +
            '<circle cx="33" cy="21" r="3" fill="' + TL + '"/>',
    people: '<circle cx="17" cy="16" r="7" fill="' + SL + '"/>' +
            '<circle cx="32" cy="18" r="6" fill="' + GY + '"/>' +
            '<path d="M5 41c0-7.2 5.4-12 12-12s12 4.8 12 12z" fill="' + SL + '"/>' +
            '<path d="M27 41c0-5.6 3.4-9.5 8-9.5S43 35.4 43 41z" fill="' + TL + '"/>',
    clock:  '<circle cx="24" cy="24" r="17" fill="' + SL + '"/>' +
            '<path d="M24 14v10l7 4" stroke="' + TL + '" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    cal:    '<rect x="6" y="10" width="36" height="32" rx="3" fill="' + SL + '"/>' +
            '<rect x="6" y="10" width="36" height="9" rx="3" fill="' + GY + '"/>' +
            '<rect x="13" y="25" width="7" height="7" rx="2" fill="' + LG + '"/>' +
            '<rect x="24" y="25" width="7" height="7" rx="2" fill="' + TL + '"/>'
  };

  function esc(s){
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function mark(name){
    return '<svg viewBox="0 0 48 48" aria-hidden="true">' + (ICONS[name] || ICONS.box) + '</svg>';
  }

  // One shelf's worth. The section's own modules, flattened out of the groups
  // the rail wears them in. A line marked `front` is the section's own overview
  // page - the page these tiles are drawn on - so it is never a tile on it.
  function tilesOf(sec){
    var out = [];
    sec.groups.forEach(function(g){
      g.items.forEach(function(it){
        if (it.front) return;
        out.push({ href: it.href, label: it.as || it.label, icon: it.tile, need: it.need });
      });
    });
    (sec.soon || []).forEach(function(t){
      out.push({ label: t.label, icon: t.tile, soon: true });
    });
    return out;
  }

  // Shown if the person was given the job it belongs to. A tile with no job is
  // reading, which was never what was being handed out.
  function mine(t){
    if (!t.need) return true;
    return !window.APP || !window.APP.may || window.APP.may(t.need);
  }

  function one(t){
    if (t.soon) {
      return '<div class="fxtile fxsoon"><div class="fxbox">' + mark(t.icon) + '</div>' +
        '<span>' + esc(t.label) + '</span></div>';
    }
    return '<a class="fxtile" href="' + esc(t.href) + '" data-sec="' + esc(t.sec || '') + '">' +
      '<div class="fxbox">' + mark(t.icon) + '</div><span>' + esc(t.label) + '</span></a>';
  }

  window.FUSION = window.FUSION || {};
  window.FUSION.mark = mark;
  window.FUSION.tilesOf = tilesOf;

  // A shelf of tiles into `el`. With a section key it draws that one; with none
  // it draws every section, each under its own heading - which is the launcher.
  // `find` narrows by name, across whatever is being drawn.
  window.FUSION.draw = function(el, key, find){
    var all = (window.APP && window.APP.sections) || [];
    var want = key ? all.filter(function(s){ return s.key === key; }) : all;
    var seek = String(find || '').trim().toLowerCase();
    var html = '', any = false;

    want.forEach(function(sec){
      var list = tilesOf(sec).filter(function(t){
        if (!mine(t)) return false;
        return !seek || t.label.toLowerCase().indexOf(seek) > -1;
      });
      if (!list.length) return;
      any = true;

      // On the launcher each shelf says which section it is, and the heading is
      // the way into that section's own rail. Inside a section there is only one
      // shelf and the page's own title already said so.
      if (!key) {
        html += '<div class="fxshelf">' +
          '<div class="fxshelfcap">' +
            '<a href="' + esc(sec.home) + '" data-sec="' + esc(sec.key) + '">' +
              esc(sec.label) + '</a>' +
            '<span>' + esc(sec.what || '') + '</span>' +
          '</div>';
      }
      html += '<div class="fxtiles">' +
        list.map(function(t){ t.sec = sec.key; return one(t); }).join('') + '</div>';
      if (!key) html += '</div>';
    });

    el.innerHTML = any ? html : '<div class="fxnone">' + (seek
      ? 'Nothing matches &ldquo;' + esc(find) + '&rdquo;.'
      : 'Nothing here is yours to open yet.') + '</div>';

    // Going into a section from here is what sets the desk, so the rail on the
    // page that opens is that section's and not whichever was last up.
    el.querySelectorAll('[data-sec]').forEach(function(a){
      var k = a.getAttribute('data-sec');
      if (!k) return;
      a.addEventListener('click', function(){
        try { sessionStorage.setItem('fusion:section', k); } catch (e) {}
      });
    });
  };
})();
