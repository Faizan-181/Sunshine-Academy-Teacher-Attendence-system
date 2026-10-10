import {
  html, mount, ic, badge, emptyState, errorState, tableSkeleton, pager, pageHead,
  field, input, select, textarea, showFieldErrors, setLoading, toast, confirmDialog, openModal, $, $$,
} from '../ui.js';
import { get, post, errMsg } from '../api.js';
import { state } from '../state.js';
import { formatDate } from '../format.js';

const STATUS_OPTIONS = [
  { value: '', label: 'All requests' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
];

const dateRange = (request) => request.start_date === request.end_date
  ? formatDate(request.start_date)
  : `${formatDate(request.start_date)} – ${formatDate(request.end_date)}`;

export default async function leaveRequests({ root }) {
  const isAdmin = state.user.role === 'admin';
  const filters = { status: isAdmin ? 'pending' : '' };
  let page = 1;
  let last = null;

  mount(root, html`${pageHead(
    isAdmin ? 'Leave Management' : 'My Leave',
    isAdmin ? 'Review teacher leave requests and their decisions.' : 'Request time off and follow your request status.',
    isAdmin ? html`<a class="btn btn-secondary" href="#/mark-attendance">${ic('clipboard-check', 16)} Mark attendance</a>` : '',
  )}
    <div class="stack">
      ${!isAdmin ? html`<section class="card"><div class="card-head"><h2>Request leave</h2></div><div class="card-body">
        <form id="leave-form" class="form-grid" novalidate style="max-width:760px">
          ${field({ name: 'start_date', label: 'First day', required: true, control: input({ name: 'start_date', type: 'date', extra: 'required' }) })}
          ${field({ name: 'end_date', label: 'Last day', required: true, control: input({ name: 'end_date', type: 'date', extra: 'required' }) })}
          ${field({ name: 'reason', label: 'Reason', required: true, hint: '3–500 characters. Share only the details needed for review.', span: true, control: textarea({ name: 'reason', maxlength: 500, placeholder: 'Briefly explain your leave request' }) })}
          <div class="span-2"><button type="submit" class="btn btn-primary" id="leave-submit">${ic('calendar-check', 16)} Submit request</button></div>
        </form>
      </div></section>` : ''}
      <div class="alert alert-info leave-info" role="note">${ic('info', 18)}<span>Approved requests are tracked here. To reflect leave in attendance, the administrator marks <b>Leave</b> for the actual academy working days in Mark Attendance.</span></div>
      <section class="card">
        <div class="toolbar"><form id="leave-filters" style="width:100%;max-width:320px" novalidate>
          ${field({ name: 'status', label: 'Request status', control: select({ name: 'status', value: filters.status, options: STATUS_OPTIONS }) })}
        </form></div>
        <div id="leave-list">${tableSkeleton(4, isAdmin ? 7 : 6)}</div>
      </section>
    </div>`);

  const list = $('#leave-list', root);
  const filterForm = $('#leave-filters', root);
  const requestForm = $('#leave-form', root);

  async function load() {
    if (!last) mount(list, tableSkeleton(4, isAdmin ? 7 : 6));
    else list.classList.add('fade');
    try {
      last = await get('/leave-requests', { ...filters, page, limit: 20 });
    } catch (error) {
      mount(list, errorState(errMsg(error, 'Unable to load leave requests. Please try again.')));
      $('[data-retry]', list)?.addEventListener('click', load);
      return;
    }
    list.classList.remove('fade');
    if (!last.data.length) {
      const title = isAdmin && filters.status === 'pending' ? 'No pending leave requests.' : 'No leave requests found.';
      mount(list, emptyState({ icon: 'calendar-x', title, text: isAdmin
        ? 'New teacher requests will appear here for review.'
        : 'Your leave requests and their decisions will appear here.' }));
      return;
    }

    const rows = last.data.map((request) => html`<tr>
      ${isAdmin ? html`<td><b>${request.teacher}</b><br><span class="muted">${request.teacher_code}</span></td>` : ''}
      <td class="nowrap strong">${dateRange(request)}</td>
      <td class="leave-reason" title="${request.reason}">${request.reason}</td>
      <td>${badge(request.status)}</td>
      <td class="leave-note">${request.review_note || '—'}</td>
      <td class="nowrap">${formatDate(String(request.created_at || '').slice(0, 10))}</td>
      <td><div class="leave-actions">
        ${isAdmin && request.status === 'pending' ? html`
          <button type="button" class="btn btn-primary btn-sm" data-review="approved" data-id="${request.id}">${ic('check-check', 14)} Approve</button>
          <button type="button" class="btn btn-secondary btn-sm" data-review="rejected" data-id="${request.id}">Reject</button>` : ''}
        ${isAdmin && request.status === 'approved' ? html`
          <button type="button" class="btn btn-secondary btn-sm" data-review="cancelled" data-id="${request.id}">Cancel approval</button>` : ''}
        ${!isAdmin && request.status === 'pending' ? html`
          <button type="button" class="btn btn-secondary btn-sm" data-cancel="${request.id}">Cancel request</button>` : ''}
        ${!(isAdmin && ['pending', 'approved'].includes(request.status)) && (isAdmin || request.status !== 'pending') ? '—' : ''}
      </div></td>
    </tr>`);

    mount(list, html`<div class="table-scroll"><table class="table leave-table">
      <thead><tr>${isAdmin ? html`<th>Teacher</th>` : ''}<th>Dates</th><th>Reason</th><th>Status</th><th>Admin note</th><th>Requested</th><th>Actions</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>${pager(last.pagination)}`);

    $$('[data-page]', list).forEach((button) => button.addEventListener('click', () => {
      page = Number(button.dataset.page);
      load();
    }));
    $$('[data-review]', list).forEach((button) => button.addEventListener('click', () => {
      const request = last.data.find((item) => String(item.id) === button.dataset.id);
      if (request) review(request, button.dataset.review);
    }));
    $$('[data-cancel]', list).forEach((button) => button.addEventListener('click', () => {
      const request = last.data.find((item) => String(item.id) === button.dataset.cancel);
      if (request) cancelRequest(request);
    }));
  }

  function review(request, decision) {
    const action = decision === 'approved' ? 'Approve leave' : decision === 'rejected' ? 'Reject leave' : 'Cancel approval';
    const modal = openModal({
      title: action,
      body: html`<p class="muted" style="margin-bottom:14px"><b>${request.teacher}</b> · ${dateRange(request)}<br>${request.reason}</p>
        <form id="review-form" novalidate>${field({ name: 'note', label: 'Note for teacher (optional)', control: textarea({ name: 'note', maxlength: 500, placeholder: 'Add a short explanation' }) })}</form>`,
      footer: html`<button type="button" class="btn btn-secondary" data-close>Keep request</button>
        <button type="button" class="btn ${decision === 'approved' ? 'btn-primary' : 'btn-navy'}" id="review-submit">${action}</button>`,
    });
    const button = modal.el.querySelector('#review-submit');
    button.addEventListener('click', async () => {
      setLoading(button, true);
      try {
        const note = modal.el.querySelector('#review-form').elements.note.value.trim();
        const result = await post(`/leave-requests/${request.id}/review`, { status: decision, note });
        modal.close();
        toast.success(result.message);
        await load();
      } catch (error) {
        toast.error(errMsg(error, 'Unable to update this leave request. Please try again.'));
        setLoading(button, false);
      }
    });
  }

  function cancelRequest(request) {
    confirmDialog({
      title: 'Cancel leave request?',
      message: `Your pending request for ${dateRange(request)} will be cancelled.`,
      confirmLabel: 'Cancel request',
      onConfirm: async () => {
        const result = await post(`/leave-requests/${request.id}/cancel`);
        toast.success(result.message);
        await load();
      },
    });
  }

  filterForm.elements.status.addEventListener('change', () => {
    filters.status = filterForm.elements.status.value;
    page = 1;
    last = null;
    load();
  });

  requestForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(requestForm).entries());
    const errors = {};
    if (!values.start_date) errors.start_date = 'Choose the first day of leave.';
    if (!values.end_date) errors.end_date = 'Choose the last day of leave.';
    if (values.start_date && values.end_date && values.end_date < values.start_date) errors.end_date = 'The last day cannot be before the first day.';
    if (values.reason.trim().length < 3 || values.reason.trim().length > 500) errors.reason = 'Enter a reason between 3 and 500 characters.';
    showFieldErrors(requestForm, errors);
    if (Object.keys(errors).length) return;

    const button = $('#leave-submit', root);
    setLoading(button, true);
    try {
      const result = await post('/leave-requests', values);
      requestForm.reset();
      filters.status = '';
      filterForm.elements.status.value = '';
      page = 1;
      last = null;
      toast.success(result.message);
      await load();
    } catch (error) {
      showFieldErrors(requestForm, error.errors || {});
      toast.error(errMsg(error, 'Unable to submit your leave request. Please try again.'));
    } finally {
      setLoading(button, false);
    }
  });

  await load();
}
