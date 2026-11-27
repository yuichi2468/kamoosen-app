// Apps Script をローカル（Node.js）で動かすための簡易モック
const fs = require('fs');
const vm = require('vm');
const path = require('path');

function makeSheet(name) {
  const data = [];
  let filter = null; // フィルタ（範囲だけ覚える）
  const width = () => data.reduce((w, r) => Math.max(w, r.length), 0);
  const ensure = (r, c) => { while (data.length < r) data.push([]); for (let i = 0; i < r; i++) while (data[i].length < c) data[i].push(''); };
  const range = (r, c, nr, nc) => ({
    getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(data[r - 1 + i] && data[r - 1 + i][c - 1 + j] !== undefined ? data[r - 1 + i][c - 1 + j] : ''); out.push(row); } return out; },
    setValues(v) { ensure(r + v.length - 1, c + v[0].length - 1); v.forEach((row, i) => row.forEach((x, j) => { data[r - 1 + i][c - 1 + j] = x; })); return this; },
    setValue(x) { ensure(r, c); data[r - 1][c - 1] = x; return this; },
    setFontWeight() { return this; },
    createFilter() { if (filter) throw new Error('フィルタはすでにあります'); filter = { range: [r, c, nr, nc], remove() { filter = null; } }; return filter; }, setNumberFormat() { return this; }, setNote() { return this; }
  });
  return {
    name, data,
    getLastRow() { for (let i = data.length - 1; i >= 0; i--) if (data[i].some(x => x !== '' && x !== null)) return i + 1; return 0; },
    getLastColumn() { return width(); },
    getMaxColumns() { return this.__maxCols || 26; },
    insertColumnsAfter(after, n) { this.__maxCols = (this.__maxCols || 26) + n; this.__inserted = (this.__inserted || 0) + n; },
    getRange(a, b, c, d) { if (typeof a === 'string') return range(1, 1, 1, 1); return range(a, b, c || 1, d || 1); },
    getDataRange() { const lr = this.getLastRow(); return range(1, 1, Math.max(lr, 0), width()); },
    appendRow(row) { const r = this.getLastRow() + 1; ensure(r, row.length); row.forEach((x, j) => { data[r - 1][j] = x; }); },
    clearContents() { data.length = 0; },
    setFrozenRows() {}, setFrozenColumns() {},
    getFilter() { return filter; }
  };
}

function loadGas(opts = {}) {
  const sheets = {};
  let clock = opts.now || Date.parse('2026-11-25T10:00:00+09:00');
  const ss = {
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => (sheets[n] = makeSheet(n)),
    toast() {}
  };
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(clock); else super(...a); }
    static now() { return clock; }
  }
  const ctx = {
    console, Math, JSON, Number, String, Array, Object, isNaN, parseInt, parseFloat, Error,
    Date: FakeDate,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addToUi() {} }) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { formatDate: (d) => d.toISOString().replace(/\D/g, '').slice(2, 14) },
    HtmlService: {}, ContentService: {}
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8'), ctx);
  ctx.__sheets = sheets;
  ctx.__setNow = t => { clock = t; };
  ctx.__advance = ms => { clock += ms; };
  return ctx;
}

module.exports = { loadGas };
