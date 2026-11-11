// IT Report + Laptop Spend views.
// Data comes from the server key "wiom_keka_it_report" (DB.get('it_report')), pushed once a day
// by the IT data refresh (Zoho Books bills, FAR, Gmail vendor invoices, Keka holders, laptop sale sheet).
// Shape: { u: "YYYY-MM-DD", src: {zoho, keka, gmail}, cat: {code: label},
//          it:   [[date, vendor, catCode, item, qty, amountExGST, billNo, source]],
//          hold: [[serial, name, type, status, holder, dept, purchasedOn, location, billDate, vendor, billNo, unitExGST, match]],
//          sold: [{d, buyer, dept, model, serial, tag, price, status, src, note, check}],
//          lap:  [{d, v, t:"P"|"R", i, q, a (incl. GST), s, n}],
//          gpend:[[mailDate, vendor, subject, invoiceNos, attachments]],
//          rec:  {fam: [[family, inKeka, sinceFeb25, perBills]], keka: [...], miss: [[bill, serial]]} }
(function () {
  const ITR = { tab: 'overview', fy: 'all', q: '', lapT: 'all' };
  try { ITR.tab = localStorage.getItem('itr_tab') || 'overview'; ITR.fy = localStorage.getItem('itr_fy') || 'all'; } catch (e) {}

  const data = () => { const d = DB.get('it_report', null); return d && Array.isArray(d.it) ? d : null; };
  const inr = v => '₹' + Math.round(Number(v) || 0).toLocaleString('en-IN');
  const inrS = v => { v = Number(v) || 0; return v >= 1e7 ? '₹' + (v / 1e7).toFixed(2) + ' Cr' : v >= 1e5 ? '₹' + (v / 1e5).toFixed(2) + ' L' : inr(v); };
  const fyOf = d => { if (!d || d.length < 7) return 'Unknown'; const y = +d.slice(0, 4), m = +d.slice(5, 7), s = m >= 4 ? y : y - 1; return s + '-' + String((s + 1) % 100).padStart(2, '0'); };
  const sum = (a, f) => a.reduce((s, r) => s + (Number(f(r)) || 0), 0);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtD = d => d && d.length >= 10 ? d.slice(8, 10) + ' ' + MON[+d.slice(5, 7) - 1] + ' ' + d.slice(0, 4) : (d || '–');
  const monName = m => MON[+m.slice(5, 7) - 1] + ' ' + m.slice(0, 4);

  const card = (label, val, color, sub) => `<div style="background:#fff;border:1px solid #e8e8f0;border-radius:12px;padding:16px">
    <div style="font-size:12px;color:#6b7280">${label}</div><div style="font-size:22px;font-weight:800;color:${color}">${val}</div>${sub ? `<div style="font-size:11px;color:#9ca3af;margin-top:2px">${sub}</div>` : ''}</div>`;
  const TH = 'padding:10px 12px;font-size:11px;font-weight:700;color:#888;text-transform:uppercase;white-space:nowrap';
  const TD = 'padding:9px 12px;font-size:13px;vertical-align:top';
  // cols: [label, align]; rows: arrays of cell html; foot: optional array
  const table = (cols, rows, foot) => `<div style="background:#fff;border:1px solid #e8e8f0;border-radius:12px;overflow:hidden"><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
    <thead><tr style="background:#fafafa">${cols.map(c => `<th style="${TH};text-align:${c[1] || 'left'}">${c[0]}</th>`).join('')}</tr></thead>
    <tbody>${rows.length ? rows.map(r => `<tr style="border-bottom:1px solid #f3f4f6">${r.map((x, i) => `<td style="${TD};text-align:${cols[i][1] || 'left'}">${x}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}"><div class="empty-state"><i class="bi bi-inbox"></i><p>Kuch nahi mila</p></div></td></tr>`}</tbody>
    ${foot ? `<tfoot><tr style="background:#EFF6FF;font-weight:700">${foot.map((x, i) => `<td style="${TD};text-align:${cols[i][1] || 'left'}">${x}</td>`).join('')}</tr></tfoot>` : ''}
  </table></div></div>`;
  const bars = (items, color) => {
    const max = Math.max(1, ...items.map(x => x[1]));
    return items.map(([n, v, sub]) => `<div style="display:grid;grid-template-columns:minmax(0,170px) 1fr auto;gap:10px;align-items:center;font-size:12.5px;margin:6px 0">
      <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escH(n)}">${escH(n)}</div>
      <div style="height:10px;background:#f1f5f9;border-radius:99px;overflow:hidden"><div style="height:100%;width:${(v / max * 100).toFixed(1)}%;background:${color};border-radius:99px"></div></div>
      <div style="color:#374151;font-weight:600;white-space:nowrap">${inrS(v)}${sub ? ` <span style="color:#9ca3af;font-weight:400">${sub}</span>` : ''}</div></div>`).join('');
  };
  const box = (title, inner, sub) => `<div style="background:#fff;border:1px solid #e8e8f0;border-radius:12px;padding:16px;min-width:0">
    <div style="font-weight:700;font-size:14px;margin-bottom:${sub ? 2 : 10}px">${title}</div>${sub ? `<div style="font-size:12px;color:#6b7280;margin-bottom:10px">${sub}</div>` : ''}${inner}</div>`;
  const pills = (opts, cur, fn) => `<div style="display:flex;flex-wrap:wrap;gap:6px">${opts.map(([k, l]) => `<button class="btn btn-sm ${cur === k ? 'btn-primary' : 'btn-outline'}" onclick="${fn}('${k}')">${l}</button>`).join('')}</div>`;
  const staleBanner = d => {
    const ago = x => x ? Math.floor((Date.now() - new Date(x + 'T00:00:00').getTime()) / 864e5) : 99;
    const nm = { zoho: 'Zoho bills', keka: 'Keka holders', gmail: 'Gmail invoices' }, src = d.src || {};
    const old = Object.keys(nm).filter(k => ago(src[k]) >= 2);
    if (!old.length) return '';
    return `<div style="background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:13px">
      <b>Purana data:</b> ${old.map(k => `${nm[k]} – aakhri update ${fmtD(src[k])} (${ago(src[k])} din pehle)`).join(' · ')}. Daily refresh check karein (Chrome me Keka / Zoho login).</div>`;
  };
  const noData = title => {
    document.getElementById('main-content').innerHTML = `<div class="page-header"><h2><i class="bi bi-receipt" style="color:#2563EB"></i> ${title}</h2></div>
      <div class="empty-state"><i class="bi bi-cloud-arrow-down"></i><p>IT data abhi upload nahi hua hai. Daily refresh chalne ke baad yahan dikhega.</p></div>`;
  };
  const csv = (name, head, rows) => {
    const q = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const blob = new Blob(['﻿' + [head, ...rows].map(r => r.map(q).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  };

  // ────────────────────────── IT REPORT ──────────────────────────
  window.itrSet = (k, v) => { ITR[k] = v; try { localStorage.setItem('itr_' + k, v); } catch (e) {} if (k !== 'q') ITR.q = ''; renderITReport(); };
  window.itrSearch = v => { ITR.q = v; const el = document.getElementById('itr-body'); if (el) el.innerHTML = itrBody(data()); const i = document.getElementById('itr-q'); if (i) { i.focus(); i.setSelectionRange(v.length, v.length); } };
  window.itrCSV = () => itrExport(data());

  function rowsFY(d) { return ITR.fy === 'all' ? d.it : d.it.filter(r => fyOf(r[0]) === ITR.fy); }
  const catName = (d, c) => (d.cat || {})[c] || c;
  const matchTxt = m => m === 'S' ? 'Serial se pakka' : m === 'M' ? 'Model se andaaza' : m === 'P' ? 'PV sheet invoice' : '–';

  function itrBody(d) {
    const rows = rowsFY(d), q = ITR.q.trim().toLowerCase();
    const hit = arr => q ? arr.filter(r => JSON.stringify(r).toLowerCase().includes(q)) : arr;
    const search = ph => `<div style="margin-bottom:12px"><input id="itr-q" class="form-control" style="max-width:380px" placeholder="${ph}" value="${escH(ITR.q)}" oninput="itrSearch(this.value)"></div>`;
    if (ITR.tab === 'overview') {
      const byFY = {}; d.it.forEach(r => { const f = fyOf(r[0]); byFY[f] = (byFY[f] || 0) + (r[5] || 0); });
      const fys = Object.keys(byFY).sort();
      const byCat = {}; rows.forEach(r => byCat[r[2]] = (byCat[r[2]] || 0) + (r[5] || 0));
      const byVen = {}; rows.forEach(r => byVen[r[1]] = (byVen[r[1]] || 0) + (r[5] || 0));
      const assigned = d.hold.filter(h => h[3] === 'Assigned').length, avail = d.hold.filter(h => h[3] === 'Available').length;
      const kc = {}; d.hold.forEach(h => { const k = String(h[0]).toUpperCase().replace(/[^A-Z0-9]/g, ''); if (k.length >= 5) kc[k] = (kc[k] || 0) + 1; });
      const att = [
        [d.gpend.length, 'Vendor invoice Gmail me aaya, Zoho me book nahi hua', d.gpend.map(g => g[1]).join(', ')],
        [d.hold.filter(h => !h[12]).length, 'Keka asset jinka bill nahi mila', ''],
        [avail, 'Store me khaali asset (naye joiner ko pehle yahi dein)', ''],
        [Object.values(kc).filter(n => n > 1).length, 'Keka me ek hi serial do asset par', ''],
        [d.sold.filter(x => x.check && /galat|check/i.test(x.check) && !/Sold mark kar/.test(x.check)).length, 'Laptop sale me check baaki', '']
      ].filter(x => x[0]);
      return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px">
        ${box('Financial year ke hisaab se kharcha', bars(fys.map(f => ['FY ' + f, byFY[f]]), '#2563EB'), 'Rakam GST ke bina')}
        ${box('Category', bars(Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([c, v]) => [catName(d, c), v]), '#0f766e'), ITR.fy === 'all' ? 'Sab saal' : 'FY ' + ITR.fy)}
        ${box('Top 10 vendor', bars(Object.entries(byVen).sort((a, b) => b[1] - a[1]).slice(0, 10), '#7c3aed'), ITR.fy === 'all' ? 'Sab saal' : 'FY ' + ITR.fy)}
        ${box('Keka assets', `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">${card('Kul', d.hold.length, '#2563EB')}${card('Assigned', assigned, '#10b981')}${card('Store me', avail, '#ca8a04')}</div>`, 'Kiske paas kya hai tab me poori list')}
        ${att.length ? box('Dhyan dein', att.map(a => `<div style="display:flex;gap:10px;align-items:baseline;padding:7px 0;border-bottom:1px solid #f3f4f6;font-size:13px"><b style="color:#dc2626;min-width:30px">${a[0]}</b><div>${a[1]}${a[2] ? `<div style="font-size:11.5px;color:#6b7280">${escH(a[2])}</div>` : ''}</div></div>`).join('')) : ''}
      </div>`;
    }
    if (ITR.tab === 'cat') {
      const m = {}; rows.forEach(r => { const x = m[r[2]] = m[r[2]] || { n: 0, q: 0, a: 0, v: new Set() }; x.n++; x.q += r[4] || 0; x.a += r[5] || 0; x.v.add(r[1]); });
      const list = Object.entries(m).sort((a, b) => b[1].a - a[1].a);
      return table([['Category'], ['Bill lines', 'center'], ['Qty', 'center'], ['Vendors', 'center'], ['Rakam (ex-GST)', 'right']],
        list.map(([c, x]) => [escH(catName(d, c)), x.n, x.q, x.v.size, inr(x.a)]),
        ['Total', sum(list, x => x[1].n), sum(list, x => x[1].q), '', inr(sum(list, x => x[1].a))]);
    }
    if (ITR.tab === 'vendor') {
      const m = {}; rows.forEach(r => { const x = m[r[1]] = m[r[1]] || { n: 0, q: 0, a: 0, last: '', c: {} }; x.n++; x.q += r[4] || 0; x.a += r[5] || 0; if ((r[0] || '') > x.last) x.last = r[0]; x.c[r[2]] = (x.c[r[2]] || 0) + (r[5] || 0); });
      const list = hit(Object.entries(m).sort((a, b) => b[1].a - a[1].a));
      return search('Vendor dhoondhein…') + table([['Vendor'], ['Kya kharida'], ['Lines', 'center'], ['Qty', 'center'], ['Aakhri bill', 'center'], ['Rakam (ex-GST)', 'right']],
        list.map(([v, x]) => [`<b>${escH(v)}</b>`, escH(Object.entries(x.c).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => catName(d, e[0])).join(', ')), x.n, x.q, fmtD(x.last), inr(x.a)]),
        ['Total (' + list.length + ' vendor)', '', sum(list, x => x[1].n), sum(list, x => x[1].q), '', inr(sum(list, x => x[1].a))]);
    }
    if (ITR.tab === 'year') {
      const fys = [...new Set(d.it.map(r => fyOf(r[0])))].sort();
      const cats = [...new Set(d.it.map(r => r[2]))].sort((a, b) => sum(d.it.filter(r => r[2] === b), r => r[5]) - sum(d.it.filter(r => r[2] === a), r => r[5]));
      const cell = (c, f) => { const v = sum(d.it.filter(r => r[2] === c && fyOf(r[0]) === f), r => r[5]); return v ? inrS(v) : '<span style="color:#d1d5db">–</span>'; };
      return table([['Category'], ...fys.map(f => ['FY ' + f, 'right']), ['Total', 'right']],
        cats.map(c => [escH(catName(d, c)), ...fys.map(f => cell(c, f)), `<b>${inrS(sum(d.it.filter(r => r[2] === c), r => r[5]))}</b>`]),
        ['Total', ...fys.map(f => inrS(sum(d.it.filter(r => fyOf(r[0]) === f), r => r[5]))), inrS(sum(d.it, r => r[5]))]);
    }
    if (ITR.tab === 'bills') {
      const list = hit(rows.slice().sort((a, b) => (b[0] || '').localeCompare(a[0] || '')));
      const shown = list.slice(0, 400);
      return search('Vendor, saman, bill no. dhoondhein…') + table([['Tareekh'], ['Vendor'], ['Category'], ['Saman'], ['Qty', 'center'], ['Rakam (ex-GST)', 'right'], ['Bill no.'], ['Source']],
        shown.map(r => [fmtD(r[0]), escH(r[1]), escH(catName(d, r[2])), escH(r[3]), r[4], inr(r[5]), escH(r[6] || '–'), r[7]]),
        ['Total (' + list.length + ' lines)', '', '', '', sum(list, r => r[4]), inr(sum(list, r => r[5])), '', ''])
        + (list.length > shown.length ? `<div style="font-size:12px;color:#6b7280;margin-top:8px">Pehli ${shown.length} lines dikh rahi hain. Search karein ya CSV export karein.</div>` : '');
    }
    if (ITR.tab === 'hold') {
      const list = hit(d.hold.slice().sort((a, b) => (a[2] + a[4]).localeCompare(b[2] + b[4])));
      const shown = list.slice(0, 400);
      return search('Employee, serial, model, vendor dhoondhein…') + table([['Asset'], ['Serial'], ['Kiske paas'], ['Status'], ['Kab liya'], ['Vendor / bill'], ['Rate (ex-GST)', 'right'], ['Bill match']],
        shown.map(h => [`${escH(h[1])}<div style="font-size:11px;color:#9ca3af">${escH(h[2])} · ${escH(h[7] || '')}</div>`, `<code style="font-size:12px">${escH(h[0])}</code>`, h[4] ? `<b>${escH(h[4])}</b><div style="font-size:11px;color:#9ca3af">${escH(h[5] || '')}</div>` : '<span style="color:#ca8a04">Store me</span>', escH(h[3]), fmtD(h[8] || h[6]), `${escH(h[9] || '–')}<div style="font-size:11px;color:#9ca3af">${escH(h[10] || '')}</div>`, h[11] ? inr(h[11]) : '–', matchTxt(h[12])]))
        + (list.length > shown.length ? `<div style="font-size:12px;color:#6b7280;margin-top:8px">Pehle ${shown.length} assets dikh rahe hain. Search karein ya CSV export karein.</div>` : '');
    }
    if (ITR.tab === 'sold') {
      const list = hit(d.sold.filter(x => x.status === 'Sold').sort((a, b) => a.buyer.localeCompare(b.buyer)));
      return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:14px">
        ${card('Laptop beche', list.length, '#2563EB')}${card('Kul wasooli', inr(sum(list, x => x.price)), '#10b981')}${card('Kharidne wale', new Set(list.map(x => x.buyer)).size, '#7c3aed')}</div>`
        + search('Buyer, serial, model dhoondhein…') + table([['Kisko becha'], ['Laptop'], ['Serial / tag'], ['Kitne me', 'right'], ['Tareekh'], ['Keka / note']],
          list.map(x => [`<b>${escH(x.buyer)}</b><div style="font-size:11px;color:#9ca3af">${escH(x.dept || '')}</div>`, escH(x.model || '–'), `<code style="font-size:12px">${escH(x.serial || '–')}</code><div style="font-size:11px;color:#9ca3af">${escH(x.tag || '')}</div>`, inr(x.price), fmtD(x.d), escH(x.check || 'OK')]),
          ['Total', '', '', inr(sum(list, x => x.price)), '', '']);
    }
    if (ITR.tab === 'pending') {
      return `<div style="font-size:13px;color:#6b7280;margin-bottom:10px">Vendor ka invoice Gmail me aaya hai par Zoho Books me abhi bill nahi chadha.</div>`
        + table([['Mail tareekh'], ['Vendor'], ['Subject'], ['Invoice no.'], ['Attachment']], d.gpend.map(g => [fmtD(g[0]), `<b>${escH(g[1])}</b>`, escH(g[2]), escH(g[3] || '–'), escH(g[4] || '')]));
    }
    return '';
  }

  function itrExport(d) {
    if (!d) return;
    const rows = rowsFY(d);
    if (ITR.tab === 'hold') return csv('keka_asset_holders.csv', ['Serial', 'Asset', 'Type', 'Status', 'With', 'Department', 'Location', 'Bought on', 'Vendor', 'Bill no', 'Rate ex-GST', 'Bill match'], d.hold.map(h => [h[0], h[1], h[2], h[3], h[4], h[5], h[7], h[8] || h[6], h[9], h[10], h[11], matchTxt(h[12])]));
    if (ITR.tab === 'sold') return csv('laptop_sale.csv', ['Buyer', 'Department', 'Model', 'Serial', 'Tag', 'Price', 'Date', 'Note'], d.sold.filter(x => x.status === 'Sold').map(x => [x.buyer, x.dept, x.model, x.serial, x.tag, x.price, x.d, x.check]));
    return csv('it_purchases' + (ITR.fy === 'all' ? '' : '_FY' + ITR.fy) + '.csv', ['Date', 'FY', 'Vendor', 'Category', 'Item', 'Qty', 'Amount ex-GST', 'Bill no', 'Source'], rows.map(r => [r[0], fyOf(r[0]), r[1], catName(d, r[2]), r[3], r[4], r[5], r[6], r[7]]));
  }

  window.renderITReport = function () {
    const d = data(); if (!d) return noData('IT Report');
    const rows = rowsFY(d), fys = [...new Set(d.it.map(r => fyOf(r[0])))].sort().reverse();
    const lapRows = rows.filter(r => r[2] === 'LP');
    const tabs = [['overview', 'Overview'], ['cat', 'Category'], ['vendor', 'Vendor-wise'], ['year', 'FY-wise'], ['bills', 'Saare bill'], ['hold', 'Kiske paas kya'], ['sold', 'Laptop sale'], ['pending', 'Zoho me baaki (' + d.gpend.length + ')']];
    document.getElementById('main-content').innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:10px;flex-wrap:wrap">
        <h2><i class="bi bi-receipt-cutoff" style="color:#2563EB"></i> IT Report</h2>
        <button class="btn btn-outline btn-sm" onclick="itrCSV()"><i class="bi bi-download"></i> Export CSV</button>
      </div>
      <div style="font-size:13px;color:#6b7280;margin-bottom:14px">Zoho Books + FAR + Gmail vendor invoice + Keka · rakam GST ke bina · aakhri update: <b>${fmtD(d.u)}</b></div>
      ${staleBanner(d)}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:16px">
        ${card('Kul IT kharcha', inrS(sum(rows, r => r[5])), '#2563EB', rows.length + ' bill lines')}
        ${card('Vendors', new Set(rows.map(r => r[1])).size, '#7c3aed')}
        ${card('Laptop kharcha', inrS(sum(lapRows, r => r[5])), '#0f766e', sum(lapRows, r => r[4]) + ' laptop')}
        ${card('Keka assets', d.hold.length, '#ca8a04', d.hold.filter(h => h[3] === 'Assigned').length + ' assigned')}
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px">
        ${pills([['all', 'Sab saal'], ...fys.map(f => [f, 'FY ' + f])], ITR.fy, "itrSet.bind(null,'fy')")}
        ${pills(tabs, ITR.tab, "itrSet.bind(null,'tab')")}
      </div>
      <div id="itr-body">${itrBody(d)}</div>`;
  };

  // ────────────────────────── LAPTOP SPEND ──────────────────────────
  window.lapSet = v => { ITR.lapT = v; renderLaptopSpend(); };
  window.renderLaptopSpend = function () {
    const d = data(); if (!d || !Array.isArray(d.lap)) return noData('Laptop Spend');
    const all = d.lap, rows = all.filter(r => ITR.lapT === 'all' || r.t === ITR.lapT);
    const amt = a => sum(a, r => r.a), laps = a => sum(a.filter(r => r.t === 'P'), r => r.q);
    const mk = r => (r.d || '').slice(0, 7);
    const vendors = [...new Set(rows.map(r => r.v))].sort((a, b) => amt(rows.filter(r => r.v === b)) - amt(rows.filter(r => r.v === a)));
    const months = [...new Set(rows.map(mk))].filter(Boolean).sort().reverse();
    const cell = rs => { if (!rs.length) return '<span style="color:#d1d5db">–</span>'; const a = amt(rs), q = laps(rs), unk = rs.some(r => r.a == null);
      return `<span title="${escH(rs.map(r => r.d + ' · ' + r.i + (r.a != null ? ' · ' + inr(r.a) : '')).join('\n'))}">${a ? inr(a) : 'PDF me'}${unk && a ? ' +' : ''}${q ? `<div style="font-size:11px;color:#2563EB;font-weight:700">${q} laptop</div>` : ''}</span>`; };
    const matrix = table([['Mahina'], ...vendors.map(v => [escH(v), 'right']), ['Mahine ka total', 'right']],
      months.map(m => { const mr = rows.filter(r => mk(r) === m); return [monName(m), ...vendors.map(v => cell(mr.filter(r => r.v === v))), `<b>${cell(mr)}</b>`]; }),
      ['Kul', ...vendors.map(v => cell(rows.filter(r => r.v === v))), cell(rows)]);
    const tag = (t, bg, fg) => `<span style="font-size:10.5px;font-weight:700;padding:1px 7px;border-radius:99px;background:${bg};color:${fg};margin-left:6px">${t}</span>`;
    const detail = months.map((m, i) => { const mr = rows.filter(r => mk(r) === m), q = laps(mr);
      return `<details ${i < 2 ? 'open' : ''} style="background:#fff;border:1px solid #e8e8f0;border-radius:10px;margin-bottom:8px">
        <summary style="cursor:pointer;padding:10px 14px;font-weight:700;display:flex;justify-content:space-between"><span>${monName(m)}</span><span style="color:#6b7280;font-weight:600">${q ? q + ' laptop · ' : ''}${inr(amt(mr))}</span></summary>
        ${mr.map(r => `<div style="display:grid;grid-template-columns:70px 1fr auto;gap:10px;padding:9px 14px;border-top:1px solid #f3f4f6;font-size:13px">
          <span style="color:#6b7280">${fmtD(r.d).slice(0, 6)}</span>
          <div><b>${escH(r.v)}</b>${r.t === 'P' ? tag('Kharida', '#DBEAFE', '#1d4ed8') : tag('Repair', '#FEF3C7', '#b45309')}${tag(({ pdf: 'PDF', jpg: 'Photo', stmt: 'Ledger', mail: 'Mail', zoho: 'Zoho' })[r.s] || r.s || '', '#ECFDF5', '#047857')}<div>${escH(r.i)}${r.n ? `<span style="color:#9ca3af"> · ${escH(r.n)}</span>` : ''}</div></div>
          <div style="text-align:right;font-weight:700;white-space:nowrap">${r.a != null ? inr(r.a) : 'PDF me'}${r.q ? `<div style="font-size:11px;color:#6b7280;font-weight:600">${r.q} laptop${r.q > 1 && r.a ? ' · ' + inr(r.a / r.q) + ' har ek' : ''}</div>` : ''}</div></div>`).join('')}</details>`; }).join('');
    let rec = '';
    if (d.rec && Array.isArray(d.rec.fam)) {
      let s = [0, 0, 0];
      const fr = d.rec.fam.map(([f, a, since, b]) => { s[0] += a; s[1] += since; s[2] += b; const g = since - b;
        return [escH(f), a, since, b, `<b style="color:${g === 0 ? '#10b981' : g > 0 ? '#ca8a04' : '#dc2626'}">${g === 0 ? '✓' : (g > 0 ? '+' : '') + g}</b>`]; });
      rec = `<h3 style="font-size:15px;margin:22px 0 10px">Keka asset list se milaan</h3>`
        + table([['Model'], ['Keka me (kul)', 'center'], ['Keka me (Feb-25 ke baad)', 'center'], ['Bill se kharide', 'center'], ['Farq', 'center']], fr, ['Kul', s[0], s[1], s[2], (s[1] - s[2] > 0 ? '+' : '') + (s[1] - s[2])])
        + `<div style="font-size:12px;color:#6b7280;margin-top:6px">"+" = Keka me zyada laptop jinka bill nahi mila. "−" = bill me zyada kharide par Keka me kam darj (ya model ka naam alag). Feb-25 wala column andaaza hai.</div>`;
    }
    document.getElementById('main-content').innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:10px;flex-wrap:wrap">
        <h2><i class="bi bi-laptop" style="color:#2563EB"></i> Laptop Spend</h2>
        <button class="btn btn-outline btn-sm" onclick="lapCSV()"><i class="bi bi-download"></i> Export CSV</button>
      </div>
      <div style="font-size:13px;color:#6b7280;margin-bottom:14px">Gmail ke saare bill (PDF, photo), Zoho Books, ledger aur mails se · Feb 2025 se · rakam GST ke saath · aakhri update: <b>${fmtD(d.u)}</b></div>
      ${staleBanner(d)}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:16px">
        ${card('Kul kharcha', inrS(amt(all)), '#2563EB')}${card('Laptop kharide', laps(all), '#10b981')}
        ${card('Naye laptop', inrS(amt(all.filter(r => r.t === 'P'))), '#7c3aed')}${card('Repair / parts', inrS(amt(all.filter(r => r.t === 'R'))), '#ca8a04')}
      </div>
      <div style="margin-bottom:14px">${pills([['all', 'Sab'], ['P', 'Kharide'], ['R', 'Repair / parts']], ITR.lapT, 'lapSet')}</div>
      <h3 style="font-size:15px;margin:0 0 10px">Mahine ke hisaab se, har vendor ka column</h3>
      ${matrix}
      <div style="font-size:12px;color:#6b7280;margin:6px 0 20px">"+" = us mahine ka koi bill sirf PDF/photo me hai, uski rakam total me nahi judi. Khane par mouse rakhein to us mahine ke bill dikhenge.</div>
      <h3 style="font-size:15px;margin:0 0 10px">Har bill ki detail</h3>
      ${detail}
      ${rec}`;
  };
  // This file loads after the main script, so a refresh on #itreport / #laptopspend can try to
  // open the view before these functions exist. Re-open it once they are defined.
  setTimeout(() => {
    try {
      const h = (location.hash || '').slice(1);
      if ((h === 'itreport' || h === 'laptopspend') && typeof currentUser !== 'undefined' && currentUser) navGo(h);
    } catch (e) {}
  }, 0);
  window.lapCSV = () => { const d = data(); if (d) csv('laptop_spend.csv', ['Date', 'Vendor', 'Type', 'Item', 'Qty', 'Amount incl GST', 'Source', 'Ref'], d.lap.map(r => [r.d, r.v, r.t === 'P' ? 'Purchase' : 'Repair', r.i, r.q, r.a, r.s, r.n])); };
})();
