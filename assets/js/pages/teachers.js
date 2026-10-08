import { html, mount, ic, badge, emptyState, errorState, tableSkeleton, pager, pageHead, confirmDialog, toast, debounce, $, $$ } from '../ui.js';
import { get, patch, errMsg } from '../api.js';
import { formatDate } from '../format.js';

const actionLabel = (t) => (t.status === 'active' ? 'Deactivate' : t.status === 'pending' ? 'Approve' : 'Activate');
const STATUS_FILTERS = ['active', 'inactive', 'pending', 'rejected'];

export default async function teachersPage({ root, query }) {
  const q = { search: '', status: STATUS_FILTERS.includes(query.status) ? query.status : '', page: 1 };

  mount(root, html`
    ${pageHead('Teachers', 'Add, edit and manage teacher accounts.', html`<a class="btn btn-primary" href="#/teachers/new">${ic('plus', 16)} Add Teacher</a>`)}
    <section class="card">
      <div class="toolbar">
        <div class="search grow">${ic('search', 16)}<input class="input" id="search" type="search" placeholder="Search by name, teacher ID or subject" aria-label="Search teachers" autocomplete="off"></div>
        <select class="input" id="status" aria-label="Filter by status" style="width:auto"><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="pending">Pending approval</option><option value="rejected">Rejected</option></select>
        <button type="button" class="btn btn-ghost hidden" id="clear">${ic('x', 16)} Clear</button>
      </div>
      <div id="results"></div>
    </section>`);
  const results = $('#results', root), clearBtn = $('#clear', root);
  $('#status', root).value = q.status;
  let last = null;

  const hasFilters = () => q.search || q.status;

  async function load(first = false) {
    clearBtn.classList.toggle('hidden', !hasFilters());
    if (first || !last) mount(results, tableSkeleton(6, 7)); else results.classList.add('fade');
    try {
      last = await get('/teachers', { search: q.search, status: q.status, page: q.page, limit: 10 });
    } catch (error) {
      mount(results, errorState(errMsg(error, 'Unable to load teachers. Please try again.')));
      $('[data-retry]', results).addEventListener('click', () => load(true));
      return;
    }
    results.classList.remove('fade');
    render();
  }

  function render() {
    const teachers = last.data;
    if (!teachers.length) {
      mount(results, emptyState({
        icon: 'users', title: 'No teachers found.',
        text: hasFilters() ? 'Try a different search or clear the filters.' : 'Add your first teacher to get started.',
        action: hasFilters() ? html`<button type="button" class="btn btn-secondary" data-clear>Clear filters</button>` : html`<a class="btn btn-primary" href="#/teachers/new">${ic('plus', 16)} Add Teacher</a>`,
      }));
      $('[data-clear]', results)?.addEventListener('click', clear);
      return;
    }
    mount(results, html`<div class="table-scroll"><table class="table w900">
      <thead><tr><th>Teacher ID</th><th>Name</th><th>Email</th><th>Phone</th><th>Subject</th><th>Joining Date</th><th>Status</th><th class="right">Actions</th></tr></thead>
      <tbody>${teachers.map((t, i) => html`<tr>
        <td class="dim">${t.teacher_id}</td><td class="strong">${t.name}</td><td class="dim">${t.email}</td><td class="nowrap">${t.phone}</td>
        <td>${t.subject}</td><td class="nowrap">${formatDate(t.joining_date)}</td><td>${badge(t.status)}</td>
        <td><div class="actions">
          <a class="icon-btn" href="#/teachers/${t.id}" aria-label="View" title="View">${ic('eye')}</a>
          <a class="icon-btn" href="#/teachers/${t.id}/edit" aria-label="Edit" title="Edit">${ic('pencil')}</a>
          <button type="button" class="icon-btn warn" data-status="${i}" aria-label="${actionLabel(t)}" title="${actionLabel(t)}">${ic(t.status === 'active' ? 'user-minus' : 'user-check')}</button>
          ${t.status === 'pending' ? html`<button type="button" class="icon-btn danger" data-reject="${i}" aria-label="Reject registration" title="Reject registration">${ic('user-x')}</button>` : ''}</div></td></tr>`)}</tbody></table></div>${pager(last.pagination)}`);

    $$('[data-page]', results).forEach((b) => b.addEventListener('click', () => { q.page = Number(b.dataset.page); load(); }));
    $$('[data-status]', results).forEach((b) => b.addEventListener('click', () => toggleStatus(teachers[b.dataset.status])));
    $$('[data-reject]', results).forEach((b) => b.addEventListener('click', () => reject(teachers[b.dataset.reject])));
  }

  function toggleStatus(t) {
    const deactivating = t.status === 'active';
    const approving = t.status === 'pending';
    confirmDialog({
      title: deactivating ? 'Deactivate teacher?' : approving ? 'Approve registration?' : 'Activate teacher?',
      message: deactivating
        ? `${t.name} will no longer appear when marking attendance and will not be able to sign in. Their past records are kept.`
        : approving
          ? `${t.name} registered themselves. Once approved they can sign in and will appear in attendance sheets.`
          : `${t.name} will appear in attendance sheets again and can sign in.`,
      confirmLabel: deactivating ? 'Deactivate' : approving ? 'Approve' : 'Activate',
      variant: 'navy',
      onConfirm: async () => { const r = await patch(`/teachers/${t.id}/status`, { status: deactivating ? 'inactive' : 'active' }); toast.success(r.message); load(); },
    });
  }

  // Teachers are never deleted (their attendance history must stay). A registration can be rejected instead.
  function reject(t) {
    confirmDialog({
      title: 'Reject registration?',
      message: `${t.name}'s registration will be rejected and they will not be able to sign in. The record is kept, so you can approve it later if needed.`,
      confirmLabel: 'Reject',
      onConfirm: async () => {
        const r = await patch(`/teachers/${t.id}/status`, { status: 'rejected' });
        toast.success(r.message);
        load();
      },
    });
  }

  function clear() {
    q.search = ''; q.status = ''; q.page = 1;
    $('#search', root).value = ''; $('#status', root).value = '';
    load();
  }

  const onSearch = debounce((value) => { q.search = value.trim(); q.page = 1; load(); });
  $('#search', root).addEventListener('input', (e) => onSearch(e.target.value));
  $('#status', root).addEventListener('change', (e) => { q.status = e.target.value; q.page = 1; load(); });
  clearBtn.addEventListener('click', clear);
  await load(true);
}
