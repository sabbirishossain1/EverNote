// Google Sheets Web App URL (Replace with your deployed script URL)
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxZwwaMLrVVpPpU1FLmpmdVJDtC1vnZIE_PrzMH4eNDPJGyHIzNYMthR4k6tbRpmgyz/exec";

// Default workers (will be saved to localStorage)
const DEFAULT_WORKERS = [
  { id: 1, name: "Worker 1", code: "2222" },
  { id: 2, name: "Worker 2", code: "3333" },
  { id: 3, name: "Worker 3", code: "4444" },
  { id: 4, name: "Worker 4", code: "5555" }
];

// Helper function to create a unique key for a note
function getNoteKey(note) {
  return `${note.Agent || ""}|||${note.Number || ""}|||${note.Date || ""}|||${note.Note || ""}`;
}

const state = {
  priority: false,
  activeTab: "today",
  editingId: null,
  selectedIds: new Set(),
  todayItems: [],
  allItems: [],
  searchVisible: false,
  searchQuery: "",
  workers: [],
  currentUser: null, // { id, name, code, role: 'admin'|'worker' }
  editingWorkerId: null, // For admin edit worker modal
  selectedWorkerForView: null, // For admin viewing a worker's notes
  adminActiveSection: "workers", // workers, worker-notes, add-note, all-notes
  selectedWorkersForFilter: new Set(), // Worker IDs selected for filtering
  adminEditingId: null, // For admin note editing
  adminSelectedIds: new Set() // Now stores note keys (not sheetIndex)
};

// LocalStorage Helper
const cache = {
  set: (key, data) => {
    console.log("cache.set called with key:", key, "data:", data);
    localStorage.setItem(key, JSON.stringify({ data, time: Date.now() }));
  },
  get: (key) => {
    const val = localStorage.getItem(key);
    console.log("cache.get called with key:", key, "raw val:", val);
    if (!val) return null;
    try {
      const parsed = JSON.parse(val);
      console.log("cache.get parsed val:", parsed);
      if (parsed && parsed.data !== undefined) return parsed.data;
      return parsed;
    } catch(e) { 
      console.log("cache.get error:", e);
      return null; 
    }
  }
};

// Initialize workers from Google Sheets or defaults
async function initWorkers() {
  try {
    const result = await callSheets('listWorkers');
    if (result && result.ok && result.data && result.data.length > 0) {
      state.workers = result.data;
      // Also cache locally for faster loading
      cache.set('evernote_workers', state.workers);
    } else {
      // If no workers in sheet, use defaults and save to sheet
      let savedWorkers = cache.get('evernote_workers');
      if (!savedWorkers || !Array.isArray(savedWorkers) || savedWorkers.length === 0) {
        savedWorkers = [...DEFAULT_WORKERS];
      }
      state.workers = savedWorkers;
      // Save default workers to sheet
      for (const worker of state.workers) {
        await callSheets('saveWorker', { id: 0, name: worker.name, code: worker.code });
      }
    }
  } catch (e) {
    console.error("Error loading workers:", e);
    // Fall back to local cache
    let savedWorkers = cache.get('evernote_workers');
    if (!savedWorkers || !Array.isArray(savedWorkers) || savedWorkers.length === 0) {
      savedWorkers = [...DEFAULT_WORKERS];
      cache.set('evernote_workers', savedWorkers);
    }
    state.workers = savedWorkers;
  }
}

// Save workers to Google Sheets (and cache locally)
async function saveWorkers() {
  cache.set('evernote_workers', state.workers);
}

// Save single worker to Google Sheets
async function saveSingleWorker(worker) {
  await callSheets('saveWorker', worker);
  await saveWorkers();
}

// Delete worker from Google Sheets
async function deleteSingleWorker(id) {
  console.log('deleteSingleWorker called with id:', id);
  const result = await callSheets('deleteWorker', { id: id });
  console.log('deleteSingleWorker result:', result);
  await saveWorkers();
}

function fmtDate(d) {
  const x = new Date(d);
  if (isNaN(x.getTime())) return "";
  const year = x.getFullYear();
  const month = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function fmtDisplayDate(d) {
  if (!d) return "";
  const x = new Date(d);
  if (isNaN(x.getTime())) return d;
  const day = x.getDate();
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const month = months[x.getMonth()];
  const year = String(x.getFullYear()).slice(-2);
  return `${day} ${month}, ${year}`;
}
function todayStr() { return fmtDate(new Date()); }
function uniquePhones(items) { const s = new Set(); items.forEach(i => { if (i.Number) s.add(i.Number); }); return Array.from(s); }

async function callSheets(action, payload = {}) {
  const url = `${SCRIPT_URL}`;
  console.log(`📡 Sending to Sheets: ${action}`, payload);

  try {
    // Build query string manually for reliability
    let queryString = `action=${encodeURIComponent(action)}`;
    for (let key in payload) {
      queryString += `&${encodeURIComponent(key)}=${encodeURIComponent(String(payload[key]))}`;
    }
    
    const finalUrl = `${url}?${queryString}`;
    console.log("🔗 Full URL:", finalUrl);

    // For all actions: use normal GET
    const response = await fetch(finalUrl, {
      method: 'GET',
      cache: 'no-cache'
    });
    
    const responseText = await response.text();
    console.log(`📄 Response:`, responseText);

    // For list: parse JSON response
    if (action === "list" && response.ok) {
      const rawData = JSON.parse(responseText);
      // Convert raw sheet data to our note format - NOW USING DIRECT ROW NUMBERS!
      const notes = [];
      for (let i = 1; i < rawData.length; i++) {
        notes.push({
          rowNum: i + 1,  // Direct sheet row number (i starts at 1 for data rows, +1 because header is row 1)
          sheetIndex: i, // Keep for backward compatibility
          Agent: rawData[i][0] || "",
          Number: rawData[i][1] || "",
          Date: rawData[i][2] || "",
          Note: rawData[i][3] || ""
        });
      }
      console.log("📥 List Data:", notes);
      return { ok: true, data: notes };
    }

    // For listWorkers: parse JSON response
    if (action === "listWorkers" && response.ok) {
      const rawData = JSON.parse(responseText);
      // Convert raw sheet data to our worker format
      const workers = [];
      for (let i = 1; i < rawData.length; i++) {
        workers.push({
          id: parseInt(rawData[i][0]) || i,
          name: rawData[i][1] || "",
          code: rawData[i][2] || ""
        });
      }
      console.log("👥 Workers List Data:", workers);
      return { ok: true, data: workers };
    }

    return { ok: responseText.includes("OK") };
  } catch (e) {
    console.error("❌ Sheets Error:", e);
    return { ok: false, error: e.message };
  }
}

async function saveRemote(payload) {
  return await callSheets('save', payload);
}

async function listRemote(useCache = true) {
  if (useCache) {
    const cachedData = cache.get('notes_list');
    if (cachedData) {
      console.log("Using cached data...");
      return { items: cachedData, fromCache: true };
    }
  }

  console.log("Fetching from Google Sheets...");
  try {
    const result = await callSheets('list');
    if (result.ok && result.data) {
      cache.set('notes_list', result.data);
      return { items: result.data || [] };
    }
  } catch (e) {
    console.error("Fetch error:", e);
  }
  
  const local = cache.get('notes_list');
  return { items: local || [] };
}

// --- Role-based functions ---

// Track entered access code
let enteredCode = '';

// Update code display
function updateCodeDisplay() {
  const display = document.getElementById('code-display');
  if (!display) return;
  display.textContent = '•'.repeat(enteredCode.length);
  if (enteredCode.length === 0) {
    display.textContent = '••••••••';
  }
}

// Check if entered code is valid and login
async function checkAndLogin() {
  const statusEl = document.getElementById('access-status');
  if (!statusEl) return;

  // Check for admin
  if (enteredCode === '0000') {
    state.currentUser = { id: 0, name: 'Admin', code: '0000', role: 'admin' };
    saveLoginData(state.currentUser);
    statusEl.textContent = 'Access granted! Welcome Admin';
    statusEl.style.color = 'var(--success)';
    setTimeout(() => {
      enteredCode = '';
      updateCodeDisplay();
      statusEl.textContent = '';
      showAdminDashboard();
    }, 500);
    return;
  }

  // Check for worker (local first)
  const localWorker = state.workers.find(w => String(w.code) === String(enteredCode));
  if (localWorker) {
    state.currentUser = { ...localWorker, role: 'worker' };
    saveLoginData(state.currentUser);
    statusEl.textContent = `Access granted! Welcome ${localWorker.name}`;
    statusEl.style.color = 'var(--success)';
    setTimeout(() => {
      enteredCode = '';
      updateCodeDisplay();
      statusEl.textContent = '';
      showWorkerDashboard();
    }, 500);
    return;
  }

  // If no local match, check Google Sheets
  statusEl.textContent = 'Checking code...';
  try {
    const result = await callSheets('listWorkers');
    if (result && result.ok && result.data) {
      state.workers = result.data;
      cache.set('evernote_workers', state.workers);
      
      const sheetWorker = state.workers.find(w => String(w.code) === String(enteredCode));
      if (sheetWorker) {
        state.currentUser = { ...sheetWorker, role: 'worker' };
        saveLoginData(state.currentUser);
        statusEl.textContent = `Access granted! Welcome ${sheetWorker.name}`;
        statusEl.style.color = 'var(--success)';
        setTimeout(() => {
          enteredCode = '';
          updateCodeDisplay();
          statusEl.textContent = '';
          showWorkerDashboard();
        }, 500);
        return;
      }
    }
    // Invalid code
    statusEl.textContent = 'Invalid access code';
    statusEl.style.color = 'var(--danger)';
    setTimeout(() => {
      enteredCode = '';
      updateCodeDisplay();
      statusEl.textContent = '';
    }, 1000);
  } catch (e) {
    statusEl.textContent = 'Error checking code';
    statusEl.style.color = 'var(--danger)';
    setTimeout(() => {
      enteredCode = '';
      updateCodeDisplay();
      statusEl.textContent = '';
    }, 1000);
  }
}

// Show access screen
function showAccessScreen() {
  document.getElementById('access-screen').classList.remove('hidden');
  document.getElementById('worker-dashboard').classList.add('hidden');
  document.getElementById('admin-dashboard').classList.add('hidden');
  state.currentUser = null;
  enteredCode = '';
  updateCodeDisplay();
  document.getElementById('access-status').textContent = '';
  
  // Reset access screen title
  const accessTitle = document.querySelector('#access-screen .app-title');
  if (accessTitle) accessTitle.textContent = 'EverNote';
}

// Show worker dashboard
function showWorkerDashboard() {
  document.getElementById('access-screen').classList.add('hidden');
  document.getElementById('worker-dashboard').classList.remove('hidden');
  document.getElementById('admin-dashboard').classList.add('hidden');
  
  // Update title with worker name
  if (state.currentUser && state.currentUser.name) {
    const titleElements = document.querySelectorAll('#worker-dashboard .app-title');
    titleElements.forEach(el => {
      el.textContent = `EverNote (${state.currentUser.name})`;
    });
  }
  
  // First load local data immediately (using our new helper functions!)
  renderWorkerTodayNotes();
  renderWorkerAllNotes();
  
  // Then sync with Google Sheets in background
  setTimeout(async () => {
    await refresh(false);
    // After refresh, re-render with helper functions
    renderWorkerTodayNotes();
    renderWorkerAllNotes();
  }, 100);
}

// Show admin dashboard
function showAdminDashboard() {
  document.getElementById('access-screen').classList.add('hidden');
  document.getElementById('worker-dashboard').classList.add('hidden');
  document.getElementById('admin-dashboard').classList.remove('hidden');
  
  // Set default section to Add Note
  selectAdminMenuItem('add-note');
  renderWorkerList();
  
  // First render all admin views from local cache immediately
  renderAdminTodayNotes();
  renderAllAdminNotes();
  renderWorkerFilterList();
  renderFilteredNotes();
  if (state.selectedWorkerForView) {
    renderAdminWorkerNotes(state.selectedWorkerForView.name);
  }
  
  // Then sync with Google Sheets in background
  setTimeout(async () => {
    await refreshAdminData();
    // Re-render after sync
    renderAdminTodayNotes();
    renderAllAdminNotes();
    renderWorkerFilterList();
    renderFilteredNotes();
    if (state.selectedWorkerForView) {
      renderAdminWorkerNotes(state.selectedWorkerForView.name);
    }
  }, 100);
}

// Open Admin Menu
function openAdminMenu() {
  document.getElementById('admin-menu-overlay').classList.remove('hidden');
  document.getElementById('admin-side-menu').classList.remove('hidden');
}

// Close Admin Menu
function closeAdminMenu() {
  document.getElementById('admin-menu-overlay').classList.add('hidden');
  document.getElementById('admin-side-menu').classList.add('hidden');
}

// Open Worker Menu
function openWorkerMenu() {
  document.getElementById('worker-menu-overlay').classList.remove('hidden');
  document.getElementById('worker-side-menu').classList.remove('hidden');
}

// Close Worker Menu
function closeWorkerMenu() {
  document.getElementById('worker-menu-overlay').classList.add('hidden');
  document.getElementById('worker-side-menu').classList.add('hidden');
}

// Select Admin Menu Item
function selectAdminMenuItem(section) {
  // Update menu active state
  document.getElementById('menu-item-add-note').classList.toggle('active', section === 'add-note');
  document.getElementById('menu-item-workers').classList.toggle('active', section === 'workers');
  document.getElementById('menu-item-worker-notes').classList.toggle('active', section === 'worker-notes');
  
  // Close menu
  closeAdminMenu();
  
  // Show/hide sections
  document.getElementById('admin-worker-section').classList.toggle('hidden', section !== 'workers');
  document.getElementById('admin-worker-notes-section').classList.toggle('hidden', section !== 'worker-notes');
  document.getElementById('admin-note-section').classList.toggle('hidden', section !== 'add-note');
  document.getElementById('admin-all-notes-section').classList.toggle('hidden', section !== 'all-notes');
  
  // Show/hide tabs (only for add-note and all-notes)
  const tabsContainer = document.getElementById('admin-tabs-container');
  tabsContainer.classList.toggle('hidden', !['add-note', 'all-notes'].includes(section));
  
  // Update active tab in the tab bar
  if (['add-note', 'all-notes'].includes(section)) {
    document.getElementById('admin-tab-add-note').classList.toggle('active', section === 'add-note');
    document.getElementById('admin-tab-all-notes').classList.toggle('active', section === 'all-notes');
  }
  
  // Update state
  state.adminActiveSection = section;
  
  // Render content based on section
  if (section === 'worker-notes') {
    state.selectedWorkersForFilter.clear(); // Clear previous selections
    renderWorkerFilterList();
    renderFilteredNotes();
  }
  if (section === 'add-note') {
    renderAdminTodayNotes();
  }
  if (section === 'all-notes') {
    renderAllAdminNotes();
  }
}



function toggleAdminSelect(noteKey) {
  console.log("toggleAdminSelect called with noteKey:", noteKey);
  if (state.adminSelectedIds.has(noteKey)) {
    state.adminSelectedIds.delete(noteKey);
    console.log("Removed from selection, now:", Array.from(state.adminSelectedIds));
  } else {
    state.adminSelectedIds.add(noteKey);
    console.log("Added to selection, now:", Array.from(state.adminSelectedIds));
  }

  renderAdminTodayNotes();
  renderAllAdminNotes();
  renderWorkerFilterList();
  renderFilteredNotes();
  if (state.selectedWorkerForView) {
    renderAdminWorkerNotes(state.selectedWorkerForView.name);
  }
}

// Delete a single admin note
async function deleteSingleAdminNote(noteKey) {
  state.adminSelectedIds.clear();
  state.adminSelectedIds.add(noteKey);
  await deleteSelectedAdmin();
}

function renderAdminNoteCard(i, isTodayView = false) {
  const noteKey = getNoteKey(i);
  const isSelected = state.adminSelectedIds.has(noteKey);
  const isAdminNote = i.Agent === "Sabbir";
  const isAllView = !isTodayView;
  return `
    <div class="note-card ${isSelected ? 'selected-row' : ''}" onclick="showFullNote(${i.sheetIndex}, event)">
      <div class="card-top">
        <div style="display: flex; gap: 12px; align-items: center;">
          ${isAllView ? `
          <label class="custom-checkbox" onclick="event.stopPropagation();">
            <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="event.stopPropagation(); toggleAdminSelect('${noteKey.replace(/'/g, "\\'")}')">
            <span class="checkmark"></span>
          </label>` : ""}
          <div class="card-info" style="width: 100%;">
            <div style="display: flex; justify-content: space-between; width: 100%; margin-bottom: 4px; gap: 16px;">
              <span style="font-size: 13px; font-weight: 700; color: var(--primary);">${i.Agent || "Unknown Agent"}</span>
              <span class="card-date">${fmtDisplayDate(i.Date)}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="card-phone">${i.Number || "No Number"}</span>
              ${i.Number ? `
                <button class="copy-number-btn" onclick="copyNumber('${i.Number}', event)" title="Copy Number" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); padding: 4px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s;">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                </button>
              ` : ''}
            </div>
          </div>
        </div>
        ${isAdminNote ? `
          <div class="card-actions" style="gap: 8px;">
            <button class="edit-btn-icon" title="Edit Note" onclick="event.stopPropagation(); editAdminNote(${i.sheetIndex})">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            </button>
          </div>
        ` : ''}
      </div>
      <div class="card-note">${i.Note || "No content"}</div>
    </div>`;
}

// Render Admin Today's Notes (Admin Only - Sabbir)
async function renderAdminTodayNotes() {
  const todayStrVal = todayStr();
  const allNotes = cache.get('notes_list') || [];
  
  const todayNotes = allNotes.filter(note => {
    if (!note.Date) return false;
    if (note.Agent !== 'Sabbir') return false; // Only Admin's notes
    return fmtDate(note.Date) === todayStrVal;
  });
  
  const container = document.getElementById('admin-today-notes-container');
  if (!container) return;
  
  const headerHtml = `
    <div class="list-header">
      <div class="list-title">Today's Notes</div>
      <div class="header-right-group">
        <span class="count">${todayNotes.length}</span>
      </div>
    </div>`;
  
  if (!todayNotes.length) {
    container.innerHTML = headerHtml + '<div class="empty">No notes today</div>';
    return;
  }
  
  container.innerHTML = headerHtml + `
    <div class="cards-container">
      ${todayNotes.map(note => renderAdminNoteCard(note, true)).join('')}
    </div>`;
}

// Render Worker Filter List
function renderWorkerFilterList() {
  const container = document.getElementById('worker-filter-list');
  if (!container) return;
  
  const allNotes = cache.get('notes_list') || [];
  
  const workerItemsHtml = state.workers.map(worker => {
    // Count notes for this worker
    const workerNoteCount = allNotes.filter(note => note.Agent === worker.name).length;
    const isSelected = state.selectedWorkersForFilter.has(worker.id);
    
    return `
      <div class="worker-filter-item ${isSelected ? 'selected' : ''}" onclick="toggleWorkerFilter(${worker.id})">
        <div class="worker-filter-info">
          <div class="worker-filter-name">${worker.name}</div>
          <div class="worker-filter-count">${workerNoteCount} notes</div>
        </div>
        <div style="display: flex; align-items: center;">
          <label class="custom-checkbox" style="width: 24px; height: 24px;">
            <input type="checkbox" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleWorkerFilter(${worker.id});">
            <span class="checkmark"></span>
          </label>
        </div>
      </div>
    `;
  }).join('');
  
  container.innerHTML = workerItemsHtml;
}

// Toggle Worker Filter
function toggleWorkerFilter(workerId) {
  if (state.selectedWorkersForFilter.has(workerId)) {
    state.selectedWorkersForFilter.delete(workerId);
  } else {
    state.selectedWorkersForFilter.add(workerId);
  }
  
  renderWorkerFilterList();
  renderFilteredNotes();
}

// Render Filtered Notes
function renderFilteredNotes() {
  const container = document.getElementById('filtered-notes-container');
  if (!container) return;
  
  const allNotes = cache.get('notes_list') || [];
  
  // Get selected worker names
  const selectedWorkerNames = state.workers
    .filter(worker => state.selectedWorkersForFilter.has(worker.id))
    .map(worker => worker.name);
  
  // If no workers selected
  if (selectedWorkerNames.length === 0) {
    container.innerHTML = '<div class="empty">Please select workers to view their notes</div>';
    return;
  }
  
  // Filter notes
  const filteredNotes = allNotes.filter(note => {
    return selectedWorkerNames.includes(note.Agent);
  });
  
  // Sort notes by date (newest first)
  filteredNotes.sort((a, b) => new Date(b.Date) - new Date(a.Date));
  
  const headerHtml = `
    <div class="list-header">
      <div class="list-title">Filtered Notes</div>
      <div class="header-right-group">
        <span class="count">${filteredNotes.length}</span>
        <button class="delete-all-btn" onclick="deleteSelectedAdmin()" title="Delete Selected">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
        </button>
      </div>
    </div>`;
  
  if (!filteredNotes.length) {
    container.innerHTML = headerHtml + '<div class="empty">No notes found for selected workers</div>';
    return;
  }
  
  container.innerHTML = headerHtml + `
    <div class="cards-container">
      ${filteredNotes.map(note => renderAdminNoteCard(note, false)).join('')}
    </div>`;
}

// Render all notes for admin
async function renderAllAdminNotes() {
  // 1. First render from cache immediately
  const cachedNotes = cache.get('notes_list') || [];
  let allNotes = cachedNotes.filter(note => note.Agent === 'Sabbir');
  
  const container = document.getElementById('admin-all-notes-container');
  if (!container) return;
  
  const headerHtml = `
    <div class="list-header">
      <div class="list-title">All Notes</div>
      <div class="header-right-group">
        <span class="count">${allNotes.length}</span>
        <button class="delete-all-btn" onclick="deleteSelectedAdmin()" title="Delete Selected">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
        </button>
      </div>
    </div>`;
  
  if (!allNotes.length) {
    container.innerHTML = headerHtml + '<div class="empty">No notes found</div>';
  } else {
    container.innerHTML = headerHtml + `
      <div class="cards-container">
        ${allNotes.map(note => renderAdminNoteCard(note, false)).join('')}
      </div>
    `;
  }
  
  // 2. Then sync fresh data in the background
  setTimeout(async () => {
    const result = await listRemote(false);
    let freshNotes = result.items || [];
    freshNotes = freshNotes.filter(note => note.Agent === 'Sabbir');
    
    const freshHeaderHtml = `
      <div class="list-header">
        <div class="list-title">All Notes</div>
        <div class="header-right-group">
          <span class="count">${freshNotes.length}</span>
          <button class="delete-all-btn" onclick="deleteSelectedAdmin()" title="Delete Selected">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
          </button>
        </div>
      </div>`;
    
    if (!freshNotes.length) {
      container.innerHTML = freshHeaderHtml + '<div class="empty">No notes found</div>';
    } else {
      container.innerHTML = freshHeaderHtml + `
        <div class="cards-container">
          ${freshNotes.map(note => renderAdminNoteCard(note, false)).join('')}
        </div>
      `;
    }
  }, 100);
}

// Save admin note (fixed agent: Sabbir)
async function saveAdminNote() {
  const phoneInput = document.getElementById('admin-phone').value.trim();
  const noteInput = document.getElementById('admin-note').value.trim();
  const dateInput = document.getElementById('admin-note-date').value;
  const statusEl = document.getElementById('admin-status');
  const saveBtn = document.getElementById('admin-save-btn');

  // Clean phone number
  let phone = phoneInput.replace(/[^\d+]/g, '');
  if (phone.startsWith('+88')) {
    phone = phone.substring(3);
  } else if (phone.startsWith('88')) {
    phone = phone.substring(2);
  }
  phone = phone.replace(/\D/g, '');

  if (!phone || !noteInput) {
    alert('Please fill Number and Note fields!');
    return;
  }

  const finalDate = dateInput || fmtDate(new Date());
  
  // Get current notes
  let currentNotes = cache.get('notes_list') || [];
  let existingNote = null;
  
  if (state.adminEditingId !== null) {
    existingNote = currentNotes.find(n => n.sheetIndex === state.adminEditingId);
  }
  
  // Prepare save payload
  const savePayload = {
    Agent: "Sabbir",
    Date: finalDate,
    Number: phone,
    Note: noteInput
  };
  
  if (existingNote && existingNote.rowNum) {
    savePayload.rowNum = existingNote.rowNum;
  }

  // Optimistic UI update
  if (existingNote) {
    const index = currentNotes.findIndex(n => n.sheetIndex === state.adminEditingId);
    if (index !== -1) {
      savePayload.sheetIndex = existingNote.sheetIndex;
      savePayload.rowNum = existingNote.rowNum;
      currentNotes[index] = savePayload;
    }
  } else {
    // Add new note
    savePayload.sheetIndex = Date.now();
    currentNotes.unshift(savePayload);
  }
  cache.set('notes_list', currentNotes);

  // Refresh Today's Notes immediately
  renderAdminTodayNotes();

  statusEl.textContent = 'Syncing with Sheets...';
  statusEl.style.color = '#3b82f6';

  // Sync with Google Sheets
  const result = await callSheets('save', savePayload);
  if (result.ok) {
    statusEl.textContent = 'Synced with Google Sheets!';
    statusEl.style.color = 'green';
    setTimeout(() => statusEl.textContent = '', 3000);
    await refreshAdminData();
    renderAdminTodayNotes();
  } else {
    statusEl.textContent = 'Sync failed, but saved locally!';
    statusEl.style.color = 'orange';
  }

  // Clear form and reset editing state
  document.getElementById('admin-phone').value = '';
  document.getElementById('admin-note').value = '';
  document.getElementById('admin-note-date').value = '';
  state.adminEditingId = null;
  saveBtn.textContent = 'Save Note';
  saveBtn.classList.remove('editing');
}

// Edit admin note
async function editAdminNote(sheetIndex) {
  const res = await listRemote(true);
  const allNotes = res.items || [];
  const note = allNotes.find(i => i.sheetIndex === sheetIndex);
  if (!note) return;

  if (note.Date) {
    document.getElementById("admin-note-date").value = fmtDate(note.Date);
  }

  document.getElementById("admin-phone").value = note.Number;
  document.getElementById("admin-note").value = note.Note;

  state.adminEditingId = sheetIndex;
  const saveBtn = document.getElementById("admin-save-btn");
  saveBtn.textContent = "Update Note";
  saveBtn.classList.add("editing");

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteSelectedAdmin() {
  console.log("deleteSelectedAdmin called! Selected keys:", Array.from(state.adminSelectedIds));
  if (state.adminSelectedIds.size === 0) {
    alert("Please select at least one note to delete.");
    return;
  }

  if (!confirm(`Are you sure you want to delete ${state.adminSelectedIds.size} selected note(s)?`)) return;

  const statusEl = document.getElementById("admin-status");

  // 1. FIRST DELETE FROM LOCAL CACHE INSTANTLY!
  const deleteKeys = new Set(state.adminSelectedIds);
  const currentNotes = cache.get('notes_list') || [];
  const filteredNotes = currentNotes.filter(n => !state.adminSelectedIds.has(getNoteKey(n)));
  cache.set('notes_list', filteredNotes);
  // Update UI immediately!
  state.adminSelectedIds.clear();
  renderAdminTodayNotes();
  renderAllAdminNotes();
  renderWorkerFilterList();
  renderFilteredNotes();
  if (state.selectedWorkerForView) {
    renderAdminWorkerNotes(state.selectedWorkerForView.name);
  }
  statusEl.textContent = "Deleting...";
  statusEl.style.color = "blue";

  // 2. NOW SYNC WITH GOOGLE SHEETS IN BACKGROUND!
  (async () => {
    try {
      const res = await fetch(SCRIPT_URL + '?action=list', { cache: 'no-cache' });
      const rawData = await res.json();
      const allNotes = [];
      for (let i = 1; i < rawData.length; i++) {
        allNotes.push({
          rowNum: i + 1,
          sheetIndex: i,
          Agent: rawData[i][0] || "",
          Number: rawData[i][1] || "",
          Date: rawData[i][2] || "",
          Note: rawData[i][3] || ""
        });
      }
      const selectedNotes = allNotes.filter(n => deleteKeys.has(getNoteKey(n)));
      let successCount = 0;
      for (let i = 0; i < selectedNotes.length; i++) {
        const targetNote = selectedNotes[i];
        const currentRes = await fetch(SCRIPT_URL + '?action=list', { cache: 'no-cache' });
        const currentRawData = await currentRes.json();
        let currentRowNum = null;
        for (let j = 1; j < currentRawData.length; j++) {
          if (
            currentRawData[j][0] === targetNote.Agent &&
            currentRawData[j][1] === targetNote.Number &&
            currentRawData[j][2] === targetNote.Date &&
            currentRawData[j][3] === targetNote.Note
          ) {
            currentRowNum = j + 1;
            break;
          }
        }
        if (currentRowNum) {
          const deleteRes = await fetch(`${SCRIPT_URL}?action=delete&rowNum=${currentRowNum}`, { cache: 'no-cache' });
          const deleteResult = await deleteRes.text();
          if (deleteResult.includes('OK')) successCount++;
        }
      }
      const finalRes = await fetch(SCRIPT_URL + '?action=list', { cache: 'no-cache' });
      const finalRawData = await finalRes.json();
      const finalNotes = [];
      for (let i = 1; i < finalRawData.length; i++) {
        finalNotes.push({
          rowNum: i + 1,
          sheetIndex: i,
          Agent: finalRawData[i][0] || "",
          Number: finalRawData[i][1] || "",
          Date: finalRawData[i][2] || "",
          Note: finalRawData[i][3] || ""
        });
      }
      cache.set('notes_list', finalNotes);
      // Re-render UI with final data
      renderAdminTodayNotes();
      renderAllAdminNotes();
      renderWorkerFilterList();
      renderFilteredNotes();
      if (state.selectedWorkerForView) {
        renderAdminWorkerNotes(state.selectedWorkerForView.name);
      }
      if (successCount === selectedNotes.length) {
        statusEl.textContent = "Successfully deleted!";
        statusEl.style.color = "green";
      }
      setTimeout(() => statusEl.textContent = "", 3000);
    } catch (e) {
      console.error("Background delete failed:", e);
      statusEl.textContent = "Deleted locally, sync failed!";
      statusEl.style.color = "orange";
      setTimeout(() => statusEl.textContent = "", 3000);
    }
  })();
}

// Save login data to localStorage
function saveLoginData(user) {
  const loginData = {
    user,
    timestamp: Date.now()
  };
  localStorage.setItem('evernote_login', JSON.stringify(loginData));
}

// Handle access code submission
async function handleAccessCode() {
  const code = document.getElementById('access-code').value.trim();
  const statusEl = document.getElementById('access-status');

  if (!code) {
    statusEl.textContent = 'Please enter an access code';
    statusEl.style.color = 'var(--danger)';
    return;
  }

  // Check for admin
  if (code === '0000') {
    state.currentUser = { id: 0, name: 'Admin', code: '0000', role: 'admin' };
    saveLoginData(state.currentUser);
    statusEl.textContent = 'Access granted! Welcome Admin';
    statusEl.style.color = 'var(--success)';
    setTimeout(() => showAdminDashboard(), 500);
    
    // Sync workers in background
    (async () => {
      try {
        const result = await callSheets('listWorkers');
        if (result && result.ok && result.data) {
          state.workers = result.data;
          cache.set('evernote_workers', state.workers);
        }
      } catch (e) { console.error(e); }
    })();
    return;
  }

  // FIRST CHECK LOCAL CACHE FOR INSTANT LOGIN!
  console.log('� Checking local workers for code:', code);
  const localWorker = state.workers.find(w => String(w.code) === String(code));
  
  if (localWorker) {
    state.currentUser = { ...localWorker, role: 'worker' };
    saveLoginData(state.currentUser);
    statusEl.textContent = `Access granted! Welcome ${localWorker.name}`;
    statusEl.style.color = 'var(--success)';
    setTimeout(() => showWorkerDashboard(), 500);
    
    // Sync workers in background
    (async () => {
      try {
        const result = await callSheets('listWorkers');
        if (result && result.ok && result.data) {
          state.workers = result.data;
          cache.set('evernote_workers', state.workers);
        }
      } catch (e) { console.error(e); }
    })();
    return;
  }

  // If no local match, check Google Sheets
  statusEl.textContent = 'Checking code...';
  const result = await callSheets('listWorkers');
  if (result && result.ok && result.data) {
    state.workers = result.data;
    cache.set('evernote_workers', state.workers);
    
    const sheetWorker = state.workers.find(w => String(w.code) === String(code));
    if (sheetWorker) {
      state.currentUser = { ...sheetWorker, role: 'worker' };
      saveLoginData(state.currentUser);
      statusEl.textContent = `Access granted! Welcome ${sheetWorker.name}`;
      statusEl.style.color = 'var(--success)';
      setTimeout(() => showWorkerDashboard(), 500);
      return;
    }
  }

  // Invalid code
  statusEl.textContent = 'Invalid access code';
  statusEl.style.color = 'var(--danger)';
}

// Clear saved login data
function clearLoginData() {
  localStorage.removeItem('evernote_login');
}

// Logout
function logout() {
  state.currentUser = null;
  state.selectedWorkerForView = null;
  clearLoginData();
  
  // Reset titles
  const allTitleElements = document.querySelectorAll('.app-title');
  allTitleElements.forEach(el => {
    if (el.closest('#access-screen') || el.closest('#worker-dashboard')) {
      el.textContent = 'EverNote';
    } else if (el.closest('#admin-dashboard')) {
      el.textContent = 'Admin Dashboard';
    }
  });
  
  showAccessScreen();
}

// --- Worker functions ---

async function saveNote(data) {
  if (state.currentUser?.role !== 'worker') return;

  // Add agent name to data
  data.Agent = state.currentUser.name;

  const status = document.getElementById("status");
  const saveBtn = document.getElementById("save");

  try {
    status.textContent = "Syncing with Sheets...";
    status.style.color = "#3b82f6";

    let currentNotes = cache.get('notes_list') || [];
    let isNew = false;
    
    // Find if we're editing an existing note
    let existingNote = null;
    if (state.editingId !== null) {
      existingNote = currentNotes.find(n => n.sheetIndex === state.editingId);
    }
    
    // 1. OPTIMISTIC UI UPDATE FIRST!
    if (existingNote) {
      // Update existing note
      const idx = currentNotes.findIndex(n => n.sheetIndex === state.editingId);
      if (idx !== -1) {
        // Keep the rowNum from existing note
        data.rowNum = existingNote.rowNum;
        data.sheetIndex = existingNote.sheetIndex;
        currentNotes[idx] = data;
      }
    } else {
      // Add new note
      isNew = true;
      data.sheetIndex = Date.now(); // Temp ID
      currentNotes.unshift(data);
    }
    
    cache.set('notes_list', currentNotes);
    
    // 2. UPDATE UI INSTANTLY!
    renderWorkerTodayNotes();
    renderWorkerAllNotes();

    // Prepare payload for Google Sheets - use rowNum if available
    const savePayload = {
      Agent: data.Agent,
      Number: data.Number,
      Date: data.Date,
      Note: data.Note
    };
    if (existingNote && existingNote.rowNum) {
      savePayload.rowNum = existingNote.rowNum;
    }

    // 3. SYNC WITH GOOGLE SHEETS IN BACKGROUND!
    const result = await callSheets('save', savePayload);
    if (result.ok) {
      status.textContent = "Synced with Google Sheets!";
      status.style.color = "green";
      
      // Refresh with fresh data after sync completes
      await refresh(false);
      renderWorkerTodayNotes();
      renderWorkerAllNotes();
      
      setTimeout(() => { if(status.textContent.includes("Synced")) status.textContent = ""; }, 3000);
    } else {
      status.textContent = "Sync failed, but saved locally!";
      status.style.color = "orange";
    }

    // Clear form and reset editing state
    document.getElementById("phone").value = "";
    document.getElementById("note").value = "";
    document.getElementById("note-date").value = "";
    state.editingId = null;
    saveBtn.textContent = "Save Note";
    saveBtn.classList.remove("editing");

    return { ok: true };
  } catch(e) {
    status.textContent = "Error: " + e.message;
    status.style.color = "red";
    return { ok: false, error: e.message };
  }
}

// Helper functions for worker views (EXACTLY LIKE ADMIN'S RENDER FUNCTIONS!)
function renderWorkerTodayNotes() {
  if (!state.currentUser) return;
  const agentName = state.currentUser.name;
  const allNotes = cache.get('notes_list') || [];
  const todayNotes = allNotes.filter(n => {
    if (!n.Date) return false;
    if (n.Agent !== agentName) return false;
    return fmtDate(n.Date) === todayStr();
  });
  renderList(todayNotes, "today-view");
  renderPhones(allNotes.filter(n => n.Agent === agentName));
}

function renderWorkerAllNotes() {
  if (!state.currentUser) return;
  const agentName = state.currentUser.name;
  const allNotes = cache.get('notes_list') || [];
  const workerNotes = allNotes.filter(n => n.Agent === agentName);
  renderList(workerNotes, "all-view");
  renderPhones(workerNotes);
}

async function deleteSelected() {
  console.log("deleteSelected called! Selected keys:", Array.from(state.selectedIds));
  if (state.currentUser?.role !== 'worker') return;
  if (state.selectedIds.size === 0) {
    alert("Please select at least one note to delete.");
    return;
  }

  if (!confirm(`Are you sure you want to delete ${state.selectedIds.size} selected note(s)?`)) return;

  const statusEl = document.getElementById("status");

  // 1. FIRST DELETE FROM LOCAL CACHE INSTANTLY! (EXACTLY LIKE ADMIN!)
  const deleteKeys = new Set(state.selectedIds);
  const currentNotes = cache.get('notes_list') || [];
  const filteredNotes = currentNotes.filter(n => !deleteKeys.has(getNoteKey(n)));
  cache.set('notes_list', filteredNotes);
  
  // UPDATE UI IMMEDIATELY! EXACTLY LIKE ADMIN!
  state.selectedIds.clear();
  renderWorkerTodayNotes();
  renderWorkerAllNotes();
  
  statusEl.textContent = "Deleting...";
  statusEl.style.color = "blue";

  // 2. NOW SYNC WITH GOOGLE SHEETS IN BACKGROUND! (EXACT SAME AS ADMIN!)
  (async () => {
    try {
      const res = await fetch(SCRIPT_URL + '?action=list', { cache: 'no-cache' });
      const rawData = await res.json();
      const allNotes = [];
      for (let i = 1; i < rawData.length; i++) {
        allNotes.push({
          rowNum: i + 1,
          sheetIndex: i,
          Agent: rawData[i][0] || "",
          Number: rawData[i][1] || "",
          Date: rawData[i][2] || "",
          Note: rawData[i][3] || ""
        });
      }
      const selectedNotes = allNotes.filter(n => deleteKeys.has(getNoteKey(n)));
      let successCount = 0;
      for (let i = 0; i < selectedNotes.length; i++) {
        const targetNote = selectedNotes[i];
        const currentRes = await fetch(SCRIPT_URL + '?action=list', { cache: 'no-cache' });
        const currentRawData = await currentRes.json();
        let currentRowNum = null;
        for (let j = 1; j < currentRawData.length; j++) {
          if (
            currentRawData[j][0] === targetNote.Agent &&
            currentRawData[j][1] === targetNote.Number &&
            currentRawData[j][2] === targetNote.Date &&
            currentRawData[j][3] === targetNote.Note
          ) {
            currentRowNum = j + 1;
            break;
          }
        }
        if (currentRowNum) {
          const deleteRes = await fetch(`${SCRIPT_URL}?action=delete&rowNum=${currentRowNum}`, { cache: 'no-cache' });
          const deleteResult = await deleteRes.text();
          if (deleteResult.includes('OK')) successCount++;
        }
      }
      const finalRes = await fetch(SCRIPT_URL + '?action=list', { cache: 'no-cache' });
      const finalRawData = await finalRes.json();
      const finalNotes = [];
      for (let i = 1; i < finalRawData.length; i++) {
        finalNotes.push({
          rowNum: i + 1,
          sheetIndex: i,
          Agent: finalRawData[i][0] || "",
          Number: finalRawData[i][1] || "",
          Date: finalRawData[i][2] || "",
          Note: finalRawData[i][3] || ""
        });
      }
      cache.set('notes_list', finalNotes);
      
      // RE-RENDER UI WITH FINAL DATA! EXACTLY LIKE ADMIN!
      renderWorkerTodayNotes();
      renderWorkerAllNotes();
      
      if (successCount === selectedNotes.length) {
        statusEl.textContent = "Successfully deleted!";
        statusEl.style.color = "green";
      }
      setTimeout(() => statusEl.textContent = "", 3000);
    } catch (e) {
      console.error("Background delete failed:", e);
      statusEl.textContent = "Deleted locally, sync failed!";
      statusEl.style.color = "orange";
      setTimeout(() => statusEl.textContent = "", 3000);
    }
  })();
}

function toggleSelect(noteKey) {
  console.log("toggleSelect called with noteKey:", noteKey);
  if (state.selectedIds.has(noteKey)) {
    state.selectedIds.delete(noteKey);
    console.log("Removed from worker selection, now:", Array.from(state.selectedIds));
  } else {
    state.selectedIds.add(noteKey);
    console.log("Added to worker selection, now:", Array.from(state.selectedIds));
  }

  // Use our helper functions to render the current tab's view
  if (state.activeTab === 'today') {
    renderWorkerTodayNotes();
  } else {
    renderWorkerAllNotes();
  }
}

// Delete a single worker note
async function deleteSingleWorkerNote(noteKey) {
  state.selectedIds.clear();
  state.selectedIds.add(noteKey);
  await deleteSelected();
}

async function editNote(sheetIndex) {
  const res = await listRemote(true);
  const allNotes = res.items || [];
  const note = allNotes.find(i => i.sheetIndex === sheetIndex);
  if (!note) return;

  if (note.Date) {
    document.getElementById("note-date").value = fmtDate(note.Date);
  }

  document.getElementById("phone").value = note.Number;
  document.getElementById("note").value = note.Note;

  const warningDiv = document.getElementById("duplicate-warning");
  if (warningDiv) warningDiv.classList.add("hidden");

  state.editingId = sheetIndex;
  const saveBtn = document.getElementById("save");
  saveBtn.textContent = "Update Note";
  saveBtn.classList.add("editing");

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function listNotes(type, useCache = true, agentName = null) {
  let items = [];
  try {
    const res = await listRemote(useCache);
    items = res.items || [];
  } catch(e) {
    console.error("List fetch error:", e);
    items = [];
  }

  // Filter by agent if specified
  if (agentName) {
    items = items.filter(i => i.Agent === agentName);
  }

  const combined = [...items];
  combined.sort((a, b) => new Date(a.Date) - new Date(b.Date));

  if(type === 'today') {
    const t = todayStr();
    return combined.filter(i => {
      if (!i.Date) return false;
      return fmtDate(i.Date) === t;
    });
  }
  return combined;
}

function renderPhones(items) { const dl = document.getElementById("phone-suggestions"); dl.innerHTML = ""; uniquePhones(items).slice(0, 50).forEach(p => { const o = document.createElement("option"); o.value = p; dl.appendChild(o); }); }

function renderList(items, container) {
  const el = document.getElementById(container);
  if (!el) return;

  if (container === "today-view") {
    state.todayItems = items;
  } else {
    state.allItems = items;
  }

  const searchQuery = state.searchQuery || "";
  let filteredItems = items;
  if (container === "all-view" && searchQuery) {
    filteredItems = items.filter(i => {
      const num = i.Number ? String(i.Number) : "";
      return num.includes(searchQuery);
    });
  }

  const isAllView = container === "all-view";
  
  // ALWAYS DO FULL RE-RENDER! NO EXCEPTIONS!
  const headerHtml = `
    <div class="list-header ${isAllView ? 'header-compact' : ''}">
      ${container === "today-view" ? `<div class="list-title">Today's Notes</div>` : ""}
      <div class="header-main-actions">
        ${isAllView ? `
        <div class="search-wrapper-dynamic ${state.searchVisible ? 'visible' : ''}">
          <button class="search-toggle-btn" onclick="toggleSearchBar()" title="Search">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          </button>
          <div class="search-input-container">
            <input type="text" id="search-input" placeholder="Search number..." value="${searchQuery}">
          </div>
        </div>` : ""}
        <div class="header-right-group">
          <span class="count">${filteredItems.length}</span>
          ${container === "all-view" ? `
          <button class="delete-all-btn" onclick="deleteSelected()" title="Delete Selected">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
          </button>` : ""}
        </div>
      </div>
    </div>`;

  const cardsHtml = filteredItems.length ? `
    <div class="cards-container">
      ${filteredItems.map(i => renderNoteCard(i, container)).join("")}
    </div>` : `<div class="empty">${isAllView ? "No Notes Found" : "No Notes For Today"}</div>`;

  el.innerHTML = headerHtml + cardsHtml;

  if (isAllView) {
    attachSearchListener();
    const input = document.getElementById("search-input");
    if (input && state.searchVisible) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }
}

function renderNoteCard(i, container = "") {
  const noteKey = getNoteKey(i);
  const isSelected = state.selectedIds.has(noteKey);
  const isAllView = container === "all-view";
  return `
    <div class="note-card ${isSelected ? 'selected-row' : ''}" onclick="showFullNote(${i.sheetIndex}, event)">
      <div class="card-top">
        <div style="display: flex; gap: 12px; align-items: center;">
          ${isAllView ? `
          <label class="custom-checkbox" onclick="event.stopPropagation();">
            <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="event.stopPropagation(); toggleSelect('${noteKey.replace(/'/g, "\\'")}')">
            <span class="checkmark"></span>
          </label>` : ""}
          <div class="card-info">
            <div style="display: flex; justify-content: space-between; width: 100%; margin-bottom: 4px; gap: 16px;">
              <span style="font-size: 13px; font-weight: 700; color: var(--primary);">${i.Agent || "Unknown Agent"}</span>
              <span class="card-date">${fmtDisplayDate(i.Date)}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="card-phone">${i.Number || "No Number"}</span>
              ${i.Number ? `
                <button class="copy-number-btn" onclick="copyNumber('${i.Number}', event)" title="Copy Number" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); padding: 4px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s;">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                </button>
              ` : ''}
            </div>
          </div>
        </div>
        <div class="card-actions" style="gap: 8px;">
          <button class="edit-btn-icon" title="Edit Note" onclick="event.stopPropagation(); editNote(${i.sheetIndex})">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          </button>
        </div>
      </div>
      <div class="card-note">${i.Note || "No content"}</div>
    </div>`;
}

function showFullNote(sheetIndex, event) {
  if (event.target.closest('.note-checkbox') || event.target.closest('.edit-btn')) return;

  const allNotes = (state.allItems || []).length ? state.allItems : (cache.get('notes_list') || []);
  const note = allNotes.find(i => i.sheetIndex === sheetIndex);
  if (!note) return;

  const modal = document.getElementById("note-modal");
  const modalBody = document.getElementById("modal-body");
  const modalDate = document.getElementById("modal-date");
  const modalPhone = document.getElementById("modal-phone");

  modalBody.textContent = note.Note;
  modalDate.textContent = fmtDisplayDate(note.Date);
  modalPhone.textContent = note.Number;

  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  const modal = document.getElementById("note-modal");
  modal.classList.add("hidden");
  document.body.style.overflow = "auto";
}

function toggleSearchBar() {
  state.searchVisible = !state.searchVisible;
  renderList(state.allItems || [], "all-view");
  if (state.searchVisible) {
    setTimeout(() => {
      const input = document.getElementById("search-input");
      if (input) input.focus();
    }, 100);
  } else {
    state.searchQuery = "";
    renderList(state.allItems || [], "all-view");
  }
}

function attachSearchListener() {
  const searchInput = document.getElementById("search-input");
  if (searchInput && !searchInput.dataset.listenerAttached) {
    searchInput.dataset.listenerAttached = "true";

    searchInput.addEventListener("input", (e) => {
      state.searchQuery = e.target.value.trim();
      renderList(state.allItems || [], "all-view");
    });
  }
}

function setTab(name) {
  state.activeTab = name;
  document.getElementById("tab-today").classList.toggle("active", name === "today");
  document.getElementById("tab-all").classList.toggle("active", name === "all");
  document.getElementById("today-view").classList.toggle("hidden", name !== "today");
  document.getElementById("all-view").classList.toggle("hidden", name !== "all");

  // Show/hide the worker form only when on Today tab
  const formSection = document.getElementById("worker-form-section");
  if (formSection) {
    formSection.classList.toggle("hidden", name !== "today");
  }

  // Use our helper functions to render!
  if (name === "today") {
    renderWorkerTodayNotes();
  } else {
    renderWorkerAllNotes();
  }
}

async function refresh(useCache = true) {
  if (!state.currentUser || state.currentUser.role !== 'worker') return;

  const agentName = state.currentUser.name;
  if (state.activeTab === 'today') {
    const today = await listNotes('today', useCache, agentName);
    renderList(today, "today-view");
  } else {
    const all = await listNotes('all', useCache, agentName);
    state.allItems = all;
    renderPhones(all);
    renderList(all, "all-view");
  }
}

function checkDuplicate(input) {
  const warningDiv = document.getElementById("duplicate-warning");
  if (!warningDiv) return;

  if (!input || input.length < 5) {
    warningDiv.classList.add("hidden");
    return;
  }

  const clean = (val) => {
    let s = String(val).replace(/[^\d+]/g, '');
    if (s.startsWith('+88')) s = s.substring(3);
    else if (s.startsWith('88')) s = s.substring(2);
    s = s.replace(/\D/g, '');
    if (s.startsWith('0')) s = s.substring(1);
    return s;
  };

  const cleanInput = clean(input);
  const allNotes = state.allItems || [];

  const match = allNotes.find(n => {
    if (!n.Number) return false;
    const sheetNum = clean(n.Number);
    return sheetNum === cleanInput ||
           (cleanInput.length >= 10 && sheetNum.includes(cleanInput.slice(-10))) ||
           (sheetNum.length >= 10 && cleanInput.includes(sheetNum.slice(-10)));
  });

  if (match) {
    warningDiv.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
      <span>Similar note exists (${match.Number})</span>
      <button onclick="showFullNote(${match.sheetIndex}, event)" style="background:none; border:none; color:var(--primary); cursor:pointer; font-size:12px; font-weight:600; padding:0; margin-left:auto; text-decoration:underline;">View Note</button>
    `;
    warningDiv.classList.remove("hidden");
  } else {
    warningDiv.classList.add("hidden");
  }
}

// Copy number to clipboard
async function copyNumber(number, event) {
  event.stopPropagation();
  if (!number) return;
  try {
    await navigator.clipboard.writeText(number);
    // Show a temporary checkmark
    const target = event.target.closest('button');
    if (target) {
      const originalHTML = target.innerHTML;
      target.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
      target.style.color = '#10b981';
      setTimeout(() => {
        target.innerHTML = originalHTML;
        target.style.color = '';
      }, 1500);
    }
  } catch (err) {
    console.error('Failed to copy: ', err);
  }
}

// --- Admin functions ---

function renderWorkerList() {
  const container = document.getElementById('worker-list');
  if (!container) return;

  const headerHtml = `
    <div class="list-header">
      <div class="list-title">Workers</div>
      <div class="header-right-group">
        <span class="count">${state.workers.length}</span>
      </div>
    </div>`;

  if (state.workers.length === 0) {
    container.innerHTML = headerHtml + `<div class="empty">No workers found</div>`;
    return;
  }

  const workersHtml = `
    <div class="cards-container">
      ${state.workers.map(worker => {
        // Get note count for this worker
        const allNotes = cache.get('notes_list') || [];
        const workerNotes = allNotes.filter(n => n.Agent === worker.name);
        const todayNotes = workerNotes.filter(n => fmtDate(n.Date) === todayStr());

        return `
          <div class="note-card" style="cursor: pointer;" onclick="viewWorkerNotes(${worker.id})">
            <div class="card-top">
              <div class="card-info">
                <span class="card-phone" style="font-size: 18px;">${worker.name}</span>
                <span class="card-date">Code: ${worker.code}</span>
              </div>
              <div class="card-actions" style="gap: 8px;">
                <button class="edit-btn-icon" title="Edit Worker" onclick="event.stopPropagation(); editWorker(${worker.id})">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                </button>
                <button class="delete-all-btn" title="Delete Worker" onclick="event.stopPropagation(); deleteWorker(${worker.id})" style="padding: 8px;">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                </button>
              </div>
            </div>
            <div class="card-note">${workerNotes.length} total notes • ${todayNotes.length} today</div>
          </div>
        `;
      }).join('')}
    </div>`;

  container.innerHTML = headerHtml + workersHtml;
}

async function refreshAdminData() {
  // Just refresh the notes list cache
  await listRemote(false);
  renderWorkerList();
}

function viewWorkerNotes(workerId) {
  const worker = state.workers.find(w => w.id === workerId);
  if (!worker) return;

  state.selectedWorkerForView = worker;

  document.getElementById('worker-list').classList.add('hidden');
  document.getElementById('admin-worker-notes').classList.remove('hidden');
  document.getElementById('selected-worker-name').textContent = worker.name;

  renderAdminWorkerNotes(worker.name);
}

async function renderAdminWorkerNotes(agentName) {
  const allNotes = await listNotes('all', true, agentName);
  const todayNotes = await listNotes('today', true, agentName);

  // Update stats
  document.getElementById('selected-worker-stats').textContent = `${allNotes.length} total notes • ${todayNotes.length} today`;

  // Render today's notes
  const todayContainer = document.getElementById('admin-worker-today-view');
  todayContainer.innerHTML = `
    <div class="list-header">
      <div class="list-title">Today's Notes</div>
      <div class="header-right-group">
        <span class="count">${todayNotes.length}</span>
      </div>
    </div>
    ${todayNotes.length ? `
      <div class="cards-container" style="padding: 16px;">
        ${todayNotes.map(i => renderAdminNoteCard(i, true)).join('')}
      </div>
    ` : `<div class="empty">No notes today</div>`}
  `;

  // Render all notes
  const allContainer = document.getElementById('admin-worker-all-view');
  allContainer.innerHTML = `
    <div class="list-header">
      <div class="list-title">All Notes</div>
      <div class="header-right-group">
        <span class="count">${allNotes.length}</span>
        <button class="delete-all-btn" onclick="deleteSelectedAdmin()" title="Delete Selected">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
        </button>
      </div>
    </div>
    ${allNotes.length ? `
      <div class="cards-container" style="padding: 16px;">
        ${allNotes.map(i => renderAdminNoteCard(i, false)).join('')}
      </div>
    ` : `<div class="empty">No notes found</div>`}
  `;
}

function backToWorkerList() {
  state.selectedWorkerForView = null;
  document.getElementById('admin-worker-notes').classList.add('hidden');
  document.getElementById('worker-list').classList.remove('hidden');
}

async function addWorker() {
  const nameInput = document.getElementById('new-worker-name');
  const codeInput = document.getElementById('new-worker-code');
  const name = nameInput.value.trim();
  const code = codeInput.value.trim();
  
  if (!name || !code) {
    alert('Please enter both name and code');
    return;
  }
  
  // Check for duplicate code
  if (state.workers.some(w => w.code === code)) {
    alert('This code is already in use');
    return;
  }
  
  const newWorker = {
    id: 0, // Let Google Apps Script handle ID
    name,
    code
  };
  
  // Save to Google Sheets first
  await saveSingleWorker(newWorker);
  
  // Refresh workers from Google Sheets
  const result = await callSheets('listWorkers');
  if (result && result.ok && result.data) {
    state.workers = result.data;
    cache.set('evernote_workers', state.workers);
  }
  
  renderWorkerList();
  
  // Also update worker filter list if we're on worker-notes section
  if (state.adminActiveSection === 'worker-notes') {
    const lastWorker = state.workers[state.workers.length - 1];
    if (lastWorker) {
      state.selectedWorkersForFilter.add(lastWorker.id);
    }
    renderWorkerFilterList();
    renderFilteredNotes();
  }
  
  // Clear inputs
  nameInput.value = '';
  codeInput.value = '';
}

async function deleteWorker(workerId) {
  console.log('deleteWorker called with workerId:', workerId);
  const worker = state.workers.find(w => w.id === workerId);
  console.log('Found worker to delete:', worker);
  if (!worker) return;

  if (!confirm(`Are you sure you want to delete ${worker.name}?`)) return;

  // Delete from Google Sheets first
  console.log('Calling deleteSingleWorker with id:', workerId);
  await deleteSingleWorker(workerId);

  // Refresh workers from Google Sheets
  const result = await callSheets('listWorkers');
  console.log('listWorkers result:', result);
  if (result && result.ok && result.data) {
    state.workers = result.data;
    cache.set('evernote_workers', state.workers);
  }

  // Remove from filter selection too
  state.selectedWorkersForFilter.delete(workerId);
  
  renderWorkerList();
  
  // Also update worker filter list if we're on worker-notes section
  if (state.adminActiveSection === 'worker-notes') {
    renderWorkerFilterList();
    renderFilteredNotes();
  }
}

function editWorker(workerId) {
  const worker = state.workers.find(w => w.id === workerId);
  if (!worker) return;

  state.editingWorkerId = workerId;
  document.getElementById('edit-worker-name').value = worker.name;
  document.getElementById('edit-worker-code').value = worker.code;

  document.getElementById('edit-worker-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

async function saveWorkerChanges() {
  if (!state.editingWorkerId) return;

  const name = document.getElementById('edit-worker-name').value.trim();
  const code = document.getElementById('edit-worker-code').value.trim();

  if (!name || !code) {
    alert('Please enter both name and code');
    return;
  }

  // Check for duplicate code (excluding current worker)
  const duplicate = state.workers.find(w => w.code === code && w.id !== state.editingWorkerId);
  if (duplicate) {
    alert('This code is already in use');
    return;
  }

  // Update worker
  const workerIndex = state.workers.findIndex(w => w.id === state.editingWorkerId);
  if (workerIndex !== -1) {
    // If name changed, we need to update note agent names in notes too!
    const oldName = state.workers[workerIndex].name;
    
    // Save to Google Sheets first
    await saveSingleWorker({
      id: state.editingWorkerId,
      name: name,
      code: code
    });
    
    // Refresh workers from Google Sheets
    const result = await callSheets('listWorkers');
    if (result && result.ok && result.data) {
      state.workers = result.data;
      cache.set('evernote_workers', state.workers);
    }
    
    renderWorkerList();
    
    // Also update worker filter list if we're on worker-notes section
    if (state.adminActiveSection === 'worker-notes') {
      // Update all notes' agent names in cache
      let allNotes = cache.get('notes_list') || [];
      allNotes = allNotes.map(note => {
        if (note.Agent === oldName) {
          return { ...note, Agent: name };
        }
        return note;
      });
      cache.set('notes_list', allNotes);
      
      renderWorkerFilterList();
      renderFilteredNotes();
    }
  }

  closeEditWorkerModal();
}

function closeEditWorkerModal() {
  state.editingWorkerId = null;
  document.getElementById('edit-worker-modal').classList.add('hidden');
  document.body.style.overflow = 'auto';
}

// Check saved login and return user if valid (within 6 hours)
function checkSavedLogin() {
  const loginStr = localStorage.getItem('evernote_login');
  if (!loginStr) return null;
  
  try {
    const loginData = JSON.parse(loginStr);
    const SIX_HOURS = 6 * 60 * 60 * 1000; // 6 hours in milliseconds
    
    if (Date.now() - loginData.timestamp < SIX_HOURS) {
      return loginData.user;
    } else {
      // Expired, clear it
      clearLoginData();
      return null;
    }
  } catch (e) {
    // Invalid data, clear it
    clearLoginData();
    return null;
  }
}

// --- Initialization ---

async function init() {
  // Initialize workers
  await initWorkers();

  // Access screen keypad listeners
  document.querySelectorAll('.keypad-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const digit = btn.dataset.digit;
      const action = btn.dataset.action;
      if (digit !== undefined) {
        enteredCode += digit;
        updateCodeDisplay();
        // Check code after every digit press (auto-login)
        checkAndLogin();
      } else if (action === 'delete') {
        enteredCode = enteredCode.slice(0, -1);
        updateCodeDisplay();
      } else if (action === 'clear') {
        enteredCode = '';
        updateCodeDisplay();
      }
    });
  });

  // Logout buttons (note: worker logout-btn is removed, kept just in case, but now we use menu)

  // Worker dashboard listeners
  const star = document.getElementById("star");
  if (star) star.style.display = "none";

  const noteDate = document.getElementById("note-date");
  if (noteDate) noteDate.value = "";

  document.getElementById("tab-today").addEventListener("click", () => setTab("today"));
  document.getElementById("tab-all").addEventListener("click", () => setTab("all"));

  const closeBtn = document.getElementById("close-modal");
  if (closeBtn) closeBtn.addEventListener("click", closeModal);

  const modal = document.getElementById("note-modal");
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
  }

  const pasteBtn = document.getElementById("paste-phone");
  if (pasteBtn) {
    pasteBtn.addEventListener("click", async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          const phoneInput = document.getElementById("phone");
          phoneInput.value = text.trim();
          checkDuplicate(text.trim());
        }
      } catch (err) {
        console.error('Failed to read clipboard contents:', err);
        document.getElementById("phone").focus();
      }
    });
  }

  const phoneInput = document.getElementById("phone");
  if (phoneInput) {
    phoneInput.addEventListener("input", (e) => {
      checkDuplicate(e.target.value.trim());
    });
  }

  document.getElementById("save").addEventListener("click", async () => {
    if (state.currentUser?.role !== 'worker') return;

    const phoneInputVal = document.getElementById("phone").value.trim();
    const noteVal = document.getElementById("note").value.trim();
    const noteDateVal = document.getElementById("note-date").value;

    let phone = phoneInputVal.replace(/[^\d+]/g, '');
    if (phone.startsWith('+88')) {
      phone = phone.substring(3);
    } else if (phone.startsWith('88')) {
      phone = phone.substring(2);
    }
    phone = phone.replace(/\D/g, '');

    if(!phone || !noteVal) {
      alert("Please fill Number and Note fields!");
      return;
    }

    document.getElementById("save").disabled = true;

    const finalDate = noteDateVal || fmtDate(new Date());

    const payload = {
      Date: finalDate,
      Number: phone,
      Note: noteVal
    };

    if (state.editingId === null) {
      const res = await listRemote(true);
      const existingNote = res.items.find(n => n.Number === phone && n.Agent === state.currentUser.name);
      if (existingNote) {
        payload.sheetIndex = existingNote.sheetIndex;
      }
    } else {
      payload.sheetIndex = state.editingId;
    }

    const result = await saveNote(payload);

    state.editingId = null;
    const saveBtn = document.getElementById("save");
    saveBtn.textContent = "Save Note";
    saveBtn.classList.remove("editing");

    document.getElementById("save").disabled = false;
    document.getElementById("note").value = "";
    document.getElementById("phone").value = "";
    document.getElementById("note-date").value = "";

    const warningDiv = document.getElementById("duplicate-warning");
    if (warningDiv) warningDiv.classList.add("hidden");

    setTab("today");
  });

  // Admin dashboard listeners - Tabs
  document.getElementById('admin-tab-add-note').addEventListener('click', () => selectAdminMenuItem('add-note'));
  document.getElementById('admin-tab-all-notes').addEventListener('click', () => selectAdminMenuItem('all-notes'));
  
  // Admin dashboard listeners - Note saving
  document.getElementById('admin-save-btn').addEventListener('click', saveAdminNote);
  
  // Admin dashboard listeners - Worker management
  document.getElementById('add-worker-btn').addEventListener('click', addWorker);
  document.getElementById('back-to-workers').addEventListener('click', backToWorkerList);
  document.getElementById('save-worker-btn').addEventListener('click', saveWorkerChanges);
  document.getElementById('close-edit-worker-modal').addEventListener('click', closeEditWorkerModal);

  const editWorkerModal = document.getElementById('edit-worker-modal');
  if (editWorkerModal) {
    editWorkerModal.addEventListener('click', (e) => {
      if (e.target === editWorkerModal) closeEditWorkerModal();
    });
  }

  // Check for saved login
  const savedUser = checkSavedLogin();
  if (savedUser) {
    state.currentUser = savedUser;
    if (savedUser.role === 'admin') {
      showAdminDashboard();
    } else {
      showWorkerDashboard();
    }
  } else {
    // Start with access screen
    showAccessScreen();
  }
}

document.addEventListener("DOMContentLoaded", init);
