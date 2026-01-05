/* =========================================================
   GESTÃO DE FOLGAS — script.js (VERSÃO FINAL CORRIGIDA)
   Tabelas:
   funcionarios(id, name, email, department, photo_url, created_at)
   folgas(id, employee_id, friday_date, status, notes, created_at)
   ========================================================= */

const PASSWORD = "03082020";

let selectedFriday = null;
let currentMonth = new Date().getMonth();
let currentYear  = new Date().getFullYear();
let passwordModalAction = null;
let editingEmployeeId = null;
let pendingRemoveFromFridayId = null;

// Estado
let employeesDB = [];   // TODOS os colaboradores
let fridayData  = {};   // folgas agrupadas por sexta (DD/MM/YYYY)

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

/* ===================== SYNC DB ===================== */
async function syncFromDB(){
  try{
    // funcionarios
    const { data: emps, error: empErr } = await sb
      .from('funcionarios')
      .select('*')
      .order('name');

    if (empErr) throw empErr;
    employeesDB = emps || [];

    // folgas do mês
    const start = new Date(currentYear, currentMonth, 1);
    const end   = new Date(currentYear, currentMonth+1, 1);

    const { data: leaves, error: leaveErr } = await sb
      .from('folgas')
      .select('*')
      .gte('friday_date', toISODate(start))
      .lt('friday_date', toISODate(end));

    if (leaveErr) throw leaveErr;

    fridayData = {};
    const empMap = new Map(employeesDB.map(e=>[e.id,e]));

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
  }catch(e){
    console.error(e);
    showInfoModal(
      "❌ Erro Supabase",
      `<div>${e.message}</div>
       <div class="text-xs text-gray-500">Verifique RLS / policies</div>`
    );
  }
}

/* ===================== RENDER ===================== */
function getStatusBadge(status){
  if (status==='Folga')
    return '<span class="px-3 py-1 rounded-full text-sm bg-green-100 text-green-800">✅ Folga</span>';
  if (status==='Pendente')
    return '<span class="px-3 py-1 rounded-full text-sm bg-yellow-100 text-yellow-800">⏳ Pendente</span>';
  if (status==='Rejeitada')
    return '<span class="px-3 py-1 rounded-full text-sm bg-red-100 text-red-800">❌ Rejeitada</span>';
  return '<span class="px-3 py-1 rounded-full text-sm bg-orange-100 text-orange-800">💼 Trabalhando</span>';
}

function renderEmployees(){
  const tbody = document.getElementById('employeeTableBody');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (!employeesDB.length){
    tbody.innerHTML = `
      <tr><td colspan="5" class="py-8 px-6 text-center text-gray-500">
        Nenhum colaborador cadastrado
      </td></tr>`;
    return;
  }

  const leavesToday = selectedFriday ? (fridayData[selectedFriday]||[]) : [];
  const leaveMap = new Map(leavesToday.map(l=>[l.employeeId,l]));

  employeesDB.forEach(emp=>{
    const leave = leaveMap.get(emp.id);
    const status = leave?.status || 'Trabalhando';
    const notes  = leave?.notes  || '-';

    const photo = emp.photo_url
      ? `<img src="${emp.photo_url}" class="w-10 h-10 rounded-full object-cover">`
      : `<div class="w-10 h-10 rounded-full bg-purple-500 text-white flex items-center justify-center font-bold">
           ${emp.name.charAt(0)}
         </div>`;

    let actions = '';
    if (!selectedFriday){
      actions = `<span class="text-xs text-gray-400">Selecione uma sexta</span>`;
    } else if (!leave){
      actions = `
        <button
          onclick="openRegisterLeaveModal(); setTimeout(()=>document.getElementById('leaveEmployeeSelect').value='${emp.id}',0)"
          class="px-3 py-1 bg-blue-50 text-blue-700 rounded-lg">
          ➕ Registrar
        </button>`;
    } else if (status==='Pendente'){
      actions = `
        <button onclick="approveLeave(${leave.id})" class="text-green-600 mr-2">Aprovar</button>
        <button onclick="rejectLeave(${leave.id})" class="text-red-600 mr-2">Rejeitar</button>
        <button onclick="removeFromFriday(${leave.id})" class="text-gray-600">Remover</button>`;
    } else {
      actions = `
        <button onclick="toggleStatus(${leave.id})" class="text-purple-600 mr-2">Alterar</button>
        <button onclick="removeFromFriday(${leave.id})" class="text-red-600">Remover</button>`;
    }

    tbody.innerHTML += `
      <tr class="border-b">
        <td class="py-4 px-6">
          <div class="flex items-center">
            ${photo}
            <div class="ml-3">
              <div class="font-medium">${emp.name}</div>
              <div class="text-xs text-gray-500">${emp.email||''}</div>
            </div>
          </div>
        </td>
        <td class="py-4 px-6">${emp.department||''}</td>
        <td class="py-4 px-6">${getStatusBadge(status)}</td>
        <td class="py-4 px-6">${notes}</td>
        <td class="py-4 px-6 text-center">${actions}</td>
      </tr>`;
  });

  updateStats();
}

function updateStats(){
  const total = employeesDB.length;
  document.getElementById('totalEmployees').textContent = total;

  const leavesToday = selectedFriday ? (fridayData[selectedFriday]||[]) : [];
  let onLeave = 0, pending = 0;

  leavesToday.forEach(l=>{
    if (l.status==='Folga') onLeave++;
    if (l.status==='Pendente') pending++;
  });

  document.getElementById('onLeave').textContent = onLeave;
  document.getElementById('pendingRequests').textContent = pending;
  document.getElementById('working').textContent = total - onLeave - pending;

  let headerPending = 0;
  Object.values(fridayData).forEach(list=>{
    headerPending += list.filter(l=>l.status==='Pendente').length;
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
  const grid=document.getElementById('fridaysGrid');
  grid.innerHTML='';
  getFridaysInMonth(currentYear,currentMonth).forEach(d=>{
    const key=formatBR(d);
    const count=(fridayData[key]||[]).length;
    const card=document.createElement('div');
    card.className=`border rounded-xl p-4 cursor-pointer ${selectedFriday===key?'border-purple-500 bg-purple-50':'border-gray-200'}`;
    card.onclick=()=>selectFriday(key);
    card.innerHTML=`
      <div class="text-center">
        <div class="text-2xl font-bold">${d.getDate()}</div>
        <div class="text-sm text-gray-600">${key}</div>
        <div class="text-xs text-gray-500 mt-2">👥 ${count}</div>
      </div>`;
    grid.appendChild(card);
  });
}

function selectFriday(key){
  selectedFriday=key;
  document.getElementById('tableTitle').textContent=`Colaboradores - ${key}`;
  renderFridaysGrid();
  renderEmployees();
}

/* ===================== FOLGAS ===================== */
async function dbUpsertLeave(employeeId, fridayBR){
  await sb.from('folgas').upsert({
    employee_id: employeeId,
    friday_date: toISODateBR(fridayBR),
    status:'Pendente',
    notes:'Aguardando aprovação'
  },{onConflict:'employee_id,friday_date'});
  await syncFromDB();
}
async function approveLeave(id){ await sb.from('folgas').update({status:'Folga'}).eq('id',id); syncFromDB(); }
async function rejectLeave(id){ await sb.from('folgas').update({status:'Rejeitada'}).eq('id',id); syncFromDB(); }
async function toggleStatus(id){
  const l = Object.values(fridayData).flat().find(x=>x.id===id);
  if (!l) return;
  const ns = l.status==='Folga'?'Trabalhando':'Folga';
  await sb.from('folgas').update({status:ns}).eq('id',id);
  syncFromDB();
}
async function removeFromFriday(id){
  await sb.from('folgas').delete().eq('id',id);
  syncFromDB();
}

/* ===================== MODAIS ===================== */
function openRegisterLeaveModal(){
  if (!selectedFriday){
    showInfoModal("⚠️ Atenção","Selecione uma sexta-feira.");
    return;
  }
  populateEmployeeSelect();
  document.getElementById('registerLeaveModal').classList.remove('hidden');
}
function closeRegisterLeaveModal(){
  document.getElementById('registerLeaveModal').classList.add('hidden');
}

function populateEmployeeSelect(){
  const s=document.getElementById('leaveEmployeeSelect');
  s.innerHTML='<option value="">Selecione…</option>';
  employeesDB.forEach(e=>{
    s.innerHTML+=`<option value="${e.id}">${e.name} - ${e.department||''}</option>`;
  });
}

document.getElementById('registerLeaveForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const empId=parseInt(document.getElementById('leaveEmployeeSelect').value);
  if (!empId) return;
  await dbUpsertLeave(empId, selectedFriday);
  closeRegisterLeaveModal();
});

/* ===================== INFO MODAL ===================== */
function showInfoModal(title,html){
  document.getElementById('infoModalTitle').textContent=title;
  document.getElementById('infoModalContent').innerHTML=html;
  document.getElementById('infoModal').classList.remove('hidden');
}
function closeInfoModal(){
  document.getElementById('infoModal').classList.add('hidden');
}

/* ===================== INIT ===================== */
function updateAll(){
  renderFridaysGrid();
  renderEmployees();
}

(async()=>{
  await syncFromDB();
  renderFridaysGrid();
  renderEmployees();
})();

/* ===================== EXPORT ===================== */
Object.assign(window,{
  openRegisterLeaveModal, closeRegisterLeaveModal,
  approveLeave, rejectLeave, toggleStatus, removeFromFriday,
  selectFriday, closeInfoModal
});
