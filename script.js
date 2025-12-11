/* =========================================================
   GESTÃO DE FOLGAS — script.js (Versão Final Corrigida)
   Compatível com tabelas:
   funcionarios → id, name, email, department, photo_url, created_at
   folgas       → id, employee_id, friday_date, status, notes, created_at
   ========================================================= */

// ================== VARIÁVEIS GLOBAIS ==================
const PASSWORD = "03082020";
let selectedFriday = null;
let currentMonth = new Date().getMonth();
let currentYear  = new Date().getFullYear();
let passwordModalAction = null;
let editingEmployeeId = null;
let pendingRemoveFromFridayId = null;

let fridayData = {};
let employeesDB = [];

const sb = window.supabase;

// ================== HELPERS DE DATA ==================
function toISODate(d){
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

function toISODateBR(brDate){
  const [dd,mm,yyyy] = brDate.split("/");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateBR(date){
  return date.toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric"});
}

// ================== SYNC DO BANCO ==================
async function syncFromDB() {
  try {
    if (!sb) throw new Error("❌ Supabase não inicializado!");

    // --------- Funcionários ---------
    const { data: emps, error: empErr } = await sb
      .from("funcionarios")
      .select("*")
      .order("name", { ascending: true });

    if (empErr) throw empErr;
    employeesDB = emps || [];

    console.log("Funcionários carregados:", employeesDB.length);

    // --------- Folgas do mês ---------
    const monthStart = new Date(currentYear, currentMonth, 1);
    const monthEnd   = new Date(currentYear, currentMonth + 1, 1);

    const { data: leaves, error: folgaErr } = await sb
      .from("folgas")
      .select("*")
      .gte("friday_date", toISODate(monthStart))
      .lt("friday_date", toISODate(monthEnd));

    if (folgaErr) throw folgaErr;

    fridayData = {};
    const empMap = new Map(employeesDB.map(e => [e.id, e]));

    (leaves || []).forEach(l => {
      const d = new Date(l.friday_date + "T00:00:00");
      const key = formatDateBR(d);
      const emp = empMap.get(l.employee_id);

      if (!fridayData[key]) fridayData[key] = [];
      fridayData[key].push({
        id: l.id,
        globalId: l.employee_id,
        name: emp?.name || "",
        department: emp?.department || "",
        status: l.status,
        notes: l.notes || ""
      });
    });

    updateAllInterfaces();
  } catch (err) {
    console.error("❌ Erro no sync:", err);
    showInfoModal("Erro de Conexão",
      `<div class="text-center text-red-600">
        Não foi possível carregar os dados.<br>
        Verifique as colunas das tabelas <b>funcionarios</b> e <b>folgas</b>.
      </div>`
    );
  }
}

// ================== BANCO: CRUD EMPREGADOS ==================
async function dbAddEmployee({ name, email, department, photo }) {
  const { data, error } = await sb
    .from("funcionarios")
    .insert({
      name,
      email,
      department,
      photo_url: photo || null
    })
    .select()
    .single();

  if (error) throw error;
  await syncFromDB();
  return data;
}

async function dbUpdateEmployee(id, payload){
  const { error } = await sb
    .from("funcionarios")
    .update(payload)
    .eq("id", id);

  if (error) throw error;
  await syncFromDB();
}

async function dbDeleteEmployee(id){
  await sb.from("folgas").delete().eq("employee_id", id);
  const { error } = await sb.from("funcionarios").delete().eq("id", id);
  if (error) throw error;
  await syncFromDB();
}

// ================== BANCO: CRUD FOLGAS ==================
async function dbUpsertLeave(employeeId, brDate, status, notes){
  const iso = toISODateBR(brDate);
  const { error } = await sb
    .from("folgas")
    .upsert({
      employee_id: employeeId,
      friday_date: iso,
      status,
      notes
    }, { onConflict: "employee_id,friday_date" });

  if (error) throw error;
  await syncFromDB();
}

async function dbSetLeaveStatus(id, status, notes){
  const { error } = await sb
    .from("folgas")
    .update({ status, notes })
    .eq("id", id);
  if (error) throw error;
  await syncFromDB();
}

async function dbRemoveFromFriday(id){
  await sb.from("folgas").delete().eq("id", id);
  await syncFromDB();
}

// ================== UI PRINCIPAL ==================
function updateAllInterfaces(){
  renderFridaysGrid();
  renderEmployees();
  updateStats();
  populateEmployeeSelect();
}

// ----- Estatísticas -----
function updateStats(){
  document.getElementById("totalEmployees").textContent = employeesDB.length;

  if (!selectedFriday){
    document.getElementById("onLeave").textContent = 0;
    document.getElementById("working").textContent = 0;
    document.getElementById("pendingRequests").textContent = 0;
    return;
  }

  const list = fridayData[selectedFriday] || [];

  document.getElementById("onLeave").textContent =
    list.filter(e => e.status === "Folga").length;

  document.getElementById("working").textContent =
    list.filter(e => e.status === "Trabalhando").length;

  document.getElementById("pendingRequests").textContent =
    list.filter(e => e.status === "Pendente").length;
}

// ----- Sextas do mês -----
function getFridays(month, year){
  const frs = [];
  let d = new Date(year, month, 1);

  while (d.getDay() !== 5) d.setDate(d.getDate()+1);
  while (d.getMonth() === month){
    frs.push(new Date(d));
    d.setDate(d.getDate()+7);
  }
  return frs;
}

function renderFridaysGrid(){
  const c = document.getElementById("fridaysGrid");
  c.innerHTML = "";

  const fridays = getFridays(currentMonth, currentYear);

  fridays.forEach(fr => {
    const key = formatDateBR(fr);
    const count = (fridayData[key] || []).length;
    const folgaCount = (fridayData[key] || []).filter(e => e.status === "Folga").length;

    const div = document.createElement("div");
    div.className = `border p-4 rounded-xl cursor-pointer hover:shadow ${
      key === selectedFriday ? 'border-purple-600 bg-purple-50' : 'border-gray-300'
    }`;
    div.onclick = () => selectFriday(key);

    div.innerHTML = `
      <div class="text-center">
        <div class="text-2xl font-bold">${fr.getDate()}</div>
        <div class="text-sm">${key}</div>
        <div class="text-xs text-gray-500 mt-2">👥 ${count} colaboradores</div>
        <div class="text-xs text-green-600">✅ ${folgaCount} de folga</div>
      </div>
    `;

    c.appendChild(div);
  });
}

function selectFriday(date){
  selectedFriday = date;
  renderFridaysGrid();
  renderEmployees();
  updateStats();

  document.getElementById("tableTitle").textContent =
    `Colaboradores - ${date}`;
}

// ----- Tabela de colaboradores -----
function renderEmployees(){
  const tbody = document.getElementById("employeeTableBody");
  tbody.innerHTML = "";

  if (!selectedFriday){
    tbody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-gray-500">
      Selecione uma sexta-feira
    </td></tr>`;
    return;
  }

  const list = fridayData[selectedFriday] || [];

  if (list.length === 0){
    tbody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-gray-500">
      Nenhum colaborador cadastrado nesta sexta-feira.
    </td></tr>`;
    return;
  }

  list.forEach(e => {
    const photo = e.photo_url
      ? `<img src="${e.photo_url}" class="w-10 h-10 rounded-full object-cover">`
      : `<div class="w-10 h-10 bg-purple-400 rounded-full flex items-center justify-center text-white">${e.name.charAt(0)}</div>`;

    const tr = document.createElement("tr");
    tr.className = "border-b";

    tr.innerHTML = `
      <td class="px-6 py-3 flex items-center gap-3">${photo} ${e.name}</td>
      <td class="px-6 py-3">${e.department}</td>
      <td class="px-6 py-3">${e.status}</td>
      <td class="px-6 py-3">${e.notes || "-"}</td>
      <td class="px-6 py-3 text-center">
        <button onclick="approveLeave(${e.id})" class="text-green-600 font-bold">✓</button>
        <button onclick="rejectLeave(${e.id})" class="text-red-600 font-bold ml-2">✗</button>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

// ================== CADASTRO DE FOLGA ==================
function openRegisterLeaveModal(){
  if (!selectedFriday){
    return showInfoModal("Atenção", "Selecione uma sexta-feira.");
  }
  populateEmployeeSelect();
  document.getElementById("registerLeaveModal").classList.remove("hidden");
}

function closeRegisterLeaveModal(){
  document.getElementById("registerLeaveModal").classList.add("hidden");
}

async function registerLeave(e){
  e.preventDefault();

  const employeeId = Number(document.getElementById("leaveEmployeeSelect").value);
  if (!employeeId){
    showInfoModal("Atenção", "Selecione um colaborador.");
    return;
  }

  await dbUpsertLeave(employeeId, selectedFriday, "Pendente", "Aguardando aprovação");

  closeRegisterLeaveModal();
  showInfoModal("Sucesso", "Folga solicitada!");
}

// ================== APROVAR/REJEITAR ==================
function approveLeave(id){
  dbSetLeaveStatus(id, "Folga", "Aprovada pela gestão");
}

function rejectLeave(id){
  dbSetLeaveStatus(id, "Rejeitada", "Rejeitada pela gestão");
}

// ================== SELECT DE COLABORADORES ==================
function populateEmployeeSelect(){
  const sel = document.getElementById("leaveEmployeeSelect");
  sel.innerHTML = "<option value=''>Selecione...</option>";

  employeesDB.forEach(e => {
    const op = document.createElement("option");
    op.value = e.id;
    op.textContent = `${e.name} - ${e.department}`;
    sel.appendChild(op);
  });
}

// ================== MODAIS ==================
function showInfoModal(title, content){
  document.getElementById("infoModalTitle").textContent = title;
  document.getElementById("infoModalContent").innerHTML = content;
  document.getElementById("infoModal").classList.remove("hidden");
}

function closeInfoModal(){
  document.getElementById("infoModal").classList.add("hidden");
}

// ================== INICIALIZAÇÃO ==================
(async () => {
  renderYearSelect();
  renderMonthSelect();
  await syncFromDB();
})();

function renderYearSelect(){
  const sel = document.getElementById("yearSelect");
  const y = new Date().getFullYear();
  for (let i = y; i <= y+5; i++){
    const op = document.createElement("option");
    op.value = i;
    op.textContent = i;
    if (i === currentYear) op.selected = true;
    sel.appendChild(op);
  }
}

function renderMonthSelect(){
  const months = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  const sel = document.getElementById("monthSelect");

  months.forEach((name, i) => {
    const op = document.createElement("option");
    op.value = i;
    op.textContent = name;
    if (i === currentMonth) op.selected = true;
    sel.appendChild(op);
  });
}

document.getElementById("registerLeaveForm")?.addEventListener("submit", registerLeave);

