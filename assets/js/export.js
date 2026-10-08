import { formatDate, MONTH_NAMES } from './format.js';

const HEADERS = ['Teacher ID', 'Teacher', 'Subject', 'Working days', 'Present', 'Absent', 'Late', 'Leave', 'Attendance %'];
const toRow = (r) => [r.teacher.teacher_id, r.teacher.name, r.teacher.subject, r.totalDays, r.present, r.absent, r.late, r.leave, `${r.percentage}%`];

export const periodText = (p) => (p.from && p.to ? `${formatDate(p.from)} to ${formatDate(p.to)}` : 'All dates');

// Stops spreadsheet apps from running cells that start with = + - @ as formulas.
const cell = (v) => {
  const t = String(v ?? '');
  return `"${(/^[=+\-@]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`;
};

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

export function exportCsv(report, name) {
  const lines = [HEADERS, ...report.rows.map(toRow)].map((r) => r.map(cell).join(','));
  download(new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }), name);
}

const loadScript = (src) => new Promise((resolve, reject) => {
  if (document.querySelector(`script[src="${src}"]`)) return resolve();
  const s = Object.assign(document.createElement('script'), { src, onload: resolve, onerror: reject });
  document.head.appendChild(s);
});

export async function exportPdf(report, name) {
  // The PDF libraries are only loaded when someone actually exports a PDF.
  await loadScript('assets/vendor/jspdf.umd.min.js');
  await loadScript('assets/vendor/jspdf.plugin.autotable.min.js');
  const doc = new window.jspdf.jsPDF({ orientation: 'landscape' });
  doc.setFontSize(18); doc.setTextColor(10, 53, 88);
  doc.text('Sunshine Academy - Attendance Report', 14, 16);
  doc.setFontSize(10); doc.setTextColor(100, 112, 125);
  doc.text(`Period: ${periodText(report.period)}`, 14, 23);
  const t = report.totals;
  doc.text(`Overall: ${t.present} present, ${t.absent} absent, ${t.late} late, ${t.leave} on leave - ${t.percentage}% attendance`, 14, 29);
  doc.autoTable({
    head: [HEADERS], body: report.rows.map(toRow), startY: 35,
    headStyles: { fillColor: [10, 53, 88], textColor: 255 }, alternateRowStyles: { fillColor: [246, 247, 244] }, styles: { fontSize: 9 },
  });
  doc.save(name);
}

/** Any table of rows -> CSV (used by the backup downloads). */
export function downloadRowsCsv(headers, rows, name) {
  const lines = [headers, ...rows].map((r) => r.map(cell).join(','));
  download(new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }), name);
}

const YEAR_MONTH_HEAD = ['Month', 'Working days', 'Present', 'Absent', 'Late', 'Leave', 'Attendance %'];
const monthRow = (m) => [MONTH_NAMES[m.month - 1], m.totalDays, m.present, m.absent, m.late, m.leave, `${m.percentage}%`];

export function exportYearlyCsv(report, name) {
  const t = report.totals;
  const lines = [
    YEAR_MONTH_HEAD, ...report.months.map(monthRow),
    ['Whole year', t.totalDays, t.present, t.absent, t.late, t.leave, `${t.percentage}%`],
  ];
  if (report.teachers.length) lines.push([], HEADERS, ...report.teachers.map(toRow));
  download(new Blob(['\uFEFF' + lines.map((r) => r.map(cell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }), name);
}

export async function exportYearlyPdf(report, name) {
  await loadScript('assets/vendor/jspdf.umd.min.js');
  await loadScript('assets/vendor/jspdf.plugin.autotable.min.js');
  const doc = new window.jspdf.jsPDF({ orientation: 'landscape' });
  const t = report.totals;
  doc.setFontSize(18); doc.setTextColor(10, 53, 88);
  doc.text(`Sunshine Academy - Yearly Attendance Report ${report.year}`, 14, 16);
  doc.setFontSize(10); doc.setTextColor(100, 112, 125);
  doc.text(`Whole year: ${t.present} present, ${t.absent} absent, ${t.late} late, ${t.leave} on leave - ${t.percentage}% attendance`, 14, 23);
  const style = { headStyles: { fillColor: [10, 53, 88], textColor: 255 }, alternateRowStyles: { fillColor: [246, 247, 244] }, styles: { fontSize: 9 } };
  doc.autoTable({ head: [YEAR_MONTH_HEAD], body: report.months.map(monthRow), startY: 29, ...style });
  if (report.teachers.length) {
    doc.autoTable({ head: [HEADERS], body: report.teachers.map(toRow), startY: doc.lastAutoTable.finalY + 10, ...style });
  }
  doc.save(name);
}
