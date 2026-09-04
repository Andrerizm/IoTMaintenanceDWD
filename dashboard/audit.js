// ============================================================================
// AUDIT.JS — Client-side Audit Viewer Client untuk Server API
// ============================================================================

async function fetchAuditLogs(filters) {
  let url = '/api/audit-logs?limit=100';
  if (filters) {
    if (filters.action) url += `&action=${encodeURIComponent(filters.action)}`;
    if (filters.username) url += `&username=${encodeURIComponent(filters.username)}`;
  }

  try {
    const data = await apiFetch(url);
    return data.logs || [];
  } catch (err) {
    console.error('Error fetching audit logs:', err);
    return [];
  }
}

async function exportAuditLogJSON() {
  const logs = await fetchAuditLogs();
  const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit_log_bekaert_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function clearAuditLogs() {
  try {
    await apiFetch('/api/audit-logs', { method: 'DELETE' });
    return true;
  } catch (err) {
    alert(err.message || 'Gagal menghapus audit log.');
    return false;
  }
}

async function renderAuditLogTable(containerId, filters) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:16px;">Memuat data audit log dari server...</td></tr>';

  const logs = await fetchAuditLogs(filters);

  if (logs.length === 0) {
    container.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-dim); padding:24px;">Tidak ada log yang ditemukan.</td></tr>';
    return;
  }

  container.innerHTML = logs.map(log => {
    const ts = new Date(log.timestamp);
    const timeStr = ts.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'medium' });
    const actionClass = getActionBadgeClass(log.action);

    return `<tr>
      <td>${escapeHtml(timeStr)}</td>
      <td><strong>${escapeHtml(log.username)}</strong><br/><span style="font-size:10px;color:var(--text-dim)">${escapeHtml(log.role)} (${escapeHtml(log.ip_address || '127.0.0.1')})</span></td>
      <td><span class="badge ${actionClass}">${escapeHtml(log.action)}</span></td>
      <td>${escapeHtml(log.details || '')}</td>
    </tr>`;
  }).join('');
}

function getActionBadgeClass(action) {
  if (action.includes('FAILED') || action.includes('BLOCKED')) return 'DANGER';
  if (action.includes('SUCCESS') || action.includes('LOGIN')) return 'NORMAL';
  if (action.includes('LOGOUT') || action.includes('CLEAR')) return 'WARNING';
  if (action.includes('USER_MGMT')) return 'OFF';
  return '';
}

// --- Render User Management Table ---
async function renderUserTable(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:16px;">Memuat pengguna dari server...</td></tr>';

  try {
    const data = await apiFetch('/api/users');
    const users = data.users || [];
    const session = getSession();

    if (users.length === 0) {
      container.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:16px;">Belum ada user.</td></tr>';
      return;
    }

    container.innerHTML = users.map(u => {
      const isSelf = session && session.username === u.username;
      const created = new Date(u.created_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });

      return `<tr>
        <td><strong>${escapeHtml(u.username)}</strong>${isSelf ? ' <span style="color:var(--green); font-size:11px;">(Akun Anda)</span>' : ''}</td>
        <td>${escapeHtml(u.display_name)}<br/><span style="font-size:11px;color:var(--text-dim)">${escapeHtml(u.email)}</span></td>
        <td>
          ${isSelf ? `<span class="badge ${u.role === 'Admin' ? 'DANGER' : 'NORMAL'}">${escapeHtml(u.role)}</span>` : `
            <select class="chart-select user-role-select" data-username="${escapeHtml(u.username)}" style="padding: 2px 6px; font-size: 11px;">
              <option value="Operator" ${u.role === 'Operator' ? 'selected' : ''}>Operator</option>
              <option value="Maintenance Shift" ${u.role === 'Maintenance Shift' ? 'selected' : ''}>Maintenance Shift</option>
              <option value="Maintenance Non Shift" ${u.role === 'Maintenance Non Shift' ? 'selected' : ''}>Maintenance Non Shift</option>
              <option value="Supervisor" ${u.role === 'Supervisor' ? 'selected' : ''}>Supervisor</option>
              <option value="Manajer" ${u.role === 'Manajer' ? 'selected' : ''}>Manajer</option>
              <option value="Admin" ${u.role === 'Admin' ? 'selected' : ''}>Admin</option>
            </select>
          `}
        </td>
        <td>${escapeHtml(created)}</td>
        <td>
          ${!isSelf ? `
            <button class="chart-btn btn-reset" data-action="resetPw" data-username="${escapeHtml(u.username)}" style="margin-right:4px; padding: 4px 8px; font-size: 11px;">🔑 Reset PW</button>
            <button class="chart-btn" data-action="deleteUser" data-username="${escapeHtml(u.username)}" style="background:var(--red,#ff4d4d); padding: 4px 8px; font-size: 11px;">🗑️ Hapus</button>
          ` : '<span style="color:var(--text-dim); font-size: 11px;">Aktif (Tidak dapat dihapus)</span>'}
        </td>
      </tr>`;
    }).join('');

    // Attach role change listeners
    container.querySelectorAll('.user-role-select').forEach(sel => {
      sel.addEventListener('change', async (e) => {
        const username = e.target.dataset.username;
        const newRole = e.target.value;
        try {
          await apiFetch(`/api/users/${encodeURIComponent(username)}/role`, {
            method: 'POST',
            body: JSON.stringify({ role: newRole })
          });
          alert(`Role user "${username}" berhasil diubah menjadi ${newRole}.`);
          renderUserTable(containerId);
        } catch (err) {
          alert(err.message || 'Gagal mengubah role user.');
          renderUserTable(containerId);
        }
      });
    });
  } catch (err) {
    container.innerHTML = `<tr><td colspan="5" style="color:var(--red); padding:16px;">Gagal memuat user: ${escapeHtml(err.message)}</td></tr>`;
  }
}
