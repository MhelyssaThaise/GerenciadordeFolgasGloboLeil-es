/* =========================================================
   GESTÃO DE FOLGAS — script.js (Supabase Edition)
   Tabelas: funcionarios, folgas
   Colunas esperadas:

   funcionarios:
     id (bigint, PK)
     name text      
     email text
     department text
     photo_url text
     created_at timestamptz default now()

   folgas:
     id (bigint, PK)
     employee_id bigint (FK -> funcionarios.id)
     friday_date date
     status text
     notes text
     created_at timestamptz default now()
   ========================================================= */

// ===== Variáveis globais de UI/fluxo =====
const PASSWORD = "03082020";
let selectedFriday = null;
let currentMonth = new Date().getMonth();
let currentYear  = new Date().getFullYear();
let passwordModalAction = null;
let editingEmployeeId = null;
let pendingRemoveFromFridayId = null;

// Estado em memória (sincronizado com DB)
let fridayData = {};     // { 'DD/MM/YYYY': [ {id,globalId,name,department,status,notes} ] }
let employeesDB = [];    // [{ id, name, email, department, photo_url, created_at }]

// ===================== SUPABASE =========================
const sb = window.supabase; // criado no HTML

if (!sb) {
  console.error("❌ Supabase client não encontrado em window.supabase.");
}

// Lista fixa de departamentos (edite aqui quando precisar)
const DEPARTMENTS = [
  "Comercial",
  "Tecnologia",
  "Backoffice",
  "Administrativo",
  "Jurídico",
  "Pós-leilão",
  "Averbações e Avaliações",
  "Marketing"
];

// Helpers de data
function toISODateBR(ddmmyyyy){
  const [d,m,y] = ddmmyyyy.split('/');
  return `${y}-${m}-${d}`;
}
function toISODate(d){
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

// --------- Sync geral (puxa funcionarios + folgas do mês) ----------
async function syncFromDB() {
  try {
    if (!sb) throw new Error("Supabase client não inicializado.");

    // 1) Funcionários
    const { data: emps, error: empErr } = await sb
      .from("funcionarios")
      .select("*")
      .order("name", { ascending: true });

    if (empErr) throw empErr;
    employeesDB = emps || [];
    console.log("✅ Funcionários carregados:", employeesDB.length);

    // 2) Folgas do mês atual
    const monthStart = new Date(currentYear, currentMonth, 1);
    const monthEnd   = new Date(currentYear, currentMonth + 1, 1);

    const { data: leaves, error: folgaErr } = await sb
      .from("folgas")
      .select("*")
      .gte("friday_date", toISODate(monthStart))
      .lt("friday_date", toISODate(monthEnd));

    if (folgaErr) throw folgaErr;

    console.log("✅ Folgas carregadas para o mês:", leaves?.length || 0);

    // 3) Monta fridayData
    const empMap = new Map(employeesDB.map(e => [e.id, e]));
    fridayData = {};

    (leaves || []).forEach(l => {
      const d   = new Date(l.friday_date + "T00:00:00");
      const key = d.toLocaleDateString("pt-BR", { day:"2-digit", month:"2-digit", year:"numeric" });
      const emp = empMap.get(l.employee_id);
      if (!fridayData[key]) fridayData[key] = [];
      fridayData[key].push({
        id: l.id,                 // id da folga
        globalId: l.employee_id,  // id do funcionário
        name: emp?.name || "",
        department: emp?.department || "",
        status: l.status,
        notes: l.notes || ""
      });
    });

    updateAllInterfaces();
  } catch (e) {
    console.error("❌ Erro ao sincronizar com a Supabase:", e);
    // Mantemos só o log no console para debug, sem travar a UI com modal.
  }
}

// --------- Operações de DB (funcionários) ----------
async function dbAddEmployee({ name, email, department, photo }) {
  const { data, error } = await sb
    .from("funcionarios")
    .insert({ name, email, department, photo_url: photo || null })
    .select()
    .single();

  if (error) throw error;
  await syncFromDB();
  return data;
}

async function dbUpdateEmployee(id, { name, email, department, photo }) {
  const payload = { name, email, department };
  if (photo !== undefined) payload.photo_url = photo;

  const { error } = await sb
    .from("funcionarios")
    .update(payload)
    .eq("id", id);

  if (error) throw error;
  await syncFromDB();
}

async function dbDeleteEmployee(id) {
  // remove folgas do funcionário (caso não esteja com ON DELETE CASCADE)
  await sb.from("folgas").delete().eq("employee_id", id);

  const { error } = await sb
    .from("funcionarios")
    .delete()
    .eq("id", id);

  if (error) throw error;
  await syncFromDB();
}

// --------- Operações de DB (folgas) ----------
async function dbUpsertLeave(employeeId, fridayBR, status="Pendente", notes="Aguardando aprovação da gestão") {
  const fridayISO = toISODateBR(fridayBR);

  const { error } = await sb
    .from("folgas")
    .upsert({
      employee_id: employeeId,
      friday_date: fridayISO,
      status,
      notes
    }); // sem onConflict explícito

  if (error) throw error;
  await syncFromDB();
}

async function dbSetLeaveStatus(leaveId, newStatus, newNotes) {
  const { error } = await sb
    .from("folgas")
    .update({ status: newStatus, notes: newNotes ?? null })
    .eq("id", leaveId);

  if (error) throw error;
  await syncFromDB();
}

async function dbRemoveFromFriday(leaveId) {
  const { error } = await sb.from("folgas").delete().eq("id", leaveId);
  if (error) throw error;
  await syncFromDB();
}

// Desativa localStorage antigo
function saveToLocalStorage() {}
function loadFromLocalStorage(){ return false; }
function clearLocalStorage()   {}

// ====================== UI / RENDER ======================
function updateAllInterfaces() {
  try {
    updateStats();
    renderEmployees();
    renderFridaysGrid();

    const empPage = document.getElementById("employeesPage");
    if (empPage && !empPage.classList.contains("hidden")) {
      updateEmployeesPageStats();
      renderEmployeesList();
    }

    populateEmployeeSelect();
  } catch (e) {
    console.error("❌ Erro ao atualizar UI:", e);
  }
}

function updateStats() {
  const totalEmployeesInSystem = employeesDB.length;
  const elTotal = document.getElementById("totalEmployees");
  if (elTotal) elTotal.textContent = totalEmployeesInSystem;

  const employees = selectedFriday ? (fridayData[selectedFriday] || []) : [];
  const onLeave  = employees.filter(e => e.status === "Folga").length;
  const working  = employees.filter(e => e.status === "Trabalhando").length;
  const pending  = employees.filter(e => e.status === "Pendente").length;

  const elOnLeave = document.getElementById("onLeave"); if (elOnLeave) elOnLeave.textContent = onLeave;
  const elWork    = document.getElementById("working"); if (elWork) elWork.textContent = working;
  const elPend    = document.getElementById("pendingRequests"); if (elPend) elPend.textContent = pending;

  let totalPending = 0;
  Object.keys(fridayData).forEach(k => {
    totalPending += (fridayData[k] || []).filter(e => e.status === "Pendente").length;
  });
  const elHeader = document.getElementById("headerPendingCount");
  if (elHeader) elHeader.textContent = totalPending;
}

function getStatusBadge(status) {
  if (status === "Folga")
    return '<span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">✅ Folga</span>';
  if (status === "Pendente")
    return '<span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800">⏳ Pendente</span>';
  if (status === "Rejeitada")
    return '<span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-800">❌ Rejeitada</span>';

  return '<span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-orange-100 text-orange-800">💼 Trabalhando</span>';
}

function renderEmployees() {
  const tbody = document.getElementById("employeeTableBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!selectedFriday) {
    tbody.innerHTML = '<tr><td colspan="5" class="py-8 px-6 text-center text-gray-500">Selecione uma sexta-feira para visualizar os colaboradores</td></tr>';
    updateStats();
    return;
  }

  const employees = fridayData[selectedFriday] || [];
  if (employees.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="py-8 px-6 text-center text-gray-500">Nenhum colaborador cadastrado para esta sexta-feira</td></tr>';
    updateStats();
    return;
  }

  employees.forEach(empRow => {
    const glob = employeesDB.find(e => e.id === empRow.globalId);

    const displayName = empRow.name || glob?.name || "";

    const photoDisplay = (glob?.photo_url)
      ? `<img src="${glob.photo_url}" class="w-10 h-10 object-cover rounded-full">`
      : `<div class="w-10 h-10 bg-gradient-to-r from-purple-400 to-pink-400 rounded-full flex items-center justify-center text-white font-semibold">${displayName.charAt(0)}</div>`;

    const tr = document.createElement("tr");
    tr.className = "table-row border-b border-gray-100";
    tr.innerHTML = `
      <td class="py-4 px-6">
        <div class="flex items-center">
          ${photoDisplay}
          <div class="ml-3">
            <div class="font-medium text-gray-900">${displayName}</div>
          </div>
        </div>
      </td>
      <td class="py-4 px-6 text-gray-700">${empRow.department}</td>
      <td class="py-4 px-6">${getStatusBadge(empRow.status)}</td>
      <td class="py-4 px-6 text-gray-600">${empRow.notes || "-"}</td>
      <td class="py-4 px-6 text-center">
        ${empRow.status === "Pendente" ? `
          <button onclick="approveLeave(${empRow.id})" class="text-green-600 hover:text-green-800 font-medium mr-2 px-3 py-1 bg-green-50 rounded-lg">✅ Aprovar</button>
          <button onclick="rejectLeave(${empRow.id})" class="text-red-600 hover:text-red-800 font-medium mr-2 px-3 py-1 bg-red-50 rounded-lg">❌ Rejeitar</button>
        ` : `
          <button onclick="toggleStatus(${empRow.id})" class="text-purple-600 hover:text-purple-800 font-medium mr-3">Alterar Status</button>
        `}
        <button onclick="removeEmployee(${empRow.id})" class="text-red-600 hover:text-red-800 font-medium">Remover</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  updateStats();
}

// ======= Ações (folgas) =======
function toggleStatus(leaveId) {
  passwordModalAction = "toggle";
  window.pendingToggleId = leaveId;
  document.getElementById("passwordModalTitle").textContent = "🔒 Alterar Status";
  document.getElementById("passwordModalSubtitle").textContent = "Digite a senha de gestor para alterar o status";
  document.getElementById("passwordModal").style.display = "flex";
  setTimeout(() => document.getElementById("passwordInput")?.focus(), 100);
}

async function processToggle() {
  if (!window.pendingToggleId) return;

  const leaveId = window.pendingToggleId;
  let leaveRow;
  Object.values(fridayData).forEach(list => {
    const x = list.find(r => r.id === leaveId);
    if (x) leaveRow = x;
  });
  if (!leaveRow) return;

  const newStatus = leaveRow.status === "Folga" ? "Trabalhando" : "Folga";
  await dbSetLeaveStatus(leaveId, newStatus, `Status alterado para: ${newStatus}`);
  showInfoModal("✅ Sucesso", `<div class="text-center space-y-2"><div class="text-5xl">🔄</div><div>Status alterado para <b>${newStatus}</b></div></div>`);
  window.pendingToggleId = null;
}

function approveLeave(leaveId) {
  passwordModalAction = "approve";
  window.pendingApprovalId = leaveId;
  document.getElementById("passwordModalTitle").textContent = "🔒 Aprovação de Folga";
  document.getElementById("passwordModalSubtitle").textContent = "Digite a senha de gestor para aprovar esta folga";
  document.getElementById("passwordModal").style.display = "flex";
  setTimeout(() => document.getElementById("passwordInput")?.focus(), 100);
}

async function processApproval() {
  if (!window.pendingApprovalId) return;
  await dbSetLeaveStatus(window.pendingApprovalId, "Folga", "Folga aprovada pela gestão");
  showInfoModal("✅ Aprovação", '<div class="text-center text-green-600">Folga aprovada!</div>');
  window.pendingApprovalId = null;
}

function rejectLeave(leaveId) {
  passwordModalAction = "reject";
  window.pendingApprovalId = leaveId;
  document.getElementById("passwordModalTitle").textContent = "🔒 Rejeição de Folga";
  document.getElementById("passwordModalSubtitle").textContent = "Digite a senha de gestor para rejeitar esta folga";
  document.getElementById("passwordModal").style.display = "flex";
  setTimeout(() => document.getElementById("passwordInput")?.focus(), 100);
}

async function processRejection() {
  if (!window.pendingApprovalId) return;
  await dbSetLeaveStatus(window.pendingApprovalId, "Rejeitada", "Solicitação rejeitada pela gestão");
  showInfoModal("❌ Rejeição", '<div class="text-center text-red-600">Solicitação rejeitada.</div>');
  window.pendingApprovalId = null;
}

// Remover da sexta (folga específica)
function removeEmployee(leaveId) {
  pendingRemoveFromFridayId = leaveId;
  passwordModalAction = "remove_from_friday";
  document.getElementById("passwordModalTitle").textContent = "🔒 Remover desta Sexta";
  document.getElementById("passwordModalSubtitle").textContent = "Digite a senha de gestor para remover desta sexta";
  document.getElementById("passwordModal").style.display = "flex";
  setTimeout(() => document.getElementById("passwordInput")?.focus(), 100);
}

function renderRemoveFromFridayConfirm() {
  if (!pendingRemoveFromFridayId) return;
  showInfoModal(
    "🗑️ Remover Colaborador",
    `<div class="space-y-3 text-center">
       <div class="text-6xl">⚠️</div>
       <div>Confirmar remoção desta sexta-feira?</div>
       <div class="flex gap-2 justify-center">
         <button class="px-4 py-2 border rounded-lg" onclick="closeInfoModal()">Cancelar</button>
         <button class="px-4 py-2 bg-red-600 text-white rounded-lg" onclick="executeRemoveEmployee(${pendingRemoveFromFridayId})">Remover</button>
       </div>
     </div>`
  );
}

async function executeRemoveEmployee(leaveId) {
  await dbRemoveFromFriday(leaveId);
  closeInfoModal();
  showInfoModal("✅ Sucesso", '<div class="text-center">Removido desta sexta-feira.</div>');
}

// ======= PÁGINA COLABORADORES =======
function showPasswordModal() {
  passwordModalAction = "employees";
  document.getElementById("passwordModalTitle").textContent = "🔒 Acesso Restrito";
  document.getElementById("passwordModalSubtitle").textContent = "Digite a senha para acessar a gestão de colaboradores";
  document.getElementById("passwordModal").style.display = "flex";
  setTimeout(() => document.getElementById("passwordInput")?.focus(), 100);
}
function closePasswordModal() {
  document.getElementById("passwordModal").style.display = "none";
  document.getElementById("passwordForm")?.reset();
  document.getElementById("passwordError")?.classList.add("hidden");
}

function showEmployeesPage() {
  const p = document.getElementById("employeesPage");
  p?.classList.remove("hidden");
  updateEmployeesPageStats();
  renderEmployeesList();
}
function closeEmployeesPage() {
  document.getElementById("employeesPage")?.classList.add("hidden");
}

function showAddEmployeeForm() {
  document.getElementById("addEmployeeFormSection")?.classList.remove("hidden");
}
function hideAddEmployeeForm() {
  document.getElementById("addEmployeeFormSection")?.classList.add("hidden");
  document.getElementById("addEmployeeFormPage")?.reset();
  const prev = document.getElementById("photoPreviewPage");
  if (prev) prev.innerHTML = '<span class="text-gray-400 text-2xl">📷</span>';
}

function openEditEmployeeModal(id) {
  const emp = employeesDB.find(e => e.id === id);
  if (!emp) return;

  editingEmployeeId = id;

  document.getElementById("editEmployeeName").value  = emp.name || "";
  document.getElementById("editEmployeeEmail").value = emp.email || "";
  document.getElementById("editEmployeeDepartment").value = emp.department || "Comercial";

  const prev = document.getElementById("photoPreviewEdit");
  prev.innerHTML = emp.photo_url
    ? `<img src="${emp.photo_url}" class="w-full h-full object-cover rounded-full">`
    : `<div class="w-full h-full bg-gradient-to-r from-purple-400 to-pink-400 rounded-full flex items-center justify-center text-white font-semibold text-lg">${(emp.name || "?").charAt(0)}</div>`;

  document.getElementById("employeePhotoEdit").value = "";
  document.getElementById("editEmployeeModal").classList.remove("hidden");
}
function closeEditEmployeeModal() {
  document.getElementById("editEmployeeModal").classList.add("hidden");
  document.getElementById("editEmployeeForm")?.reset();
  document.getElementById("photoPreviewEdit").innerHTML = '<span class="text-gray-400 text-2xl">📷</span>';
  editingEmployeeId = null;
}

let pendingDeletionId = null;
let pendingDeletionEmployee = null;

function confirmDeleteEmployee(id) {
  const emp = employeesDB.find(e => e.id === Number(id));
  if (!emp) {
    showInfoModal("❌ Erro", "Colaborador não encontrado.");
    return;
  }

  const details = [];
  let count = 0;
  Object.keys(fridayData).forEach(k => {
    if ((fridayData[k] || []).some(r => r.globalId === emp.id)) {
      details.push(k);
      count++;
    }
  });

  pendingDeletionId = emp.id;
  pendingDeletionEmployee = emp;

  const list = details.map(d => `<li class="text-sm text-gray-600">📅 ${d}</li>`).join("");

  document.getElementById("deleteEmployeeInfo").innerHTML = `
    <div class="bg-gray-50 rounded-lg p-4 space-y-3">
      <div class="flex items-center">
        <div class="w-12 h-12 bg-gradient-to-r from-purple-400 to-pink-400 rounded-full flex items-center justify-center text-white font-bold text-lg mr-3">
          ${(emp.name || "?").charAt(0)}
        </div>
        <div>
          <div class="font-semibold text-gray-900">${emp.name || ""}</div>
          <div class="text-sm text-gray-600">${emp.department || ""}</div>
          <div class="text-sm text-gray-500">${emp.email || ""}</div>
        </div>
      </div>
      <div class="border-t pt-3">
        <div class="text-sm font-medium text-gray-700 mb-2">📊 Impacto da Exclusão:</div>
        <div class="text-sm text-gray-600 mb-2">• <strong>${count}</strong> sexta(s)-feira(s) afetada(s)</div>
        ${count ? `<ul class="ml-4 space-y-1">${list}</ul>` : ""}
      </div>
    </div>`;
  document.getElementById("deleteConfirmModal").classList.remove("hidden");
}
function closeDeleteConfirmModal() {
  document.getElementById("deleteConfirmModal").classList.add("hidden");
}
async function executeConfirmedDeletion() {
  if (!pendingDeletionId) return;
  const id = pendingDeletionId;
  closeDeleteConfirmModal();
  await dbDeleteEmployee(id);
  showInfoModal("✅ Sucesso", "<div class=\"text-center\">Colaborador removido do sistema.</div>");
  pendingDeletionId = null;
  pendingDeletionEmployee = null;
}

// ======= Modais genéricos =======
function showInfoModal(title, content) {
  document.getElementById("infoModalTitle").textContent = title;
  document.getElementById("infoModalContent").innerHTML = content;
  document.getElementById("infoModal").classList.remove("hidden");
}
function closeInfoModal() {
  document.getElementById("infoModal").classList.add("hidden");
}

// ======= Pendências =======
function showPendingRequests() {
  passwordModalAction = "view_pending";
  document.getElementById("passwordModalTitle").textContent = "🔒 Pendências";
  document.getElementById("passwordModalSubtitle").textContent = "Digite a senha de gestor para ver as pendências";
  document.getElementById("passwordModal").style.display = "flex";
  setTimeout(() => document.getElementById("passwordInput")?.focus(), 100);
}
function renderPendingRequests() {
  const list = [];
  Object.keys(fridayData).forEach(k => {
    (fridayData[k] || []).filter(e => e.status === "Pendente").forEach(e => {
      list.push({ ...e, friday: k });
    });
  });

  if (!list.length) {
    showInfoModal("📋 Solicitações Pendentes", '<div class="text-center text-green-600">Tudo em dia!</div>');
    return;
  }

  const html = list.map(emp => `
    <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-3">
      <div class="font-medium text-gray-900">${emp.name}</div>
      <div class="text-sm text-gray-600">${emp.department}</div>
      <div class="text-sm text-gray-700 mt-1">
        <b>Sexta:</b> ${emp.friday}<br>
        <b>Obs.:</b> ${emp.notes || "-"}
      </div>
    </div>`).join("");

  showInfoModal("📋 Solicitações Pendentes", `<div class="max-h-96 overflow-y-auto">${html}</div>`);
}

// ======= Form handlers =======

// Senha
document.getElementById("passwordForm")?.addEventListener("submit", (e) => {
  e.preventDefault();
  const pass = document.getElementById("passwordInput")?.value || "";
  const err  = document.getElementById("passwordError");

  if (pass === PASSWORD) {
    err?.classList.add("hidden");
    const action = passwordModalAction;
    closePasswordModal();
    if (action === "employees")            showEmployeesPage();
    else if (action === "approve")         processApproval();
    else if (action === "reject")          processRejection();
    else if (action === "toggle")          processToggle();
    else if (action === "view_pending")    renderPendingRequests();
    else if (action === "remove_from_friday") renderRemoveFromFridayConfirm();
  } else {
    err?.classList.remove("hidden");
    document.getElementById("passwordInput").value = "";
    document.getElementById("passwordInput").focus();
  }
});

// Editar colaborador
document.getElementById("editEmployeeForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!editingEmployeeId) {
    showInfoModal("❌ Erro", "Nenhum colaborador selecionado.");
    return;
  }

  const name  = (document.getElementById("editEmployeeName")?.value || "").trim();
  const email = (document.getElementById("editEmployeeEmail")?.value || "").trim();
  const department = document.getElementById("editEmployeeDepartment")?.value || "";
  const file = document.getElementById("employeePhotoEdit")?.files?.[0] || null;

  let photo;
  if (file) {
    photo = await new Promise(res => {
      const r = new FileReader();
      r.onload = e2 => res(e2.target.result);
      r.readAsDataURL(file);
    });
  }

  try {
    await dbUpdateEmployee(editingEmployeeId, { name, email, department, photo });
    closeEditEmployeeModal();
    showInfoModal("✅ Sucesso", '<div class="text-center">Colaborador atualizado.</div>');
  } catch (err) {
    showInfoModal("❌ Erro", "Falha ao atualizar colaborador.");
    console.error(err);
  }
});

// Adicionar colaborador
document.getElementById("addEmployeeFormPage")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const name  = document.getElementById("employeeNamePage")?.value || "";
  const email = document.getElementById("employeeEmailPage")?.value || "";
  const department = document.getElementById("employeeDepartmentPage")?.value || "";
  const file = document.getElementById("employeePhotoPage")?.files?.[0] || null;

  let photo;
  if (file) {
    photo = await new Promise(res => {
      const r = new FileReader();
      r.onload = e2 => res(e2.target.result);
      r.readAsDataURL(file);
    });
  }

  try {
    await dbAddEmployee({ name, email, department, photo });
    hideAddEmployeeForm();
    showInfoModal("✅ Sucesso", '<div class="text-center">Colaborador adicionado.</div>');
  } catch (err) {
    showInfoModal("❌ Erro", "Falha ao adicionar colaborador.");
    console.error(err);
  }
});

// Registrar folga
document.getElementById("registerLeaveForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!selectedFriday) {
    showInfoModal("⚠️ Atenção", "Selecione uma sexta-feira.");
    return;
  }

  const employeeId = parseInt(document.getElementById("leaveEmployeeSelect")?.value || "0", 10);
  if (!employeeId) {
    showInfoModal("⚠️ Atenção", "Selecione um colaborador.");
    return;
  }

  try {
    await dbUpsertLeave(employeeId, selectedFriday, "Pendente", "Aguardando aprovação da gestão");
    closeRegisterLeaveModal();
    showInfoModal("✅ Sucesso", '<div class="text-center">Solicitação registrada e pendente de aprovação.</div>');
  } catch (err) {
    showInfoModal("❌ Erro", "Não foi possível registrar a folga.");
    console.error(err);
  }
});

// Preview foto (add)
document.getElementById("employeePhotoPage")?.addEventListener("change", (e) => {
  const file = e.target.files[0];
  const prev = document.getElementById("photoPreviewPage");
  if (!file) {
    prev.innerHTML = '<span class="text-gray-400 text-2xl">📷</span>';
    return;
  }
  const r = new FileReader();
  r.onload = ev => prev.innerHTML = `<img src="${ev.target.result}" class="w-full h-full object-cover rounded-full">`;
  r.readAsDataURL(file);
});

// Preview foto (edit)
document.getElementById("employeePhotoEdit")?.addEventListener("change", (e) => {
  const file = e.target.files[0];
  const prev = document.getElementById("photoPreviewEdit");
  if (!file) {
    prev.innerHTML = '<span class="text-gray-400 text-2xl">📷</span>';
    return;
  }
  const r = new FileReader();
  r.onload = ev => prev.innerHTML = `<img src="${ev.target.result}" class="w-full h-full object-cover rounded-full">`;
  r.readAsDataURL(file);
});

// Selects de período
document.getElementById("yearSelect")?.addEventListener("change", async function(){
  const y = parseInt(this.value);
  const m = parseInt(document.getElementById("monthSelect")?.value || `${currentMonth}`);
  await selectMonth(m, y);
});
document.getElementById("monthSelect")?.addEventListener("change", async function(){
  const m = parseInt(this.value);
  const y = parseInt(document.getElementById("yearSelect")?.value || `${currentYear}`);
  await selectMonth(m, y);
});

// Navegação / util
function renderYearSelect(){
  const sel = document.getElementById("yearSelect"); if (!sel) return;
  sel.innerHTML = "";
  const now = new Date().getFullYear();
  for (let y = now; y <= 2030; y++) {
    const o = document.createElement("option");
    o.value = y;
    o.textContent = y;
    if (y === currentYear) o.selected = true;
    sel.appendChild(o);
  }
}
function renderMonthSelect(){
  const sel = document.getElementById("monthSelect"); if (!sel) return;
  sel.innerHTML = "";
  const months = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  months.forEach((nm, idx) => {
    const o = document.createElement("option");
    o.value = idx;
    o.textContent = nm;
    if (idx === currentMonth) o.selected = true;
    sel.appendChild(o);
  });
}
async function selectMonth(month, year){
  currentMonth = month;
  currentYear  = year;
  selectedFriday = null;
  const cv = document.getElementById("currentView");
  if (cv) cv.textContent = `${["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"][month]} ${year}`;
  await syncFromDB();
  updateTableTitle();
}
function getFridaysInMonth(year, month){
  const fridays = [];
  const dt = new Date(year, month, 1);
  while (dt.getDay() !== 5) dt.setDate(dt.getDate() + 1);
  while (dt.getMonth() === month) {
    fridays.push(new Date(dt));
    dt.setDate(dt.getDate() + 7);
  }
  return fridays;
}
function formatDate(date){
  return date.toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric"});
}
function renderFridaysGrid(){
  const c = document.getElementById("fridaysGrid"); if (!c) return;
  c.innerHTML = "";
  const fridays = getFridaysInMonth(currentYear, currentMonth);
  fridays.forEach(fr => {
    const key = formatDate(fr);
    const list = fridayData[key] || [];
    const employeeCount = list.length;
    const onLeaveCount   = list.filter(e => e.status === "Folga").length;
    const card = document.createElement("div");
    card.className = `friday-card bg-white border-2 rounded-xl p-4 cursor-pointer hover:shadow-lg transition-all duração-200 ${selectedFriday === key ? "border-purple-500 bg-purple-50 selected" : "border-gray-200 hover:border-purple-300"}`;
    card.onclick = () => selectFriday(key);
    card.innerHTML = `
      <div class="text-center">
        <div class="text-2xl font-bold text-gray-900 mb-1">${fr.getDate()}</div>
        <div class="text-sm text-gray-600 mb-3">${key}</div>
        <div class="space-y-1">
          <div class="text-xs text-gray-500">👥 ${employeeCount} colaboradores</div>
          <div class="text-xs text-green-600">✅ ${onLeaveCount} de folga</div>
        </div>
      </div>`;
    c.appendChild(card);
  });
}
function selectFriday(key){
  selectedFriday = key;
  renderFridaysGrid();
  renderEmployees();
  updateTableTitle();
}
function updateTableTitle(){
  const t = document.getElementById("tableTitle"); if (!t) return;
  t.textContent = selectedFriday
    ? `Colaboradores - ${selectedFriday}`
    : "Colaboradores - Selecione uma sexta-feira";
}

function updateEmployeesPageStats(){
  const total = employeesDB.length;
  const deps  = [...new Set(employeesDB.map(e => e.department))].length;
  const todayStr = new Date().toDateString();
  const todayCount = employeesDB.filter(e => (e.created_at && new Date(e.created_at).toDateString() === todayStr)).length;
  const te = document.getElementById("totalEmployeesPage"); if (te) te.textContent = total;
  const td = document.getElementById("totalDepartments"); if (td) td.textContent = deps;
  const tr = document.getElementById("todayRegistrations"); if (tr) tr.textContent = todayCount;
}
function renderEmployeesList(){
  const tb = document.getElementById("employeesListTable"); if (!tb) return;
  tb.innerHTML = "";

  if (!employeesDB.length) {
    tb.innerHTML = '<tr><td colspan="5" class="py-8 px-6 text-center text-gray-500">Nenhum colaborador cadastrado ainda</td></tr>';
    return;
  }

  employeesDB.forEach(emp => {
    const displayName = emp.name || "";
    const photo = emp.photo_url
      ? `<img src="${emp.photo_url}" class="w-10 h-10 object-cover rounded-full">`
      : `<div class="w-10 h-10 bg-gradient-to-r from-purple-400 to-pink-400 rounded-full flex items-center justify-center text-white font-semibold">${displayName.charAt(0)}</div>`;

    const tr = document.createElement("tr");
    tr.className = "table-row border-b border-gray-100";
    tr.innerHTML = `
      <td class="py-4 px-6">
        <div class="flex items-center">
          ${photo}
          <div class="ml-3"><div class="font-medium text-gray-900">${displayName}</div></div>
        </div>
      </td>
      <td class="py-4 px-6 text-gray-700">${emp.email || ""}</td>
      <td class="py-4 px-6 text-gray-700">${emp.department || ""}</td>
      <td class="py-4 px-6 text-gray-600">${emp.created_at ? new Date(emp.created_at).toLocaleDateString("pt-BR") : "-"}</td>
      <td class="py-4 px-6 text-center">
        <button onclick="openEditEmployeeModal(${emp.id})" class="action-button edit-button">✏️ Editar</button>
        <button onclick="confirmDeleteEmployee(${emp.id})" class="action-button delete-button">🗑️ Excluir</button>
      </td>`;
    tb.appendChild(tr);
  });
}

// Registrar folga — modal
function openRegisterLeaveModal(){
  if (!selectedFriday) {
    showInfoModal("⚠️ Atenção", "Selecione uma sexta-feira.");
    return;
  }
  populateEmployeeSelect();
  document.getElementById("registerLeaveModal").classList.remove("hidden");
}
function closeRegisterLeaveModal(){
  document.getElementById("registerLeaveModal").classList.add("hidden");
  document.getElementById("registerLeaveForm")?.reset();
}
function populateEmployeeSelect(){
  const select = document.getElementById("leaveEmployeeSelect"); if (!select) return;
  select.innerHTML = '<option value="">Selecione o colaborador</option>';

  const sorted = [...employeesDB].sort((a, b) =>
    (a.name || "").localeCompare((b.name || ""), "pt-BR")
  );

  sorted.forEach(e => {
    const o = document.createElement("option");
    o.value = e.id;
    o.textContent = `${e.name} - ${e.department || ""}`;
    select.appendChild(o);
  });
}

// ====== Inicialização ======
(async () => {
  renderYearSelect();
  renderMonthSelect();
  await syncFromDB();
  renderFridaysGrid();
  renderEmployees();
  updateTableTitle();
})();

// ====== Exposição para onclick no HTML ======
Object.assign(window, {
  showPendingRequests,
  renderPendingRequests,
  showAllLeaves: () => showInfoModal("🚧 Em breve", "Relatório geral virá numa próxima versão."),
  showPasswordModal,
  closePasswordModal,
  openRegisterLeaveModal,
  closeRegisterLeaveModal,
  toggleStatus,
  processToggle,
  approveLeave,
  rejectLeave,
  processApproval,
  processRejection,
  removeEmployee,
  renderRemoveFromFridayConfirm,
  executeRemoveEmployee,
  selectFriday,
  updateAllInterfaces,
  closeInfoModal,
  openEditEmployeeModal,
  closeEditEmployeeModal,
  confirmDeleteEmployee,
  executeConfirmedDeletion,
  closeDeleteConfirmModal
});
