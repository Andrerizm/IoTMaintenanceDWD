const MACHINE_COUNT = 1;
const MOTORS_PER_MACHINE = 2;
const SEGMENT_COUNT = 24;
const MAX_HISTORY_POINTS = 40;

let motors = [];
let machinesData = [];
let summaryData = { total: 1, normal: 0, warning: 0, danger: 0, off: 0 };
let currentView = 'machines';
let selectedMachineId = 1;
let selectedMotorId = "1-1";

let warningLimit = 5;
let dangerLimit = 10;
let espTempWarning = 70;
let espTempDanger = 80;
let frequency = 50;
let trendChart = null;
let compareChart = null;
let selectedCompareMotorIds = [];
let selectedCompareMetric = 'capacitance';
let rangeFrom = null;
let rangeTo = null;
let intervalSeconds = 6;
const NOMINAL_CAPACITANCE = 2;
const CURRENT_BAR_MAX = 0.2;

function rand(min, max) { return Math.random() * (max - min) + min; }
function nowString() { return new Date().toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'medium' }); }

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function formatTs(iso, short) {
  const d = new Date(iso);
  if (short) {
    return d.toLocaleString('id-ID', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'medium' });
}

function applyRange() {
  const fromVal = document.getElementById('rangeFrom').value;
  const toVal = document.getElementById('rangeTo').value;
  rangeFrom = fromVal ? new Date(fromVal) : null;
  rangeTo = toVal ? new Date(toVal) : null;
  document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
  renderDetailView();
}

function resetRange() {
  document.getElementById('rangeFrom').value = '';
  document.getElementById('rangeTo').value = '';
  rangeFrom = null;
  rangeTo = null;
  document.querySelectorAll('.tf-btn').forEach(b => b.classList.toggle('active', Number(b.dataset.hours) === 0));

  // Kembalikan semua checklist grafik ke kondisi awal (nyala semua)
  document.querySelectorAll('.toggle-ds').forEach(chk => {
    chk.checked = true;
    if (trendChart) {
      trendChart.setDatasetVisibility(parseInt(chk.dataset.index, 10), true);
    }
  });

  renderDetailView();
}

function toDatetimeLocalValue(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function setTimeFrame(hours) {
  document.querySelectorAll('.tf-btn').forEach(b => b.classList.toggle('active', Number(b.dataset.hours) === hours));

  if (hours === 0) {
    rangeFrom = null;
    rangeTo = null;
    document.getElementById('rangeFrom').value = '';
    document.getElementById('rangeTo').value = '';
  } else {
    const now = new Date();
    const from = new Date(now.getTime() - hours * 3600 * 1000);
    rangeFrom = from;
    rangeTo = now;
    document.getElementById('rangeFrom').value = toDatetimeLocalValue(from);
    document.getElementById('rangeTo').value = toDatetimeLocalValue(now);
  }
  renderDetailView();
}

function createSegments(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '';
  for (let i = 0; i < SEGMENT_COUNT; i++) {
    const seg = document.createElement('div');
    seg.className = 'seg';
    el.appendChild(seg);
  }
}

function updateSegments(containerId, value, max) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const segs = Array.from(el.children);
  const litCount = Math.round((Math.min(value, max) / max) * SEGMENT_COUNT);
  segs.forEach((seg, i) => seg.classList.toggle('lit', i < litCount));
}

// --- Fetch API Data ---
async function fetchMachinesSummary() {
  try {
    const data = await apiFetch('/api/machines');
    summaryData = data.summary || summaryData;
    machinesData = data.machines || [];
    renderSummary();
    if (currentView === 'machines') renderMachineView();
  } catch (err) {
    console.error('Error fetching machines summary:', err);
  }
}

async function fetchMotorsForMachine(machineId) {
  try {
    const data = await apiFetch(`/api/machines/${machineId}/motors`);
    motors = data.motors || [];
    if (selectedCompareMotorIds.length === 0) {
      selectedCompareMotorIds = motors.map(m => m.id);
    }
    renderMotorView();
  } catch (err) {
    console.error('Error fetching motors:', err);
  }
}

function showContainer(containerId) {
  document.getElementById('viewMachines').classList.add('hidden');
  document.getElementById('viewMotors').classList.add('hidden');
  document.getElementById('viewDetails').classList.add('hidden');
  document.getElementById(containerId).classList.remove('hidden');
}

function goToMachines() {
  currentView = 'machines';
  showContainer('viewMachines');
  fetchMachinesSummary();
}

function goToMotors(machineId) {
  selectedMachineId = machineId;
  currentView = 'motors';
  selectedCompareMotorIds = [];
  document.getElementById('motorViewTitle').textContent = `MESIN ${String(machineId).padStart(2, '0')}`;
  showContainer('viewMotors');
  fetchMotorsForMachine(machineId);
}

function goToDetails(motorId) {
  selectedMotorId = motorId;
  currentView = 'details';
  showContainer('viewDetails');
  if (trendChart) trendChart.resize();
  renderDetailView();
}

function renderSummary() {
  document.getElementById('sumTotal').textContent = summaryData.total || 1;
  document.getElementById('sumNormal').textContent = summaryData.normal || 0;
  document.getElementById('sumWarning').textContent = summaryData.warning || 0;
  document.getElementById('sumDanger').textContent = summaryData.danger || 0;
  document.getElementById('sumOff').textContent = summaryData.off || 0;
  const elDisc = document.getElementById('sumDisconnected');
  if (elDisc) elDisc.textContent = summaryData.disconnected || 0;
}

function renderMachineView() {
  const grid = document.getElementById('machineGrid');
  if (!grid) return;
  let html = '';

  machinesData.forEach(m => {
    const isAnomaly = m.hasAnomaly ? 'anomaly-active' : '';
    const mPadded = escapeHtml(String(m.machineId).padStart(2, '0'));

    html += `
      <div class="card clickable-card ${isAnomaly}" data-action="goToMotors" data-machine-id="${m.machineId}">
        <div class="card-label">UNIT MESIN</div>
        <div class="card-value">${mPadded}</div>
        <div class="card-meta">Berisi ${escapeHtml(m.motorCount)} Motor Listrik</div>
        <div class="card-mini-stats">
          ${m.dangerCount > 0 ? `<div class="stat-pill dang">${escapeHtml(m.dangerCount)} Danger</div>` : ''}
          ${m.warningCount > 0 ? `<div class="stat-pill warn">${escapeHtml(m.warningCount)} Warn</div>` : ''}
          ${m.offCount > 0 ? `<div class="stat-pill" style="color:#787878; border: 1px solid #d8d8d8; background: var(--bg-card);">${escapeHtml(m.offCount)} Motor OFF</div>` : ''}
          ${(!m.hasAnomaly && m.offCount === 0 && m.motorCount > 0) ? `<div class="stat-pill" style="color:var(--green)">Semua Aman</div>` : ''}
          ${m.motorCount === 0 ? `<div class="stat-pill" style="color:#787878">Tidak ada motor</div>` : ''}
        </div>
      </div>
    `;
  });
  grid.innerHTML = html;
}

function renderMotorView() {
  const grid = document.getElementById('motorGrid');
  if (!grid) return;
  let html = '';

  let anyDisconnected = false;

  motors.forEach(m => {
    let isAnomaly = '';
    if (m.status === 'DANGER' || m.status === 'WARNING') isAnomaly = 'anomaly-active';
    else if (m.status === 'DISCONNECTED') {
      isAnomaly = 'disconnected-card-active';
      anyDisconnected = true;
    }

    const safeId = escapeHtml(m.id);
    const safeName = escapeHtml(m.name);
    const safeStatus = escapeHtml(m.status);
    const capDisplay = (m.status === 'DISCONNECTED') ? 'N/A' : escapeHtml(m.capacitance.toFixed(1));
    const isChecked = selectedCompareMotorIds.includes(m.id) ? 'checked' : '';

    html += `
      <div class="card clickable-card ${isAnomaly}" data-action="goToDetails" data-motor-id="${safeId}">
        <label class="compare-cb-label" onclick="event.stopPropagation()">
          <input type="checkbox" class="compare-cb" value="${safeId}" ${isChecked} />
          <span>Komparasi</span>
        </label>
        <div class="card-label">Kapasitansi (µF)</div>
        <div class="card-value" ${m.status === 'DISCONNECTED' ? 'style="color:var(--red,#ff4d4d)"' : ''}>${capDisplay}</div>
        <div class="card-meta" style="margin-top: 16px;">
          <strong style="color:var(--text)">${safeName}</strong> <br/>
          <span class="badge ${safeStatus}" style="margin-top:8px">${safeStatus}</span>
        </div>
      </div>
    `;
  });
  grid.innerHTML = html;

  document.querySelectorAll('.compare-cb').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const mId = e.target.value;
      if (e.target.checked) {
        if (!selectedCompareMotorIds.includes(mId)) selectedCompareMotorIds.push(mId);
      } else {
        selectedCompareMotorIds = selectedCompareMotorIds.filter(id => id !== mId);
      }
      updateCompareChart();
    });
  });

  const anySensorDisconnected = motors.some(m => m.machineId === selectedMachineId && m.status === 'SENSOR_DISCONNECTED');
  const anyEspOffline = motors.some(m => m.machineId === selectedMachineId && (m.status === 'ESP_OFFLINE' || m.status === 'DISCONNECTED'));

  const sBanner = document.getElementById('sensorDisconnectBanner');
  if (sBanner) sBanner.style.display = anySensorDisconnected ? 'block' : 'none';

  const eBanner = document.getElementById('espOfflineBanner');
  if (eBanner) eBanner.style.display = anyEspOffline ? 'block' : 'none';

  updateCompareChart();
}

async function renderDetailView() {
  let m = motors.find(mtr => mtr.id === selectedMotorId);
  if (!m) {
    try {
      const data = await apiFetch(`/api/motors/${selectedMotorId}`);
      m = data.motor;
    } catch { return; }
  }
  if (!m) return;

  document.getElementById('detailViewTitle').textContent = `${m.name} (MESIN ${String(m.machineId).padStart(2, '0')})`;
  document.getElementById('detailSubtitle').textContent = `Nominal: ${m.nominal} µF / Update: ${m.updatedAt}`;

  const isOff = (m.status === 'SENSOR_DISCONNECTED' || m.status === 'ESP_OFFLINE' || m.status === 'DISCONNECTED');
  document.getElementById('capValue').textContent = isOff ? 'N/A' : m.capacitance.toFixed(2);
  document.getElementById('currentValue').textContent = isOff ? 'N/A' : m.current.toFixed(3);
  document.getElementById('voltageValue').textContent = isOff ? 'N/A' : m.voltage.toFixed(1);
  document.getElementById('capMeta').textContent = `Status: ${m.status} / Error: ${m.error.toFixed(1)}%`;

  const espTemp = m.esp_temp || m.espTemp || 0;
  const espTempEl = document.getElementById('espTempValue');
  const espTempMetaEl = document.getElementById('espTempMeta');
  if (espTempEl) espTempEl.textContent = espTemp ? espTemp.toFixed(1) : '--';
  if (espTempMetaEl) {
    if (espTemp >= espTempDanger) espTempMetaEl.textContent = `Status Chip: DANGER Overheating (≥ ${espTempDanger}°C)`;
    else if (espTemp >= espTempWarning) espTempMetaEl.textContent = `Status Chip: WARNING Hangat (≥ ${espTempWarning}°C)`;
    else espTempMetaEl.textContent = `Status Chip: Normal (< ${espTempWarning}°C)`;
  }

  updateSegments('capBar', Math.max(0, 100 - m.error), 100);
  updateSegments('currentBar', m.current, CURRENT_BAR_MAX);
  updateSegments('voltageBar', m.voltage, 260);

  const isBad = (m.status === 'WARNING' || m.status === 'DANGER');
  document.getElementById('anomalyBanner').classList.toggle('active', isBad);
  document.getElementById('cardCapacitance').classList.toggle('anomaly-active', isBad);

  const isDisconnected = (m.status === 'DISCONNECTED');
  const discBanner = document.getElementById('sensorDisconnectBanner');
  if (discBanner) {
    discBanner.style.display = isDisconnected ? 'block' : 'none';
  }

  // Fetch History from Server
  let historyUrl = `/api/motors/${m.id}/history`;
  const params = [];
  if (rangeFrom) params.push(`from=${encodeURIComponent(rangeFrom.toISOString())}`);
  if (rangeTo) params.push(`to=${encodeURIComponent(rangeTo.toISOString())}`);
  if (params.length > 0) historyUrl += '?' + params.join('&');

  try {
    const histData = await apiFetch(historyUrl);
    const data = histData.history || [];

    if (trendChart) {
      trendChart.data.labels = data.map(d => formatTs(d.timestamp, true));
      trendChart.data.datasets[0].data = data.map(d => d.capacitance);
      trendChart.data.datasets[1].data = data.map(d => d.current);
      trendChart.data.datasets[2].data = data.map(d => d.voltage);
      if (trendChart.data.datasets.length > 3) {
        trendChart.data.datasets[3].data = data.map(d => d.power || 0);
        trendChart.data.datasets[4].data = data.map(d => d.pf || 0);
      }
      trendChart.update('none');

      const rangeInfo = document.getElementById('rangeInfo');
      if (!rangeFrom && !rangeTo) {
        rangeInfo.textContent = `Menampilkan seluruh data historis (${data.length} titik data)`;
      } else {
        const fromTxt = rangeFrom ? formatTs(rangeFrom.toISOString()) : 'awal data';
        const toTxt = rangeTo ? formatTs(rangeTo.toISOString()) : 'sekarang';
        rangeInfo.textContent = `Menampilkan ${data.length} titik data dari ${fromTxt} s/d ${toTxt}`;
      }
    }
  } catch (err) {
    console.error('Error loading history:', err);
  }

  // Render Machine Motors Table
  const tbody = document.getElementById('motorTable');
  if (tbody) {
    tbody.innerHTML = motors.map(mtr => `
      <tr class="row-clickable ${mtr.id === selectedMotorId ? 'row-active' : ''}" data-action="goToDetails" data-motor-id="${escapeHtml(mtr.id)}">
        <td>${escapeHtml(mtr.name)}</td>
        <td>${escapeHtml(mtr.motorStatus)}</td>
        <td>${escapeHtml(mtr.nominal.toFixed(0))} µF</td>
        <td>${escapeHtml(mtr.capacitance.toFixed(2))} µF</td>
        <td>${escapeHtml(mtr.error.toFixed(1))}%</td>
        <td>${escapeHtml(mtr.current.toFixed(3))} A</td>
        <td>${escapeHtml(mtr.voltage.toFixed(1))} V</td>
        <td>${escapeHtml((mtr.esp_temp || mtr.espTemp || 0).toFixed(1))} °C</td>
        <td><span class="badge ${escapeHtml(mtr.status)}">${escapeHtml(mtr.status)}</span></td>
        <td>${escapeHtml(mtr.updatedAt)}</td>
      </tr>
    `).join('');
  }
}

function initChart() {
  if (!window.Chart) return;
  Chart.defaults.font.family = "'Bekaert', 'Segoe UI', Tahoma, Arial, sans-serif";
  const ctx = document.getElementById('trendChart').getContext('2d');
  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'Kapasitansi (\u00B5F)', data: [], borderColor: '#1f9d46', backgroundColor: 'rgba(31, 157, 70, 0.15)', borderWidth: 2, tension: 0.3, pointRadius: 0, yAxisID: 'y', fill: false },
        { label: 'Arus (A)', data: [], borderColor: '#c98a00', backgroundColor: 'rgba(201, 138, 0, 0.15)', borderWidth: 2, tension: 0.3, pointRadius: 0, yAxisID: 'y1', fill: false },
        { label: 'Tegangan (V)', data: [], borderColor: '#1a5fc4', backgroundColor: 'rgba(26, 95, 196, 0.13)', borderWidth: 2, tension: 0.3, pointRadius: 0, yAxisID: 'y2', fill: false },
        { label: 'Daya (W)', data: [], borderColor: '#e63946', backgroundColor: 'rgba(230, 57, 70, 0.15)', borderWidth: 2, tension: 0.3, pointRadius: 0, yAxisID: 'y2', fill: false },
        { label: 'Power Factor', data: [], borderColor: '#6a040f', backgroundColor: 'rgba(106, 4, 15, 0.15)', borderWidth: 2, tension: 0.3, pointRadius: 0, yAxisID: 'y1', fill: false }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { ticks: { color: '#5c5c5c' }, grid: { color: '#d8d8d8' } },
        y: { type: 'linear', position: 'left', ticks: { color: '#5c5c5c' }, grid: { color: '#d8d8d8' } },
        y1: { type: 'linear', position: 'right', ticks: { color: '#5c5c5c' }, grid: { display: false } },
        y2: { display: false }
      },
      plugins: { legend: { labels: { color: '#1a1a1a' } } }
    }
  });

  const ctxCompare = document.getElementById('compareChart');
  if (ctxCompare) {
    compareChart = new Chart(ctxCompare.getContext('2d'), {
      type: 'line',
      data: { labels: [], datasets: [] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { ticks: { color: '#5c5c5c' }, grid: { color: '#d8d8d8' } },
          y: { ticks: { color: '#5c5c5c' }, grid: { color: '#d8d8d8' } }
        },
        plugins: { legend: { labels: { color: '#1a1a1a' } } }
      }
    });
  }
}

const COMPARE_COLORS = [
  { border: '#1f9d46', bg: 'rgba(31, 157, 70, 0.12)' },
  { border: '#1a5fc4', bg: 'rgba(26, 95, 196, 0.12)' },
  { border: '#ff9800', bg: 'rgba(255, 152, 0, 0.12)' },
  { border: '#e91e63', bg: 'rgba(233, 30, 99, 0.12)' },
  { border: '#9c27b0', bg: 'rgba(156, 39, 176, 0.12)' },
  { border: '#00bcd4', bg: 'rgba(0, 188, 212, 0.12)' }
];

async function updateCompareChart() {
  if (!compareChart) return;
  const subtitleEl = document.getElementById('compareSubtitle');

  if (!selectedCompareMotorIds || selectedCompareMotorIds.length === 0) {
    compareChart.data.labels = [];
    compareChart.data.datasets = [];
    compareChart.update();
    if (subtitleEl) subtitleEl.textContent = 'Centang minimal 1 motor di atas untuk menampilkan grafik komparasi.';
    return;
  }

  const metricSelect = document.getElementById('compareMetricSelect');
  const metric = metricSelect ? metricSelect.value : 'capacitance';
  selectedCompareMetric = metric;

  let metricLabel = 'Kapasitansi (µF)';
  if (metric === 'error') metricLabel = 'Persentase Error (%)';
  else if (metric === 'current') metricLabel = 'Arus Kapasitor (A)';
  else if (metric === 'voltage') metricLabel = 'Tegangan Kapasitor (V)';
  else if (metric === 'power') metricLabel = 'Daya (W)';
  else if (metric === 'pf') metricLabel = 'Power Factor / Faktor Daya';
  else if (metric === 'espTemp') metricLabel = 'Suhu ESP32 (°C)';

  if (subtitleEl) {
    subtitleEl.textContent = `Membandingkan ${selectedCompareMotorIds.length} motor (${metricLabel})`;
  }

  try {
    const promises = selectedCompareMotorIds.map(async id => {
      let url = `/api/motors/${id}/history`;
      const params = [];
      if (rangeFrom) params.push(`from=${encodeURIComponent(rangeFrom.toISOString())}`);
      if (rangeTo) params.push(`to=${encodeURIComponent(rangeTo.toISOString())}`);
      params.push('limit=500');
      if (params.length > 0) url += '?' + params.join('&');

      const data = await apiFetch(url);
      const mObj = motors.find(mtr => mtr.id === id);
      return {
        id,
        name: mObj ? mObj.name : id,
        history: data.history || []
      };
    });

    const results = await Promise.all(promises);

    let allTimestamps = [];
    results.forEach(res => {
      res.history.forEach(h => {
        if (!allTimestamps.includes(h.timestamp)) {
          allTimestamps.push(h.timestamp);
        }
      });
    });
    allTimestamps.sort();

    const labels = allTimestamps.map(ts => formatTs(ts, true));

    const datasets = results.map((res, index) => {
      const color = COMPARE_COLORS[index % COMPARE_COLORS.length];
      const dataMap = new Map();
      res.history.forEach(h => {
        let val = h.capacitance;
        if (metric === 'error') {
          const NOMINAL = 2.0;
          val = (h.capacitance < NOMINAL && NOMINAL > 0) ? ((NOMINAL - h.capacitance) / NOMINAL) * 100 : 0;
        } else if (metric === 'current') val = h.current;
        else if (metric === 'voltage') val = h.voltage;
        else if (metric === 'power') val = h.power || 0;
        else if (metric === 'pf') val = h.pf || 0;
        else if (metric === 'espTemp') val = h.espTemp || 0;

        dataMap.set(h.timestamp, val);
      });

      const series = allTimestamps.map(ts => dataMap.has(ts) ? dataMap.get(ts) : null);

      return {
        label: `${res.name} (Motor ${res.id})`,
        data: series,
        borderColor: color.border,
        backgroundColor: color.bg,
        borderWidth: 2,
        tension: 0.3,
        pointRadius: 0,
        fill: false
      };
    });

    compareChart.data.labels = labels;
    compareChart.data.datasets = datasets;
    compareChart.update('none');
  } catch (err) {
    console.error('Error updating comparison chart:', err);
  }
}

function exportMachinePDF() {
  if (!window.jspdf) { alert('jsPDF belum termuat.'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('l', 'mm', 'a4');
  const dangerCount = motors.filter(mtr => mtr.status === 'DANGER').length;
  const warningCount = motors.filter(mtr => mtr.status === 'WARNING').length;
  const offCount = motors.filter(mtr => mtr.status === 'OFF').length;
  const normalCount = motors.length - dangerCount - warningCount - offCount;

  doc.setFont('times', 'bold'); doc.setFontSize(14);
  doc.text('LAPORAN MONITORING KAPASITOR MOTOR', 148.5, 18, { align: 'center' });
  doc.setFontSize(11);
  doc.text('BEKAERT INDONESIA - Engineering & Maintenance', 148.5, 25, { align: 'center' });
  doc.setLineWidth(0.5); doc.line(15, 30, 282, 30);

  doc.setFont('times', 'normal'); doc.setFontSize(10);
  doc.text(`Unit Mesin: ${String(selectedMachineId).padStart(2, '0')}`, 15, 39);
  doc.text(`Waktu Cetak: ${new Date().toLocaleString('id-ID')}`, 15, 45);
  doc.text(`Ringkasan: ${normalCount} Normal / ${warningCount} Warning / ${dangerCount} Danger / ${offCount} OFF`, 15, 51);

  doc.autoTable({
    head: [['Motor', 'Status Motor', 'Nominal', 'Kapasitansi', 'Error', 'Arus C', 'Tegangan C', 'Status Kapasitor', 'Update']],
    body: motors.map(m => [
      m.name, m.motorStatus, `${m.nominal.toFixed(0)} µF`, `${m.capacitance.toFixed(2)} µF`,
      `${m.error.toFixed(1)}%`, `${m.current.toFixed(3)} A`, `${m.voltage.toFixed(1)} V`, m.status, m.updatedAt
    ]),
    startY: 57,
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 9, textColor: [26, 26, 26], lineColor: [153, 153, 153], lineWidth: 0.3, cellPadding: 3 },
    headStyles: { fillColor: [0, 70, 173], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [242, 242, 242] },
    margin: { left: 15, right: 15 },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 7) {
        const val = data.cell.raw;
        if (val === 'DANGER') { data.cell.styles.textColor = [178, 30, 30]; data.cell.styles.fontStyle = 'bold'; }
        else if (val === 'WARNING') { data.cell.styles.textColor = [173, 120, 0]; data.cell.styles.fontStyle = 'bold'; }
        else if (val === 'OFF') { data.cell.styles.textColor = [120, 120, 120]; }
      }
    },
    didDrawPage: () => {
      const pageCount = doc.internal.getNumberOfPages();
      doc.setFontSize(8); doc.setTextColor(120, 120, 120);
      doc.text(`Halaman ${doc.internal.getCurrentPageInfo().pageNumber} / ${pageCount}`, 262, doc.internal.pageSize.getHeight() - 10);
    }
  });

  doc.save(`Laporan_Mesin${String(selectedMachineId).padStart(2, '0')}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

async function downloadPDF() {
  if (!window.jspdf || !trendChart) { alert('jsPDF atau Chart.js belum termuat.'); return; }
  const { jsPDF } = window.jspdf; const doc = new jsPDF('p', 'mm', 'a4');
  let m = motors.find(mtr => mtr.id === selectedMotorId);
  if (!m) return;

  let historyUrl = `/api/motors/${m.id}/history`;
  const params = [];
  if (rangeFrom) params.push(`from=${encodeURIComponent(rangeFrom.toISOString())}`);
  if (rangeTo) params.push(`to=${encodeURIComponent(rangeTo.toISOString())}`);
  if (params.length > 0) historyUrl += '?' + params.join('&');

  const histData = await apiFetch(historyUrl);
  const filteredData = histData.history || [];
  const canvas = document.getElementById('trendChart'); const imgData = canvas.toDataURL('image/png', 1.0);

  doc.setFont('times', 'bold'); doc.setFontSize(14); doc.text('LAPORAN MONITORING KAPASITOR MOTOR', 105, 20, { align: 'center' });
  doc.setFontSize(11); doc.text('BEKAERT INDONESIA - Engineering & Maintenance', 105, 27, { align: 'center' });
  doc.setLineWidth(0.5); doc.line(15, 34, 195, 34);
  doc.setFont('times', 'normal'); doc.setFontSize(10);
  doc.text(`Unit Mesin: ${m.machineId} | Motor: ${m.name}`, 15, 44); doc.text(`Status Motor: ${m.motorStatus}`, 15, 50); doc.text(`Nominal Kapasitor: ${m.nominal} µF`, 15, 56);
  doc.text(`Hasil Estimasi: ${m.capacitance.toFixed(2)} µF`, 15, 62); doc.text(`Error: ${m.error.toFixed(1)}%`, 15, 68);
  doc.text(`Status Kapasitor: ${m.status}`, 15, 74); doc.text(`Suhu ESP32: ${(m.esp_temp || m.espTemp || 0).toFixed(1)} °C`, 15, 80); doc.text(`Waktu Cetak: ${new Date().toLocaleString('id-ID')}`, 15, 86);

  const rangeTxt = (!rangeFrom && !rangeTo)
    ? 'Seluruh data historis yang tersimpan'
    : `${rangeFrom ? formatTs(rangeFrom.toISOString()) : 'awal data'}  s/d  ${rangeTo ? formatTs(rangeTo.toISOString()) : 'sekarang'}`;
  doc.text(`Rentang Waktu Filter: ${rangeTxt} (${filteredData.length} titik data)`, 15, 92);

  doc.setFont('times', 'bold'); doc.text('A. Grafik Tren Kapasitansi, Arus, dan Tegangan', 15, 102);
  const pdfWidth = 170; const imgProps = doc.getImageProperties(imgData); const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
  doc.addImage(imgData, 'PNG', 20, 108, pdfWidth, pdfHeight);
  let y = 108 + pdfHeight + 12; doc.setFont('times', 'bold'); doc.text('B. Catatan Perhitungan', 15, y);
  doc.setFont('times', 'normal'); doc.text('Kapasitansi dihitung dari arus kapasitor dan tegangan terminal kapasitor:', 20, y + 8);
  doc.text('CµF = I / (2 × π × f × V) × 1.000.000', 20, y + 15);

  y = y + 25;
  doc.setFont('times', 'bold'); doc.text('C. Tabel Data Historis pada Rentang Terpilih', 15, y);

  doc.autoTable({
    head: [['Waktu', 'Kapasitansi (µF)', 'Arus (A)', 'Tegangan (V)', 'Suhu ESP32 (°C)']],
    body: filteredData.map(d => [formatTs(d.timestamp), d.capacitance.toFixed(2), d.current.toFixed(3), d.voltage.toFixed(1), (d.espTemp || 0).toFixed(1)]),
    startY: y + 5,
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8, textColor: [26, 26, 26], lineColor: [153, 153, 153], lineWidth: 0.3, cellPadding: 3 },
    headStyles: { fillColor: [0, 70, 173], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [242, 242, 242] },
    margin: { left: 15, right: 15 },
    didDrawPage: () => {
      const pageCount = doc.internal.getNumberOfPages();
      doc.setFontSize(8); doc.setTextColor(120, 120, 120);
      doc.text(`Halaman ${doc.internal.getCurrentPageInfo().pageNumber} / ${pageCount}`, 175, doc.internal.pageSize.getHeight() - 10);
    }
  });

  const fileSuffix = (!rangeFrom && !rangeTo) ? '' : `_${new Date().toISOString().slice(0, 10)}`;
  doc.save(`Laporan_Mesin${m.machineId}_${m.name}${fileSuffix}.pdf`);
}

// --- Excel/CSV Export Functions ---
function downloadCSV(csvContent, filename) {
  const BOM = '\uFEFF'; // UTF-8 BOM agar Excel baca karakter Indonesia dengan benar
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeCSV(val) {
  const str = String(val == null ? '' : val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

async function exportHistoryExcel() {
  const m = motors.find(mtr => mtr.id === selectedMotorId);
  if (!m) { alert('Pilih motor terlebih dahulu.'); return; }

  let historyUrl = `/api/motors/${m.id}/history`;
  const params = [];
  if (rangeFrom) params.push(`from=${encodeURIComponent(rangeFrom.toISOString())}`);
  if (rangeTo) params.push(`to=${encodeURIComponent(rangeTo.toISOString())}`);
  if (params.length > 0) historyUrl += '?' + params.join('&');

  try {
    const histData = await apiFetch(historyUrl);
    const data = histData.history || [];
    if (data.length === 0) { alert('Tidak ada data historis untuk diekspor.'); return; }

    const headers = ['Tanggal', 'Waktu', 'Motor ID', 'Nama Motor', 'Mesin', 'Nominal (µF)', 'Kapasitansi (µF)', 'Arus (A)', 'Tegangan (V)', 'Daya (W)', 'Power Factor', 'Suhu ESP32 (°C)', 'Error (%)', 'Status'];
    const rows = data.map(d => {
      const dt = new Date(d.timestamp);
      const tanggal = dt.toLocaleDateString('id-ID');
      const waktu = dt.toLocaleTimeString('id-ID');
      const cap = d.capacitance;
      const errPct = (cap < m.nominal && m.nominal > 0) ? ((m.nominal - cap) / m.nominal) * 100 : 0;
      let status = 'NORMAL';
      if (errPct >= dangerLimit) status = 'DANGER';
      else if (errPct >= warningLimit) status = 'WARNING';

      return [tanggal, waktu, m.id, m.name, m.machineId, m.nominal, cap.toFixed(4), d.current.toFixed(4), d.voltage.toFixed(2), (d.power || 0).toFixed(3), (d.pf || 0).toFixed(3), (d.espTemp || 0).toFixed(1), errPct.toFixed(2), status].map(escapeCSV).join(',');
    });

    const csv = headers.map(escapeCSV).join(',') + '\n' + rows.join('\n');
    const dateSuffix = new Date().toISOString().slice(0, 10);
    downloadCSV(csv, `Data_Motor_${m.name}_Mesin${m.machineId}_${dateSuffix}.csv`);
  } catch (err) {
    console.error('Export Excel error:', err);
    alert('Gagal mengekspor data: ' + err.message);
  }
}

function exportMachineExcel() {
  if (!motors || motors.length === 0) { alert('Tidak ada data motor untuk diekspor.'); return; }

  const headers = ['Motor ID', 'Nama Motor', 'Mesin', 'Status Motor', 'Nominal (µF)', 'Kapasitansi (µF)', 'Error (%)', 'Arus (A)', 'Tegangan (V)', 'Daya (W)', 'Power Factor', 'Status Kapasitor', 'Update Terakhir'];
  const rows = motors.map(m => {
    return [m.id, m.name, m.machineId, m.motorStatus, m.nominal, m.capacitance.toFixed(4), m.error.toFixed(2), m.current.toFixed(4), m.voltage.toFixed(2), (m.power || 0).toFixed(3), (m.pf || 0).toFixed(3), m.status, m.updatedAt].map(escapeCSV).join(',');
  });

  const csv = headers.map(escapeCSV).join(',') + '\n' + rows.join('\n');
  const dateSuffix = new Date().toISOString().slice(0, 10);
  downloadCSV(csv, `Data_Mesin${selectedMachineId}_${dateSuffix}.csv`);
}

document.addEventListener('DOMContentLoaded', async () => {
  // Logo fallback handler
  const brandLogo = document.getElementById('brandLogo');
  if (brandLogo) {
    brandLogo.addEventListener('error', () => {
      brandLogo.style.display = 'none';
      document.getElementById('logoFallback').style.display = 'flex';
    });
  }

  const loginLogoImg = document.getElementById('loginLogoImg');
  if (loginLogoImg) {
    loginLogoImg.addEventListener('error', () => {
      loginLogoImg.style.display = 'none';
      const fallback = document.getElementById('loginFallbackIcon');
      if (fallback) fallback.style.display = 'flex';
    });
  }

  // Password visibility toggle buttons (👁️ / 🙈)
  document.querySelectorAll('.toggle-password').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (!input) return;

      if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
        btn.title = 'Sembunyikan Password';
      } else {
        input.type = 'password';
        btn.textContent = '👁️';
        btn.title = 'Lihat Password';
      }
    });
  });

  // --- Auth Tab Switching ---
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      document.getElementById('loginForm').style.display = target === 'login' ? 'block' : 'none';
      document.getElementById('registerForm').style.display = target === 'register' ? 'block' : 'none';
      document.getElementById('loginError').classList.remove('visible');
      document.getElementById('loginError').textContent = '';
    });
  });

  function showLoginError(msg) {
    const el = document.getElementById('loginError');
    el.textContent = msg;
    el.classList.add('visible');
  }

  function hideLoginOverlay() {
    const overlay = document.getElementById('loginOverlay');
    overlay.classList.add('fade-out');
    setTimeout(() => { overlay.style.display = 'none'; }, 400);
  }

  // --- Login Form Submit ---
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const identifier = document.getElementById('loginIdentifier').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!identifier || !password) { showLoginError('Username/email dan password wajib diisi.'); return; }

    const btn = document.getElementById('btnLogin');
    btn.disabled = true;
    btn.textContent = '⏳ Memproses...';

    const result = await attemptLogin(identifier, password);
    btn.disabled = false;
    btn.textContent = '🔐 MASUK KE DASHBOARD';

    if (result.success) {
      hideLoginOverlay();
      showDashboard(result.session);
    } else {
      showLoginError(result.error);
    }
  });

  // --- Register Form Submit ---
  document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('regUsername').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const displayName = document.getElementById('regDisplayName').value.trim();
    const password = document.getElementById('regPassword').value;

    if (!username || !email || !password) { showLoginError('Username, email, dan password wajib diisi.'); return; }
    if (username.length < 3) { showLoginError('Username minimal 3 karakter.'); return; }
    if (password.length < 4) { showLoginError('Password minimal 4 karakter.'); return; }

    const btn = document.getElementById('btnRegister');
    btn.disabled = true;
    btn.textContent = '⏳ Mendaftar...';

    const result = await attemptRegister(username, email, password, displayName);
    btn.disabled = false;
    btn.textContent = '📝 DAFTAR & MASUK';

    if (result.success) {
      hideLoginOverlay();
      showDashboard(result.session);
    } else {
      showLoginError(result.error);
    }
  });

  // --- Check Existing Session ---
  const existingSession = getSession();
  if (existingSession) {
    hideLoginOverlay();
    showDashboard(existingSession);
  }

  // --- Show Dashboard ---
  function showDashboard(session) {
    document.getElementById('dashboardContent').classList.remove('hidden');

    // Update user info in topbar
    const avatarEl = document.getElementById('userAvatar');
    if (avatarEl) avatarEl.textContent = (session.displayName || session.username).charAt(0).toUpperCase();

    document.getElementById('userName').textContent = session.displayName || session.username;
    document.getElementById('userRole').textContent = `${session.role} (${session.email || ''})`;

    // Show logout button for all users
    document.getElementById('btnLogout').classList.remove('hidden');

    // Show management buttons
    if (session.role === 'Admin' || session.role === 'Supervisor') {
      const btnUser = document.getElementById('btnUserMgmt');
      if (btnUser) btnUser.classList.remove('hidden');
      const btnSet = document.getElementById('btnSettings');
      if (btnSet) btnSet.classList.remove('hidden');
      const btnAddM = document.getElementById('btnAddMotorModal');
      if (btnAddM) btnAddM.classList.remove('hidden');
    }
    if (session.role === 'Admin') {
      const btnAudit = document.getElementById('btnAuditLog');
      if (btnAudit) btnAudit.classList.remove('hidden');
    }

    // Ensure export buttons are visible for all authenticated roles
    const b1 = document.getElementById('btnExportPDF');
    const b2 = document.getElementById('btnDownloadPDF');
    if (b1) b1.style.display = '';
    if (b2) b2.style.display = '';

    // Initialize UI
    ['capBar', 'currentBar', 'voltageBar'].forEach(createSegments);
    initChart();
    fetchSettings();
    goToMachines();

    // Connect SSE Live Telemetry Stream with auto-reconnect
    let sseConnected = false;

    function connectSSE() {
      try {
        const origin = (typeof getBackendOrigin === 'function') ? getBackendOrigin() : '';
        const evtSource = new EventSource(`${origin}/api/telemetry/stream`);

        evtSource.addEventListener('telemetry_tick', () => {
          sseConnected = true;
          if (currentView === 'machines') fetchMachinesSummary();
          else if (currentView === 'motors') fetchMotorsForMachine(selectedMachineId);
          else if (currentView === 'details') renderDetailView();
        });
        evtSource.addEventListener('telemetry_update', () => {
          sseConnected = true;
          if (currentView === 'machines') fetchMachinesSummary();
          else if (currentView === 'motors') fetchMotorsForMachine(selectedMachineId);
          else if (currentView === 'details') renderDetailView();
        });

        evtSource.addEventListener('open', () => {
          sseConnected = true;
          console.log('SSE connected');
          document.getElementById('statusDot').classList.add('online');
          document.getElementById('statusText').textContent = 'TERHUBUNG KE SERVER';
        });

        evtSource.addEventListener('error', () => {
          sseConnected = false;
          console.warn('SSE disconnected, will auto-reconnect...');
          document.getElementById('statusDot').classList.remove('online');
          document.getElementById('statusText').textContent = 'KONEKSI TERPUTUS — RECONNECTING...';
          evtSource.close();
          setTimeout(connectSSE, 5000); // Reconnect after 5 seconds
        });
      } catch (err) {
        console.warn('SSE EventSource error:', err);
        sseConnected = false;
        setTimeout(connectSSE, 5000);
      }
    }

    connectSSE();

    // Fallback polling setiap 5 detik jika SSE terputus
    setInterval(() => {
      if (!sseConnected) {
        if (currentView === 'machines') fetchMachinesSummary();
        else if (currentView === 'motors') fetchMotorsForMachine(selectedMachineId);
        else if (currentView === 'details') renderDetailView();
      }
    }, 5000);
  }

  // --- Logout ---
  document.getElementById('btnLogout').addEventListener('click', () => {
    if (!confirm('Yakin ingin logout?')) return;
    logout();
    // Show login overlay again
    const overlay = document.getElementById('loginOverlay');
    overlay.style.display = 'flex';
    overlay.classList.remove('fade-out');
    document.getElementById('dashboardContent').classList.add('hidden');
    // Reset login form
    document.getElementById('loginForm').reset();
    document.getElementById('registerForm').reset();
    document.getElementById('loginError').classList.remove('visible');
    document.getElementById('loginError').textContent = '';
    // Reset tabs to login
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    document.getElementById('tabLogin').classList.add('active');
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('registerForm').style.display = 'none';
  });

  // --- Navigation buttons ---
  document.getElementById('btnBackToMachines').addEventListener('click', () => goToMachines());
  document.getElementById('btnBackToMotors').addEventListener('click', () => goToMotors(selectedMachineId));

  // Event delegation for dynamic cards/rows
  document.addEventListener('click', (e) => {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.action;
    if (action === 'goToMotors') {
      const machineId = Number(actionEl.dataset.machineId);
      if (machineId) goToMotors(machineId);
    } else if (action === 'goToDetails') {
      const motorId = actionEl.dataset.motorId;
      if (motorId) goToDetails(motorId);
    } else if (action === 'resetPw') {
      handleResetPassword(actionEl.dataset.username);
    } else if (action === 'deleteUser') {
      handleDeleteUser(actionEl.dataset.username);
    }
  });

  // --- Export buttons ---
  document.getElementById('btnExportPDF').addEventListener('click', () => {
    if (!canExportPDF()) { alert('Anda tidak memiliki izin untuk export PDF.'); return; }
    exportMachinePDF();
  });
  document.getElementById('btnDownloadPDF').addEventListener('click', () => {
    if (!canExportPDF()) { alert('Anda tidak memiliki izin untuk export PDF.'); return; }
    downloadPDF();
  });
  document.getElementById('btnDownloadExcel').addEventListener('click', () => {
    if (!canExportPDF()) { alert('Anda tidak memiliki izin untuk export.'); return; }
    exportHistoryExcel();
  });
  document.getElementById('btnExportExcel').addEventListener('click', () => {
    if (!canExportPDF()) { alert('Anda tidak memiliki izin untuk export.'); return; }
    exportMachineExcel();
  });

  // --- Compare Metric Select Listener ---
  const compareMetricSel = document.getElementById('compareMetricSelect');
  if (compareMetricSel) {
    compareMetricSel.addEventListener('change', () => {
      updateCompareChart();
    });
  }

  // --- Settings ---
  document.getElementById('btnApplyRange').addEventListener('click', () => applyRange());
  document.getElementById('btnResetRange').addEventListener('click', () => resetRange());

  document.querySelectorAll('.tf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const hours = Number(btn.dataset.hours);
      setTimeFrame(hours);
    });
  });

  document.getElementById('chartTypeSelect').addEventListener('change', (e) => {
    if (!trendChart) return;
    const selectedType = e.target.value;
    if (selectedType === 'area') { trendChart.config.type = 'line'; trendChart.data.datasets.forEach(ds => ds.fill = true); }
    else if (selectedType === 'line') { trendChart.config.type = 'line'; trendChart.data.datasets.forEach(ds => ds.fill = false); }
    else if (selectedType === 'bar') { trendChart.config.type = 'bar'; trendChart.data.datasets.forEach(ds => ds.fill = false); }
    trendChart.update();
  });

  // Dataset Toggle Listeners
  document.querySelectorAll('.toggle-ds').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      if (!trendChart) return;
      const index = parseInt(e.target.dataset.index, 10);
      trendChart.setDatasetVisibility(index, e.target.checked);
      trendChart.update();
    });
  });

  // =========================================================================
  // ADMIN PANELS
  // =========================================================================

  // --- Audit Log Panel ---
  document.getElementById('btnAuditLog').addEventListener('click', () => {
    if (!canViewAuditLog()) return;
    document.getElementById('viewAuditLog').classList.toggle('hidden');
    document.getElementById('viewUserMgmt').classList.add('hidden');
    renderAuditLogTable('auditLogTable');
  });
  document.getElementById('btnCloseAudit').addEventListener('click', () => {
    document.getElementById('viewAuditLog').classList.add('hidden');
  });
  document.getElementById('btnRefreshAudit').addEventListener('click', () => {
    const filters = getAuditFilters();
    renderAuditLogTable('auditLogTable', filters);
  });
  document.getElementById('btnExportAudit').addEventListener('click', () => {
    exportAuditLogJSON();
  });
  document.getElementById('btnClearAudit').addEventListener('click', async () => {
    if (!confirm('Yakin ingin menghapus semua audit log di server?')) return;
    await clearAuditLogs();
    renderAuditLogTable('auditLogTable');
  });
  document.getElementById('btnApplyAuditFilter').addEventListener('click', () => {
    const filters = getAuditFilters();
    renderAuditLogTable('auditLogTable', filters);
  });
  document.getElementById('btnResetAuditFilter').addEventListener('click', () => {
    document.getElementById('auditFilterAction').value = '';
    document.getElementById('auditFilterUser').value = '';
    renderAuditLogTable('auditLogTable');
  });

  function getAuditFilters() {
    const action = document.getElementById('auditFilterAction').value.trim();
    const username = document.getElementById('auditFilterUser').value.trim();
    const filters = {};
    if (action) filters.action = action;
    if (username) filters.username = username;
    return Object.keys(filters).length > 0 ? filters : null;
  }

  // --- User Management Panel ---
  document.getElementById('btnUserMgmt').addEventListener('click', () => {
    if (!canManageUsers()) return;
    document.getElementById('viewUserMgmt').classList.toggle('hidden');
    document.getElementById('viewAuditLog').classList.add('hidden');
    renderUserTable('userMgmtTable');
  });
  document.getElementById('btnCloseUserMgmt').addEventListener('click', () => {
    document.getElementById('viewUserMgmt').classList.add('hidden');
  });

  document.getElementById('btnAddUser').addEventListener('click', async () => {
    const username = document.getElementById('newUsername').value.trim();
    const email = document.getElementById('newEmail').value.trim();
    const displayName = document.getElementById('newDisplayName').value.trim();
    const password = document.getElementById('newPassword').value;
    const role = document.getElementById('newRole').value;

    if (!username || !email || !password) {
      alert('Username, Email, dan Password wajib diisi.');
      return;
    }

    try {
      const data = await apiFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify({ username, email, password, role, displayName })
      });
      document.getElementById('newUsername').value = '';
      document.getElementById('newEmail').value = '';
      document.getElementById('newDisplayName').value = '';
      document.getElementById('newPassword').value = '';
      renderUserTable('userMgmtTable');
      alert(`User "${username}" (${email}) berhasil ditambahkan.`);
    } catch (err) {
      alert(err.message || 'Gagal menambahkan user.');
    }
  });

  async function handleResetPassword(username) {
    const newPw = prompt(`Masukkan password baru untuk "${username}":`);
    if (!newPw) return;
    try {
      await apiFetch(`/api/users/${encodeURIComponent(username)}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ newPassword: newPw })
      });
      alert(`Password untuk "${username}" berhasil direset.`);
    } catch (err) {
      alert(err.message || 'Gagal reset password.');
    }
  }

  // --- Settings Panel ---
  async function fetchSettings() {
    try {
      const res = await apiFetch('/api/settings');
      if (res.success && res.settings) {
        warningLimit = res.settings.warningLimit || 5.0;
        dangerLimit = res.settings.dangerLimit || 10.0;
        espTempWarning = res.settings.espTempWarning || 70.0;
        espTempDanger = res.settings.espTempDanger || 80.0;

        const elW = document.getElementById('setWarningLimit');
        const elD = document.getElementById('setDangerLimit');
        const elTW = document.getElementById('setEspTempWarning');
        const elTD = document.getElementById('setEspTempDanger');

        if (elW) elW.value = warningLimit;
        if (elD) elD.value = dangerLimit;
        if (elTW) elTW.value = espTempWarning;
        if (elTD) elTD.value = espTempDanger;
      }
    } catch (err) {
      console.error('Gagal mengambil settings:', err);
    }
  }

  const btnSettings = document.getElementById('btnSettings');
  if (btnSettings) {
    btnSettings.addEventListener('click', () => {
      document.getElementById('viewSettings').classList.toggle('hidden');
      document.getElementById('viewUserMgmt').classList.add('hidden');
      document.getElementById('viewAuditLog').classList.add('hidden');
      fetchSettings();
    });
  }

  const btnCloseSettings = document.getElementById('btnCloseSettings');
  if (btnCloseSettings) {
    btnCloseSettings.addEventListener('click', () => {
      document.getElementById('viewSettings').classList.add('hidden');
    });
  }

  const btnSaveSettings = document.getElementById('btnSaveSettings');
  if (btnSaveSettings) {
    btnSaveSettings.addEventListener('click', async () => {
      const warningLimitVal = parseFloat(document.getElementById('setWarningLimit').value);
      const dangerLimitVal = parseFloat(document.getElementById('setDangerLimit').value);
      const espTempWarningVal = parseFloat(document.getElementById('setEspTempWarning').value);
      const espTempDangerVal = parseFloat(document.getElementById('setEspTempDanger').value);

      try {
        const res = await apiFetch('/api/settings', {
          method: 'POST',
          body: JSON.stringify({
            warningLimit: warningLimitVal,
            dangerLimit: dangerLimitVal,
            espTempWarning: espTempWarningVal,
            espTempDanger: espTempDangerVal
          })
        });
        alert(res.message || 'Ambang batas berhasil disimpan.');
        await fetchSettings();
        document.getElementById('viewSettings').classList.add('hidden');
        if (currentView === 'details') renderDetailView();
        else if (currentView === 'motors') renderMotorView();
        else renderMachineView();
      } catch (err) {
        alert(err.message || 'Gagal menyimpan ambang batas.');
      }
    });
  }

  const btnResetSettingsDefault = document.getElementById('btnResetSettingsDefault');
  if (btnResetSettingsDefault) {
    btnResetSettingsDefault.addEventListener('click', async () => {
      if (!confirm('Kembalikan ambang batas ke default (Warning 5%, Danger 10%, Suhu Warning 70°C, Danger 80°C)?')) return;
      try {
        const res = await apiFetch('/api/settings', {
          method: 'POST',
          body: JSON.stringify({
            warningLimit: 5.0,
            dangerLimit: 10.0,
            espTempWarning: 70.0,
            espTempDanger: 80.0
          })
        });
        alert('Ambang batas berhasil dikembalikan ke default.');
        await fetchSettings();
        if (currentView === 'details') renderDetailView();
        else if (currentView === 'motors') renderMotorView();
        else renderMachineView();
      } catch (err) {
        alert(err.message || 'Gagal reset settings.');
      }
    });
  }

  // --- Add Motor Panel Handlers ---
  const btnAddMotorModal = document.getElementById('btnAddMotorModal');
  if (btnAddMotorModal) {
    btnAddMotorModal.addEventListener('click', () => {
      document.getElementById('viewAddMotor').classList.toggle('hidden');
      document.getElementById('viewSettings').classList.add('hidden');
      document.getElementById('viewUserMgmt').classList.add('hidden');
      document.getElementById('viewAuditLog').classList.add('hidden');
    });
  }

  const btnCloseAddMotor = document.getElementById('btnCloseAddMotor');
  if (btnCloseAddMotor) {
    btnCloseAddMotor.addEventListener('click', () => {
      document.getElementById('viewAddMotor').classList.add('hidden');
    });
  }

  const formAddMotor = document.getElementById('formAddMotor');
  if (formAddMotor) {
    formAddMotor.addEventListener('submit', async (e) => {
      e.preventDefault();
      const machineId = parseInt(document.getElementById('newMachineId').value);
      const motorNo = parseInt(document.getElementById('newMotorNo').value);
      const nominal = parseFloat(document.getElementById('newNominalCap').value) || 2.0;

      try {
        const res = await apiFetch('/api/motors', {
          method: 'POST',
          body: JSON.stringify({ machineId, motorNo, nominal })
        });
        alert(res.message || 'Motor baru berhasil ditambahkan.');
        document.getElementById('newMachineId').value = '';
        document.getElementById('newMotorNo').value = '';
        document.getElementById('viewAddMotor').classList.add('hidden');
        renderMachineView();
      } catch (err) {
        alert(err.message || 'Gagal menambahkan motor baru.');
      }
    });
  }
});