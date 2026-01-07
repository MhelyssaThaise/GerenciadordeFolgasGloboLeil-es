/* =========================================================
   GESTÃO DE FOLGAS — script.js (COM SENHA + COLABORADORES AJUSTADO)
   - Tabela principal: mostra SOMENTE folgas registradas na sexta
   - Senha obrigatória: aprovar / rejeitar / remover / excluir / remover folga
   - Botão "Colaboradores": pede senha e abre a tela
   - Tela de colaboradores: lista com avatar + ações editar/excluir (com senha)
   ========================================================= */

const PASSWORD = "03082020";

let selectedFriday = null;
let currentMonth = new Date().getMonth();
let currentYear  = new Date().getFullYear();

let passwordModalAction = null;

// Estado
let employeesDB = [];
let fridayData  = {}; // { "DD/MM/YYYY": [ {id, employeeId, status, notes, employee} ] }

// Supabase
const sb = window.supabase;

/* ===================== HELPERS ===================== */
function toISODate(d){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function toISODateBR(br){
  const [d,m,y] = br.split('/');
  return `${y}-${m}-${d}`;
}
function formatBR(d){
  return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'});
}
function escapeHtml(str=""){
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

/* ===================== INFO MODAL ===================== */
function showInfoModal(title, html){
  document.getElementById('infoModalTitle').textContent = title;
  document.getElementById('infoModalContent').innerHTML = html;
  document.getElementById('infoModal').classList.remove('hidden');
}
function closeInfoModal(){
  document.getElementById('infoModal').classList.add('hidden');
}

/* ===================== PASSWORD MODAL ===================== */
function showPasswordModal(actionFn, opts = {}){
  const modal = document.getElementById("passwordModal");
  const title = document.getElementById("passwordModalTitle");
  const sub   = document.getElementById("passwordModalSubtitle");
  const input = document.getElementById("passwordInput");
  const err   = document.getElementById("passwordError");

  if (title) title.textContent = opts.title || "🔒 Acesso Restrito";
  if (sub) sub.textContent = opts.subtitle || "Digite a senha para continuar";

  passwordModalAction = typeof actionFn === "function" ? actionFn : null;

  err?.classList.add("hidden");
  if (input) input.value = "";

  modal?.classList.remove("hidden");
  setTimeout(() => input?.focus(), 50);
}

function closePasswordModal(){
  const modal = document.getElementById("passwordModal");
  modal?.classList.add("hidden");
}

document.getElementById("passwordForm")?.addEventListener("submit", (e) => {
  e.preventDefault();

  const input = document.getElementById("passwordInput");
  const err   = document.getElementById("passwordError");
  const val = input?.value || "";

  if (val !== PASSWORD){
    err?.classList.remove("hidden");
    return;
  }

  const fn = passwordModalAction;
  passwordModalAction = null;

  closePasswordModal();

  try {
    if (typeof fn === "function") {
      Promise.resolve(fn()).catch(console.error);
    }
  } catch (ex) {
    console.error(ex);
  }
});

function requirePasswordThen(actionFn, opts){
  showPasswordModal(actionFn, opts);
}

/* ===================== PERIOD SELECTS ===================== */
function initPeriodSelectors(){
  const yearSel = document.getElementById("yearSelect");
  const monthSel = document.getElementById("monthSelect");
  if (!yearSel || !monthSel) return;

  const base = new Date().getFullYear();
  yearSel.innerHTML = "";
  for (let y = base - 2; y <= base + 2; y++){
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    if (y === currentYear) opt.selected = true;
    yearSel.appendChild(opt);
  }

  const months = [
    "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
    "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"
  ];
  monthSel.innerHTML = "";
  months.forEach((name, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = name;
    if (i === currentMonth) opt.selected = true;
    monthSel.appendChild(opt);
  });

  function onChange(){
    currentYear = parseInt(yearSel.value, 10);
    currentMonth = parseInt(monthSel.value, 10);
    selectedFriday = null;
    document.getElementById('tableTitle').textContent = "Colaboradores - Selecione uma sexta-feira";
    syncFromDB();
  }

  yearSel.addEventListener("change", onChange);
  monthSel.addEventListener("change", onChange);
}

/* ===================== SYNC DB ===================== */
async function syncFromDB(){
  try{
    const { data: emps, error: empErr } = await sb
      .from('funcionarios')
      .select('*')
      .order('name');

    if (empErr) throw empErr;
    employeesDB = emps || [];

    const start = new Date(currentYear, currentMonth, 1);
    const end   = new Date(currentYear, currentMonth + 1, 1);

    const { data: leaves, error: leaveErr } = await sb
      .from('folgas')
      .select('*')
      .gte('friday_date', toISODate(start))
      .lt('friday_date', toISODate(end));

    if (leaveErr) throw leaveErr;

    fridayData = {};
    const empMap = new Map(employeesDB.map(e => [e.id, e]));

    (leaves||[]).forEach(l=>{
      const d = new Date(l.friday_date + 'T00:00:00');
      const key = formatBR(d);
      if (!fridayData[key]) fridayData[key] = [];
      fridayData[key].push({
        id: l.id,
        employeeId: l.employee_id,
        status: l.status,
        notes: l.notes || '',
        employee: empMap.get(l.employee_id)
      });
    });

    updateAll();
    renderEmployeesPageList();
    updateEmployeesPageKPIs();
  }catch(e){
    console.error(e);
    showInfoModal(
      "❌ Erro Supabase",
      `<div>${escapeHtml(e.message || "Erro desconhecido")}</div>
       <div class="text-xs text-gray-500">Verifique RLS / policies</div>`
    );
  }
}

/* ===================== UI (BADGES / STATS) ===================== */
function getStatusBadge(status){
  if (status==='Folga')
    return '<span class="px-3 py-1 rounded-full text-sm bg-green-100 text-green-800">✅ Folga</span>';
  if (status==='Pendente')
    return '<span class="px-3 py-1 rounded-full text-sm bg-yellow-100 text-yellow-800">⏳ Pendente</span>';
  if (status==='Rejeitada')
    return '<span class="px-3 py-1 rounded-full text-sm bg-red-100 text-red-800">❌ Rejeitada</span>';
  return '<span class="px-3 py-1 rounded-full text-sm bg-gray-100 text-gray-700">—</span>';
}

function updateStats(){
  const total = employeesDB.length;
  document.getElementById('totalEmployees').textContent = total;

  const leavesToday = selectedFriday ? (fridayData[selectedFriday] || []) : [];
  let onLeave = 0, pending = 0;

  leavesToday.forEach(l=>{
    if (l.status === 'Folga') onLeave++;
    if (l.status === 'Pendente') pending++;
  });

  document.getElementById('onLeave').textContent = onLeave;
  document.getElementById('pendingRequests').textContent = pending;
  document.getElementById('working').textContent = Math.max(0, total - onLeave - pending);

  let headerPending = 0;
  Object.values(fridayData).forEach(list=>{
    headerPending += (list||[]).filter(l=>l.status==='Pendente').length;
  });
  document.getElementById('headerPendingCount').textContent = headerPending;
}

/* ===================== FRIDAYS ===================== */
function getFridaysInMonth(y,m){
  const out=[];
  const d=new Date(y,m,1);
  while(d.getDay()!==5) d.setDate(d.getDate()+1);
  while(d.getMonth()===m){ out.push(new Date(d)); d.setDate(d.getDate()+7); }
  return out;
}

function renderFridaysGrid(){
  const grid = document.getElementById('fridaysGrid');
  if (!grid) return;
  grid.innerHTML = '';

  getFridaysInMonth(currentYear, currentMonth).forEach(d=>{
    const key = formatBR(d);
    const list = fridayData[key] || [];
    const count = list.filter(l => l.status==='Folga' || l.status==='Pendente' || l.status==='Rejeitada').length;

    const card = document.createElement('div');
    card.className = `border rounded-xl p-4 cursor-pointer ${
      selectedFriday===key ? 'border-purple-500 bg-purple-50' : 'border-gray-200'
    }`;
    card.onclick = () => selectFriday(key);
    card.innerHTML = `
      <div class="text-center">
        <div class="text-2xl font-bold">${d.getDate()}</div>
        <div class="text-sm text-gray-600">${key}</div>
        <div class="text-xs text-gray-500 mt-2">👥 ${count}</div>
      </div>`;
    grid.appendChild(card);
  });
}

function selectFriday(key){
  selectedFriday = key;
  document.getElementById('tableTitle').textContent = `Colaboradores - ${key}`;
  renderFridaysGrid();
  renderLeavesTable();
}

/* ===================== TABLE (SÓ REGISTRADOS) ===================== */
function renderLeavesTable(){
  const tbody = document.getElementById('employeeTableBody');
  if (!tbody) return;

  if (!selectedFriday){
    tbody.innerHTML = `
      <tr><td colspan="5" class="py-8 px-6 text-center text-gray-500">
        Selecione uma sexta-feira para visualizar as folgas registradas.
      </td></tr>`;
    updateStats();
    return;
  }

  const leavesToday = (fridayData[selectedFriday] || [])
    .filter(l => l.status==='Folga' || l.status==='Pendente' || l.status==='Rejeitada');

  if (!leavesToday.length){
    tbody.innerHTML = `
      <tr><td colspan="5" class="py-8 px-6 text-center text-gray-500">
        Nenhuma folga registrada para <b>${selectedFriday}</b>.
      </td></tr>`;
    updateStats();
    return;
  }

  tbody.innerHTML = leavesToday.map(l=>{
    const emp = l.employee || {};
    const photo = emp.photo_url
      ? `<img src="${emp.photo_url}" class="w-10 h-10 rounded-full object-cover">`
      : `<div class="w-10 h-10 rounded-full bg-purple-500 text-white flex items-center justify-center font-bold">
           ${(emp.name || "?").charAt(0)}
         </div>`;

    let actions = '';
    if (l.status === 'Pendente'){
      actions = `
        <button onclick="approveLeave(${l.id})" class="text-green-600 mr-2">Aprovar</button>
        <button onclick="rejectLeave(${l.id})" class="text-red-600 mr-2">Rejeitar</button>
        <button onclick="removeFromFriday(${l.id})" class="text-gray-600">Remover</button>`;
    } else if (l.status === 'Folga'){
      actions = `
        <button onclick="toggleStatus(${l.id})" class="text-purple-600 mr-2">Remover folga</button>
        <button onclick="removeFromFriday(${l.id})" class="text-red-600">Excluir</button>`;
    } else {
      actions = `<button onclick="removeFromFriday(${l.id})" class="text-red-600">Remover</button>`;
    }

    return `
      <tr class="border-b">
        <td class="py-4 px-6">
          <div class="flex items-center">
            ${photo}
            <div class="ml-3">
              <div class="font-medium">${escapeHtml(emp.name || "-")}</div>
              <div class="text-xs text-gray-500">${escapeHtml(emp.email || "")}</div>
            </div>
          </div>
        </td>
        <td class="py-4 px-6">${escapeHtml(emp.department || "")}</td>
        <td class="py-4 px-6">${getStatusBadge(l.status)}</td>
        <td class="py-4 px-6">${l.notes ? escapeHtml(l.notes) : '-'}</td>
        <td class="py-4 px-6 text-center">${actions}</td>
      </tr>`;
  }).join("");

  updateStats();
}

/* ===================== FOLGAS (AÇÕES REAIS) ===================== */
async function dbUpsertLeave(employeeId, fridayBR){
  await sb.from('folgas').upsert({
    employee_id: employeeId,
    friday_date: toISODateBR(fridayBR),
    status: 'Pendente',
    notes: 'Aguardando aprovação'
  }, { onConflict: 'employee_id,friday_date' });

  await syncFromDB();
}

// internos
async function _approveLeave(id){
  await sb.from('folgas').update({status:'Folga'}).eq('id', id);
  syncFromDB();
}
async function _rejectLeave(id){
  await sb.from('folgas').update({status:'Rejeitada'}).eq('id', id);
  syncFromDB();
}
async function _removeFromFriday(id){
  await sb.from('folgas').delete().eq('id', id);
  syncFromDB();
}
async function _toggleStatus(id){
  await sb.from('folgas').delete().eq('id', id);
  syncFromDB();
}

// públicos (COM SENHA)
function approveLeave(id){
  requirePasswordThen(() => _approveLeave(id), {
    title: "🔒 Confirmação",
    subtitle: "Digite a senha para aprovar a folga"
  });
}
function rejectLeave(id){
  requirePasswordThen(() => _rejectLeave(id), {
    title: "🔒 Confirmação",
    subtitle: "Digite a senha para rejeitar a folga"
  });
}
function removeFromFriday(id){
  requirePasswordThen(() => _removeFromFriday(id), {
    title: "🔒 Confirmação",
    subtitle: "Digite a senha para excluir a folga"
  });
}
function toggleStatus(id){
  requirePasswordThen(() => _toggleStatus(id), {
    title: "🔒 Confirmação",
    subtitle: "Digite a senha para remover a folga"
  });
}

/* ===================== MODAL REGISTRAR FOLGA ===================== */
function openRegisterLeaveModal(){
  if (!selectedFriday){
    showInfoModal("⚠️ Atenção", "Selecione uma sexta-feira.");
    return;
  }
  populateEmployeeSelect();
  document.getElementById('registerLeaveModal').classList.remove('hidden');
}
function closeRegisterLeaveModal(){
  document.getElementById('registerLeaveModal').classList.add('hidden');
}

function populateEmployeeSelect(){
  const s = document.getElementById('leaveEmployeeSelect');
  s.innerHTML = '<option value="">Selecione…</option>';

  const leavesToday = selectedFriday ? (fridayData[selectedFriday] || []) : [];
  const registered = new Set(leavesToday.map(l => l.employeeId));

  employeesDB.forEach(e=>{
    if (registered.has(e.id)) return;
    s.innerHTML += `<option value="${e.id}">${escapeHtml(e.name)} - ${escapeHtml(e.department||'')}</option>`;
  });

  if (s.options.length === 1){
    s.innerHTML = `<option value="">Todos já estão registrados nesta sexta.</option>`;
  }
}

document.getElementById('registerLeaveForm')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const empId = parseInt(document.getElementById('leaveEmployeeSelect').value, 10);
  if (!empId) return;
  await dbUpsertLeave(empId, selectedFriday);
  closeRegisterLeaveModal();
});

/* ===================== COLABORADORES (TELA ABRE/FECHA) ===================== */
function openEmployeesPage(){
  document.getElementById("employeesPage")?.classList.remove("hidden");
  renderEmployeesPageList();
  updateEmployeesPageKPIs();
}
function closeEmployeesPage(){
  document.getElementById("employeesPage")?.classList.add("hidden");
  hideAddEmployeeForm();
}

/* abre com senha */
function openEmployeesWithPassword(){
  requirePasswordThen(() => openEmployeesPage(), {
    title: "🔒 Acesso Restrito",
    subtitle: "Digite a senha para acessar Colaboradores"
  });
}

function showAddEmployeeForm(){
  document.getElementById("addEmployeeFormSection")?.classList.remove("hidden");
}
function hideAddEmployeeForm(){
  const section = document.getElementById("addEmployeeFormSection");
  section?.classList.add("hidden");

  const form = document.getElementById("addEmployeeFormPage");
  form?.reset?.();
  if (form?.dataset?.editingId) delete form.dataset.editingId;

  const prev = document.getElementById("photoPreviewPage");
  if (prev) prev.innerHTML = "📷";
}

function updateEmployeesPageKPIs(){
  const totalEl = document.getElementById("totalEmployeesPage");
  const depEl   = document.getElementById("totalDepartments");
  const todayEl = document.getElementById("todayRegistrations");

  if (totalEl) totalEl.textContent = employeesDB.length;

  const departments = new Set(employeesDB.map(e => (e.department||"").trim()).filter(Boolean));
  if (depEl) depEl.textContent = departments.size;

  const now = new Date();
  let today = 0;
  employeesDB.forEach(e=>{
    if (!e.created_at) return;
    const dt = new Date(e.created_at);
    if (dt.getFullYear()===now.getFullYear() && dt.getMonth()===now.getMonth() && dt.getDate()===now.getDate()) today++;
  });
  if (todayEl) todayEl.textContent = today;
}

/* ======= LISTA AJUSTADA (AVATAR + AÇÕES) ======= */
function renderEmployeesPageList(){
  const tbody = document.getElementById("employeesListTable");
  if (!tbody) return;

  if (!employeesDB.length){
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="py-6 px-4 text-gray-500">Nenhum colaborador cadastrado.</td>
      </tr>`;
    return;
  }

  tbody.innerHTML = employeesDB.map(emp=>{
    const created = emp.created_at ? new Date(emp.created_at).toLocaleDateString("pt-BR") : "-";

    const photo = emp.photo_url
      ? `<img src="${emp.photo_url}" class="w-10 h-10 rounded-full object-cover border border-gray-200">`
      : `<div class="w-10 h-10 rounded-full bg-purple-500 text-white flex items-center justify-center font-bold">
           ${(emp.name || "?").charAt(0)}
         </div>`;

    return `
      <tr class="border-b hover:bg-gray-50">
        <td class="py-4 px-4">
          <div class="flex items-center gap-3">
            ${photo}
            <div class="leading-tight">
              <div class="font-medium text-gray-900">${escapeHtml(emp.name || "-")}</div>
              <div class="text-xs text-gray-500">${escapeHtml(emp.email || "")}</div>
            </div>
          </div>
        </td>

        <td class="py-4 px-4">
          <span class="inline-flex items-center px-3 py-1 rounded-full text-xs bg-gray-100 text-gray-700">
            ${escapeHtml(emp.department || "-")}
          </span>
        </td>

        <td class="py-4 px-4 text-gray-600">${created}</td>

        <td class="py-4 px-4 text-center">
          <button class="text-purple-700 hover:underline mr-3"
            onclick="editEmployeeWithPassword(${emp.id})">Editar</button>
          <button class="text-red-600 hover:underline"
            onclick="deleteEmployeeWithPassword(${emp.id})">Excluir</button>
        </td>
      </tr>`;
  }).join("");
}

/* ======= AÇÕES (EDITAR / EXCLUIR) COM SENHA ======= */
function editEmployeeWithPassword(id){
  requirePasswordThen(() => editEmployee(id), {
    title: "🔒 Confirmação",
    subtitle: "Digite a senha para editar colaborador"
  });
}

function deleteEmployeeWithPassword(id){
  requirePasswordThen(() => deleteEmployee(id), {
    title: "🔒 Confirmação",
    subtitle: "Digite a senha para excluir colaborador"
  });
}

function editEmployee(id){
  const emp = employeesDB.find(e => e.id === id);
  if (!emp) return;

  showAddEmployeeForm();

  document.getElementById("employeeNamePage").value = emp.name || "";
  document.getElementById("employeeEmailPage").value = emp.email || "";
  document.getElementById("employeeDepartmentPage").value = emp.department || "Comercial";

  const form = document.getElementById("addEmployeeFormPage");
  form.dataset.editingId = String(id);
}

async function deleteEmployee(id){
  const emp = employeesDB.find(e => e.id === id);
  if (!emp) return;

  const ok = confirm(`Excluir colaborador "${emp.name}"?`);
  if (!ok) return;

  const { error } = await sb.from("funcionarios").delete().eq("id", id);
  if (error){
    console.error(error);
    showInfoModal("❌ Erro", `<div>${escapeHtml(error.message)}</div>`);
    return;
  }

  await syncFromDB();
}

/* ======= SUBMIT: INSERT ou UPDATE ======= */
document.getElementById("addEmployeeFormPage")?.addEventListener("submit", async (e)=>{
  e.preventDefault();

  const form = document.getElementById("addEmployeeFormPage");
  const editingId = form?.dataset?.editingId ? parseInt(form.dataset.editingId, 10) : null;

  const name = document.getElementById("employeeNamePage")?.value?.trim();
  const email = document.getElementById("employeeEmailPage")?.value?.trim();
  const department = document.getElementById("employeeDepartmentPage")?.value?.trim() || "";

  if (!name || !email) return;

  let res;
  if (editingId){
    res = await sb.from("funcionarios").update({ name, email, department }).eq("id", editingId);
  } else {
    res = await sb.from("funcionarios").insert({ name, email, department, photo_url: null });
  }

  if (res.error){
    console.error(res.error);
    showInfoModal("❌ Erro", `<div>${escapeHtml(res.error.message)}</div>`);
    return;
  }

  hideAddEmployeeForm();
  await syncFromDB();
});

/* ===================== HEADER EXTRAS (stubs) ===================== */
function showAllLeaves(){
  showInfoModal("📊 Ver Todas as Folgas", "<div class='text-sm'>Ainda não implementado.</div>");
}
function showPendingRequests(){
  showInfoModal("⏳ Pendências", "<div class='text-sm'>Ainda não implementado.</div>");
}

/* ===================== INIT ===================== */
function updateAll(){
  renderFridaysGrid();
  renderLeavesTable();
}

document.addEventListener("DOMContentLoaded", async ()=>{
  initPeriodSelectors();
  await syncFromDB();
  renderFridaysGrid();
  renderLeavesTable();
});

/* ===================== EXPORT ===================== */
Object.assign(window, {
  showInfoModal, closeInfoModal,
  showPasswordModal, closePasswordModal,

  openRegisterLeaveModal, closeRegisterLeaveModal,
  approveLeave, rejectLeave, removeFromFriday, toggleStatus,
  selectFriday,

  openEmployeesPage, closeEmployeesPage,
  openEmployeesWithPassword,
  showAddEmployeeForm, hideAddEmployeeForm,

  // novos exports (precisa pro onclick)
  editEmployeeWithPassword,
  deleteEmployeeWithPassword,

  showAllLeaves, showPendingRequests
});
