const PASSWORD = "03082020";

let selectedFriday = null;
let currentMonth = new Date().getMonth();
let currentYear  = new Date().getFullYear();
let passwordModalAction = null;
let editingEmployeeId = null;
let pendingRemoveFromFridayId = null;

// Estado
let employeesDB = [];   // TODOS os colaboradores (para o select e stats)
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

function escapeHtml(str=""){
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
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
      `<div>${escapeHtml(e.message || "Erro desconhecido")}</div>
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
  // qualquer coisa fora disso vira neutro
  return '<span class="px-3 py-1 rounded-full text-sm bg-gray-100 text-gray-700">—</span>';
}

/**
 * ✅ NOVO COMPORTAMENTO:
 * - Se não selecionou sexta: mensagem
 * - Se selecionou e não há registros: "Nenhuma folga registrada"
 * - Se há registros: mostra SOMENTE quem está em fridayData[selectedFriday]
 */
function renderEmployees(){
  const tbody = document.getElementById('employeeTableBody');
  if (!tbody) return;

  // estado: sem sexta selecionada
  if (!selectedFriday){
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="py-8 px-6 text-center text-gray-500">
          Selecione uma sexta-feira para visualizar as folgas registradas.
        </td>
      </tr>`;
    updateStats();
    return;
  }

  const leavesTodayRaw = (fridayData[selectedFriday] || []);

  // ✅ considere apenas registros "válidos" (não existe mais status Trabalhando)
  const leavesToday = leavesTodayRaw.filter(l =>
    l.status === 'Folga' || l.status === 'Pendente' || l.status === 'Rejeitada'
  );

  if (!leavesToday.length){
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="py-8 px-6 text-center text-gray-500">
          Nenhuma folga registrada para <b>${selectedFriday}</b>.
        </td>
      </tr>`;
    updateStats();
    return;
  }

  // Renderiza SOMENTE quem tem registro
  tbody.innerHTML = leavesToday.map(l=>{
    const emp = l.employee || {};
    const photo = emp.photo_url
      ? `<img src="${emp.photo_url}" class="w-10 h-10 rounded-full object-cover">`
      : `<div class="w-10 h-10 rounded-full bg-purple-500 text-white flex items-center justify-center font-bold">
           ${(emp.name || "?").charAt(0)}
         </div>`;

    // ações por status
    let actions = '';
    if (l.status === 'Pendente'){
      actions = `
        <button onclick="approveLeave(${l.id})" class="text-green-600 mr-2">Aprovar</button>
        <button onclick="rejectLeave(${l.id})" class="text-red-600 mr-2">Rejeitar</button>
        <button onclick="removeFromFriday(${l.id})" class="text-gray-600">Remover</button>`;
    } else if (l.status === 'Folga') {
      actions = `
        <button onclick="toggleStatus(${l.id})" class="text-purple-600 mr-2">Remover folga</button>
        <button onclick="removeFromFriday(${l.id})" class="text-red-600">Excluir</button>`;
    } else { // Rejeitada
      actions = `
        <button onclick="removeFromFriday(${l.id})" class="text-red-600">Remover</button>`;
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

function updateStats(){
  const total = employeesDB.length;
  document.getElementById('totalEmployees').textContent = total;

  const leavesTodayRaw = selectedFriday ? (fridayData[selectedFriday]||[]) : [];

  // ✅ conta só estados válidos
  let onLeave = 0, pending = 0;
  leavesTodayRaw.forEach(l=>{
    if (l.status==='Folga') onLeave++;
    if (l.status==='Pendente') pending++;
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
  const grid=document.getElementById('fridaysGrid');
  grid.innerHTML='';

  getFridaysInMonth(currentYear,currentMonth).forEach(d=>{
    const key=formatBR(d);

    // ✅ conta só registros válidos (não conta "Trabalhando")
    const list = fridayData[key] || [];
    const count = list.filter(l =>
      l.status === 'Folga' || l.status === 'Pendente' || l.status === 'Rejeitada'
    ).length;

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

async function approveLeave(id){
  await sb.from('folgas').update({status:'Folga'}).eq('id',id);
  syncFromDB();
}

async function rejectLeave(id){
  await sb.from('folgas').update({status:'Rejeitada'}).eq('id',id);
  syncFromDB();
}

/**
 * ✅ Ajuste importante:
 * NÃO existe "status Trabalhando" na tabela folgas.
 * Se quer "voltar a trabalhar", o certo é DELETAR o registro daquela sexta.
 */
async function toggleStatus(id){
  const l = Object.values(fridayData).flat().find(x=>x.id===id);
  if (!l) return;

  // se está de folga -> remover registro (volta a trabalhar)
  if (l.status === 'Folga'){
    await sb.from('folgas').delete().eq('id', id);
  } else {
    // se não está de folga (pendente/rejeitada), pode marcar como folga
    await sb.from('folgas').update({status:'Folga'}).eq('id', id);
  }

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

  // ✅ não mostrar quem já está registrado nessa sexta
  const leavesToday = selectedFriday ? (fridayData[selectedFriday]||[]) : [];
  const registered = new Set(leavesToday.map(l => l.employeeId));

  employeesDB.forEach(e=>{
    if (registered.has(e.id)) return;
    s.innerHTML+=`<option value="${e.id}">${escapeHtml(e.name)} - ${escapeHtml(e.department||'')}</option>`;
  });

  if (s.options.length === 1){
    s.innerHTML = `<option value="">Todos já estão registrados nesta sexta.</option>`;
  }
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
