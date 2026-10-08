import { icon } from './icons.js';
import { errMsg } from './api.js';
import { initials } from './format.js';

/* ---------- Safe HTML templates ----------
 * html`...` escapes every ${value} automatically, so names, remarks and other data
 * can never inject markup (XSS). Use raw() only for markup we wrote ourselves. */
class Safe {
  constructor(s) { this.s = s; }
}
export const raw = (s) => new Safe(String(s));
const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => MAP[c]);
const part = (v) => (v == null || v === false ? '' : v instanceof Safe ? v.s : Array.isArray(v) ? v.map(part).join('') : esc(v));
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s + (i < vals.length ? part(vals[i]) : ''); });
  return new Safe(out);
}
/** Copies each column heading onto its cells, so tables can turn into cards on small screens. */
function labelTable(table) {
  const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
  table.querySelectorAll('tbody tr').forEach((tr) => [...tr.children].forEach((td, i) => { if (heads[i]) td.dataset.label = heads[i]; }));
}
export const mount = (el, safe) => {
  el.innerHTML = safe.s;
  el.querySelectorAll('table.table').forEach(labelTable);
  return el;
};
export const ic = (name, size = 18, extra = '') => raw(icon(name, size, extra));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function debounce(fn, delay = 350) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

/* ---------- Toasts ---------- */
function showToast(type, message) {
  const el = document.createElement('div');
  el.className = 'toast ' + (type === 'success' ? 'ok' : 'bad');
  el.setAttribute('role', type === 'success' ? 'status' : 'alert');
  el.innerHTML = icon(type === 'success' ? 'circle-check' : 'circle-alert', 20) + `<p>${esc(message)}</p><button type="button" aria-label="Dismiss">${icon('x', 16)}</button>`;
  const remove = () => el.remove();
  el.querySelector('button').addEventListener('click', remove);
  document.getElementById('toasts').appendChild(el);
  setTimeout(remove, 4500);
}
export const toast = { success: (m) => showToast('success', m), error: (m) => showToast('error', m) };

/* ---------- Buttons ---------- */
export function setLoading(button, loading) {
  if (!button) return;
  if (loading) {
    button.dataset.label = button.innerHTML;
    button.disabled = true;
    button.innerHTML = icon('loader-circle', 16, 'spin') + button.innerHTML.replace(/<svg[\s\S]*?<\/svg>/, '');
  } else {
    if (button.dataset.label) button.innerHTML = button.dataset.label;
    button.disabled = false;
  }
}

/* ---------- Modal ---------- */
export function openModal({ title, body, footer, size = 'md' }) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = html`<div class="modal-back" data-close></div>
    <div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="modal-head"><h2>${title}</h2><button type="button" class="modal-x" data-close aria-label="Close">${ic('x', 20)}</button></div>
      <div class="modal-body">${body}</div>
      ${footer ? html`<div class="modal-foot">${footer}</div>` : ''}
    </div>`.s;

  const previous = document.activeElement;
  document.body.style.overflow = 'hidden';
  const onKey = (e) => e.key === 'Escape' && close();
  function close() {
    wrap.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    previous?.focus?.();
  }
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', (e) => e.target.closest('[data-close]') && close());
  document.body.appendChild(wrap);
  (wrap.querySelector('input, select, textarea') || wrap.querySelector('.modal')).focus?.();
  return { el: wrap, close };
}

/** Asks for confirmation. onConfirm may be async; the dialog closes when it succeeds. */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', variant = 'danger', onConfirm }) {
  const modal = openModal({
    title,
    size: 'sm',
    body: html`<p class="muted">${message}</p>`,
    footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button>
      <button type="button" class="btn btn-${variant}" data-ok>${confirmLabel}</button>`,
  });
  const ok = modal.el.querySelector('[data-ok]');
  ok.addEventListener('click', async () => {
    setLoading(ok, true);
    try {
      await onConfirm();
      modal.close();
    } catch (error) {
      toast.error(errMsg(error));
      setLoading(ok, false);
    }
  });
}

/* ---------- Small components ---------- */
const STATUS_LABELS = { present: 'Present', absent: 'Absent', late: 'Late', leave: 'Leave', active: 'Active', inactive: 'Inactive', pending: 'Pending' };
export const badge = (status, title = '') =>
  html`<span class="badge badge-${status in STATUS_LABELS ? status : 'unmarked'}" ${title ? raw(`title="${esc(title)}"`) : ''}>${STATUS_LABELS[status] || 'Not marked'}</span>`;

// "Late" badges show how many minutes late on hover.
export const lateTitle = (r) => (r && r.status === 'late' && r.late_minutes > 0 ? `${r.late_minutes} minutes after the school start time` : '');

export const avatar = (name, extra = '') => html`<span class="avatar ${extra}" aria-hidden="true">${initials(name)}</span>`;

export const emptyState = ({ icon: name, title, text, action }) =>
  html`<div class="state">${name ? html`<span class="state-icon">${ic(name, 28)}</span>` : ''}<h3>${title}</h3>${text ? html`<p>${text}</p>` : ''}${action || ''}</div>`;

/** Shown when the database is older than the app. Explains the one-step fix. */
export const dbOutdatedNotice = () =>
  html`<div class="alert alert-error" role="alert" style="margin-bottom:16px"><b>The database needs an update.</b> Some features (registration, check-in, settings) will not work until it is updated.
    In phpMyAdmin click <b>sunshine_attendance</b> → <b>SQL</b> tab → paste the contents of <b>database/update_to_latest.sql</b> → <b>Go</b>. Then refresh this page.</div>`;

export const errorState = (message) =>
  html`<div class="state" role="alert"><span class="state-icon err">${ic('circle-alert', 24)}</span><p style="color:var(--ink);font-weight:700">${message}</p><button type="button" class="btn btn-secondary btn-sm" data-retry>Try again</button></div>`;

export const tableSkeleton = (rows = 5, cols = 6) =>
  html`<div class="skel-rows" role="status" aria-label="Loading">${Array.from({ length: rows }, () => html`<div class="skel-row">${Array.from({ length: cols }, () => html`<div class="skel"></div>`)}</div>`)}</div>`;

export const cardsSkeleton = (count = 4) =>
  html`<div class="stat-grid" role="status" aria-label="Loading">${Array.from({ length: count }, () => html`<div class="skel" style="height:92px;border-radius:14px"></div>`)}</div>`;

export const loading = (label = 'Loading…') => html`<div class="loading" role="status">${ic('loader-circle', 20, 'spin')} ${label}</div>`;

export function pager(p) {
  if (!p || p.total === 0) return html``;
  const from = (p.page - 1) * p.limit + 1;
  const to = Math.min(p.page * p.limit, p.total);
  return html`<div class="pager">
    <p>Showing <b>${from}–${to}</b> of <b>${p.total}</b></p>
    <div class="pager-btns">
      <button type="button" class="btn btn-secondary btn-sm" data-page="${p.page - 1}" ${p.page <= 1 ? 'disabled' : ''}>${ic('chevron-left', 16)} Previous</button>
      <span>Page ${p.page} of ${p.pages}</span>
      <button type="button" class="btn btn-secondary btn-sm" data-page="${p.page + 1}" ${p.page >= p.pages ? 'disabled' : ''}>Next ${ic('chevron-right', 16)}</button>
    </div></div>`;
}

const ringColor = (v) => (v >= 90 ? '#1F9656' : v >= 75 ? '#0B5FA5' : '#E4541A');

export function ring(value = 0, size = 132, label = 'Attendance') {
  const v = Math.min(Math.max(Number(value) || 0, 0), 100);
  const stroke = 10, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return html`<div class="ring" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" role="img" aria-label="${label} ${v}%">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#E5E8E2" stroke-width="${stroke}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${ringColor(v)}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - v / 100)}"/>
    </svg>
    <div class="ring-text"><strong>${v}%</strong><span>${label}</span></div></div>`;
}

export function bar(value = 0) {
  const v = Math.min(Math.max(Number(value) || 0, 0), 100);
  const color = v >= 90 ? 'var(--leaf)' : v >= 75 ? 'var(--royal)' : 'var(--ember)';
  return html`<div class="bar"><div class="bar-track" role="progressbar" aria-valuenow="${v}" aria-valuemin="0" aria-valuemax="100"><div class="bar-fill" style="width:${v}%;background:${color}"></div></div><b>${v}%</b></div>`;
}

const SUMMARY_ITEMS = [
  ['totalDays', 'Working days', 'calendar-days', 'tone-blue'],
  ['present', 'Present', 'circle-check', 'tone-leaf'],
  ['absent', 'Absent', 'circle-x', 'tone-red'],
  ['late', 'Late', 'clock', 'tone-amber'],
  ['leave', 'Leave', 'plane', 'tone-blue'],
];

/** Attendance percentage ring plus the day counts. */
export const statsSummary = (s) =>
  html`<div class="summary">${ring(s.percentage)}<dl class="summary-items">${SUMMARY_ITEMS.map(([key, label, name, tone]) =>
    html`<div class="summary-item"><span class="stat-icon ${tone}">${ic(name, 18)}</span><div><dd>${s[key]}</dd><dt>${label}</dt></div></div>`)}</dl></div>`;

export const statCard = (name, label, value, tone) =>
  html`<div class="card stat"><span class="stat-icon tone-${tone}">${ic(name, 24)}</span><div><p class="stat-value">${value}</p><p class="stat-label">${label}</p></div></div>`;

export const pageHead = (title, subtitle, actions) =>
  html`<div class="page-head"><div><h1>${title}</h1>${subtitle ? html`<p>${subtitle}</p>` : ''}</div>${actions ? html`<div class="page-actions">${actions}</div>` : ''}</div>`;

/* ---------- Form helpers ---------- */
export const input = ({ name, type = 'text', value = '', placeholder = '', autocomplete = 'off', extra = '' }) =>
  html`<input class="input" id="${name}" name="${name}" type="${type}" value="${value}" placeholder="${placeholder}" autocomplete="${autocomplete}" ${raw(extra)}>`;

export const select = ({ name, value = '', options, extra = '' }) =>
  html`<select class="input" id="${name}" name="${name}" ${raw(extra)}>${options.map((o) => html`<option value="${o.value}" ${String(o.value) === String(value) ? 'selected' : ''}>${o.label}</option>`)}</select>`;

export const textarea = ({ name, value = '', placeholder = '', maxlength = 200 }) =>
  html`<textarea class="input" id="${name}" name="${name}" maxlength="${maxlength}" placeholder="${placeholder}">${value}</textarea>`;

export const field = ({ name, label, required = false, hint = '', span = false, control }) =>
  html`<div class="field ${span ? 'span-2' : ''}"><label class="label" for="${name}">${label}${required ? html`<span class="req" aria-hidden="true">*</span>` : ''}</label>${control}${hint ? html`<p class="hint">${hint}</p>` : ''}<p class="field-error hidden" data-err="${name}" role="alert"></p></div>`;

export const passwordControl = ({ name, autocomplete = 'new-password', placeholder = '' }) =>
  html`<div class="pw-wrap"><input class="input" id="${name}" name="${name}" type="password" autocomplete="${autocomplete}" placeholder="${placeholder}"><button type="button" class="pw-toggle" data-toggle-pw="${name}" aria-label="Show password">${ic('eye', 20)}</button></div>`;

/** Wires up show/hide buttons created by passwordControl(). */
export function bindPasswordToggles(root) {
  root.querySelectorAll('[data-toggle-pw]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const inp = root.querySelector(`#${btn.dataset.togglePw}`);
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      btn.innerHTML = icon(show ? 'eye-off' : 'eye', 20);
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
  });
}

/** Shows messages under fields. Pass {} to clear. Focuses the first invalid field. */
export function showFieldErrors(root, errors = {}) {
  root.querySelectorAll('.field-error').forEach((el) => { el.textContent = ''; el.classList.add('hidden'); });
  root.querySelectorAll('.input.error').forEach((el) => el.classList.remove('error'));
  let first = null;
  for (const [name, message] of Object.entries(errors)) {
    const err = root.querySelector(`[data-err="${CSS.escape(name)}"]`);
    if (err) { err.textContent = message; err.classList.remove('hidden'); }
    const inp = root.querySelector(`[name="${CSS.escape(name)}"]`);
    if (inp) { inp.classList.add('error'); first ??= inp; }
  }
  first?.focus();
}

export const formValues = (form) => Object.fromEntries(new FormData(form).entries());
