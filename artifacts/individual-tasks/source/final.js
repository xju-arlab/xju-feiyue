const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=(n,size=17)=>ICONS[n].replace('width="18" height="18"',`width="${size}" height="${size}"`);
const roster=[{name:'赵文彪',sid:'20241401231'},{name:'李明',sid:'20241401232'},{name:'王悦',sid:'20241401233'},{name:'陈晨',sid:'20241401234'},{name:'刘洋',sid:'20241401235'},{name:'张宁',sid:'20241401236'},{name:'孙乐',sid:'20241401237'},{name:'周语',sid:'20241401238'}];
const courses={'操作系统':'course-purple','数据库原理':'course-teal','计算机网络':'course-orange'};
const seed=[{id:1,course:'操作系统',no:1,title:'进程调度',due:'2026-11-12T23:59',done:[1,2,4,5,7]},{id:2,course:'数据库原理',no:2,title:'SQL 查询',due:'2026-11-14T23:59',done:[1,3,5]},{id:3,course:'计算机网络',no:1,title:'',due:'2026-11-15T18:00',done:[0,1,2,3,4,5,6,7]},{id:4,course:'操作系统',no:2,title:'线程同步',due:'2026-11-19T23:59',done:[2,5]},{id:5,course:'数据库原理',no:1,title:'数据库创建',due:'2026-11-07T23:59',done:[0,1,2,3,4,5,6,7]}];
let tasks,mode=document.body.dataset.mode||'student',filter='all',courseFilter='all',returnFocus=null;
const pendingUploads=new Map();
let fileDragDepth=0;
function isFileDrag(e){return Array.from(e.dataTransfer?.types||[]).includes('Files')||Array.from(e.dataTransfer?.items||[]).some(item=>item.kind==='file')}
function clearFileDrag(){fileDragDepth=0;document.body.classList.remove('file-dragging');for(const item of $$('.homework-item')){item.fileDragDepth=0;item.classList.remove('dragover')}}
function fileSize(bytes){return bytes<1024?`${bytes} B`:bytes<1024*1024?`${(bytes/1024).toFixed(1)} KB`:`${(bytes/(1024*1024)).toFixed(1)} MB`}
function label(t){return `实验 ${t.no}${t.title?' · '+t.title:''}`}
function expected(t,user=roster[0]){return (t.order==='class-name-id'?[t.className,user.name,user.sid]:[t.className,user.sid,user.name]).join('-')}
function resetData(){tasks=seed.map(t=>({...t,className:'计算机24-3',order:'class-id-name',records:roster.map((p,i)=>({...p,filename:t.done.includes(i)?'':null,submittedAt:t.done.includes(i)?'11-06 18:20':null}))}));for(const t of tasks)for(const r of t.records)if(r.filename==='')r.filename=expected(t,r)+'.pdf'}
resetData();
function coursePill(c){return `<span class="pill ${courses[c]||'course-purple'}">${esc(c)}</span>`}
function statePill(done){return `<span class="pill ${done?'submitted':'waiting'}">${icon(done?'Check':'Circle',10)} ${done?'已提交':'未提交'}</span>`}
function receivedCount(t){return t.records.filter(r=>r.filename).length}
function fmt(d){const [day,time]=d.split('T');return day.slice(5).replace('-','月')+'日 '+time}
function toast(s){$('#toast').textContent=s;$('#toast').classList.add('show');clearTimeout(window.tt);window.tt=setTimeout(()=>$('#toast').classList.remove('show'),2600)}
function openDialog(id){returnFocus=document.activeElement;$('#'+id).showModal()}
function closeDialog(id){$('#'+id).close();returnFocus?.focus()}
function setMode(m){mode=m;filter='all';pendingUploads.clear();clearFileDrag();render()}
function filtered(){return tasks.filter(t=>(courseFilter==='all'||t.course===courseFilter)&&(filter==='all'||(mode==='student'?Boolean(t.records[0].filename):receivedCount(t)===t.records.length)===(filter==='done')))}
function render(){
 $('#mode-switch').innerHTML=`<button class="${mode==='student'?'active':''}" onclick="setMode('student')">学生端</button><button class="${mode==='publisher'?'active':''}" onclick="setMode('publisher')">发布端</button>`;
 $('#new-task').hidden=mode!=='publisher';$('#user-name').textContent=mode==='student'?'赵文彪':'班委';$('#user-avatar').textContent=mode==='student'?'赵':'班';
 $('#filters').innerHTML=[['all','全部'],['pending',mode==='student'?'未提交':'未收齐'],['done',mode==='student'?'已提交':'已收齐']].map(([k,l])=>`<button class="filter ${filter===k?'active':''}" onclick="filter='${k}';render()">${l}</button>`).join('');
 const list=filtered();if(mode==='student')renderStudent(list);else renderPublisher(list);
}
function renderStudent(list){
 $('#workspace').innerHTML=`<div class="homework-list" aria-label="作业列表"><div class="homework-columns" aria-hidden="true"><span>课程</span><span>实验</span><span>截止时间</span><span>状态</span><span>提交</span></div>${list.map(t=>{
 const r=t.records[0];
 return `<article class="homework-item" data-task-id="${t.id}" aria-label="${esc(t.course+' '+label(t))}"><div class="homework-line"><div class="homework-course">${coursePill(t.course)}</div><h3 class="homework-name">${esc(label(t))}</h3><time class="homework-time">${fmt(t.due)}</time><div class="homework-state">${statePill(Boolean(r.filename))}</div><button type="button" class="row-upload" aria-label="${r.filename?'重新上传':'上传'}${esc(t.course+' '+label(t))}文件" aria-controls="file-${t.id}" aria-describedby="rule-${t.id}">${icon('Upload',14)}<span class="upload-action">${r.filename?'重新上传':'上传'}</span><span class="upload-drop-hint" aria-hidden="true">松开即可上传</span></button></div><input type="file" id="file-${t.id}" hidden aria-label="${esc(t.course+' '+label(t))}上传文件"><span class="sr-only" id="rule-${t.id}">点击作业行或上传按钮选择文件，也可拖入此行。文件名应为${esc(expected(t))}，保留扩展名，最大20MB</span><div id="result-${t.id}" class="row-result" aria-live="polite"></div></article>`
 }).join('')||`<div class="zero-state">没有匹配的作业<button class="btn ghost small-btn" onclick="filter='all';courseFilter='all';$('#course-filter').value='all';render()">显示全部</button></div>`}</div>`;
 for(const item of $$('.homework-item')){
  const id=Number(item.dataset.taskId),input=item.querySelector('input');
  item.querySelector('.row-upload').addEventListener('click',()=>input.click());
  item.addEventListener('click',e=>{if(!e.target.closest('button,input,a,select,textarea,label,.row-result')&&!window.getSelection()?.toString())input.click()});
  input.addEventListener('change',e=>{if(e.target.files.length)chooseFile(id,e.target.files);input.value=''});
  item.fileDragDepth=0;
  item.addEventListener('dragenter',e=>{if(!isFileDrag(e))return;e.preventDefault();item.fileDragDepth++;item.classList.add('dragover')});
  item.addEventListener('dragover',e=>{if(!isFileDrag(e))return;e.preventDefault();item.classList.add('dragover');e.dataTransfer.dropEffect='copy'});
  item.addEventListener('dragleave',()=>{item.fileDragDepth=Math.max(0,item.fileDragDepth-1);if(!item.fileDragDepth)item.classList.remove('dragover')});
  item.addEventListener('drop',e=>{if(!isFileDrag(e))return;e.preventDefault();if(e.dataTransfer.files.length)chooseFile(id,e.dataTransfer.files)});
  if(pendingUploads.has(id))renderFileResult(id);
 }
}
function chooseFile(id,files){
 const t=tasks.find(t=>t.id===id);if(!t)return;
 const candidate={file:null,error:'',valid:false};
 if(files.length!==1)candidate.error='每项作业只提交一个文件，多份内容请先打包。';
 else{
  candidate.file=files[0];const n=candidate.file.name,last=n.lastIndexOf('.'),basename=last>0?n.slice(0,last):n,ext=last>0?n.slice(last+1):'';
  if(candidate.file.size>20*1024*1024)candidate.error='文件超过20MB，请压缩后重试。';
  else if(!ext)candidate.error='请保留文件扩展名。';
  else if(basename.normalize('NFC')!==expected(t).normalize('NFC'))candidate.error='文件名不符合要求';
  else candidate.valid=true;
 }
 pendingUploads.set(id,candidate);renderFileResult(id);
}
function discardFile(id){pendingUploads.delete(id);const box=$('#result-'+id);if(box)box.innerHTML='';const input=$('#file-'+id);if(input)input.value='';document.querySelector(`[data-task-id="${id}"] .row-upload`)?.focus()}
function renderFileResult(id){
 const t=tasks.find(t=>t.id===id),c=pendingUploads.get(id),box=$('#result-'+id);if(!box||!c)return;
 const ext=c.file?.name.split('.').slice(1).pop()||'pdf';
 box.innerHTML=`<div class="inline-file ${c.valid?'valid':'invalid'}"><span class="file-feedback-icon">${icon(c.valid?'CircleCheck':'CircleAlert',15)}</span><div class="file-feedback">${c.file?`<div class="file-summary"><span class="file-pending-name">${esc(c.file.name)}</span><span class="file-size">${fileSize(c.file.size)}</span></div>`:''}<div class="file-validation">${c.valid?'命名正确':esc(c.error)}</div>${!c.valid&&c.file?`<div class="file-rule">文件名应为 <code>${esc(expected(t))}.${esc(ext)}</code></div>`:''}</div><div class="file-feedback-actions">${c.valid?`<button type="button" class="btn primary small-btn" onclick="submitFile(${id})">确认上传</button>`:''}<button type="button" class="btn ghost small-btn" aria-label="取消${esc(label(t))}的待上传文件" onclick="discardFile(${id})">取消</button></div></div>`;
}
function submitFile(id){
 const t=tasks.find(t=>t.id===id),c=pendingUploads.get(id);if(!t||!c?.valid||!c.file)return;
 t.records[0].filename=c.file.name;t.records[0].submittedAt='刚刚提交';pendingUploads.delete(id);render();(document.querySelector(`[data-task-id="${id}"] .row-upload`)||$('.homework-item .row-upload')||$('#filters .active'))?.focus();toast(label(t)+' · 已提交');
}
function renderPublisher(list){$('#workspace').innerHTML=`<div class="table-wrap"><table class="task-table simple-table"><thead><tr><th>课程</th><th>实验</th><th>截止时间</th><th>提交人数</th><th>状态</th><th></th></tr></thead><tbody>${list.map(t=>`<tr><td>${coursePill(t.course)}</td><td class="experiment">${esc(label(t))}</td><td class="muted">${fmt(t.due)}</td><td><span class="progress-text">${receivedCount(t)} <span class="faint">/ ${t.records.length}</span></span></td><td><span class="pill ${receivedCount(t)===t.records.length?'submitted':'waiting'}">${receivedCount(t)===t.records.length?'已收齐':'未收齐'}</span></td><td><button class="btn ghost small-btn" onclick="showCollection(${t.id})">查看 ${icon('ChevronRight',13)}</button></td></tr>`).join('')||'<tr><td colspan="6"><div class="empty">没有匹配的实验</div></td></tr>'}</tbody></table></div><div class="minimal-footer"><span>${list.length} 项实验</span><span>文件名符合规则即计为已提交</span></div>`}
function showCollection(id){
 const t=tasks.find(t=>t.id===id);$('#collection-title').textContent=label(t);$('#collection-meta').innerHTML=`${coursePill(t.course)}<span class="small muted">${fmt(t.due)} 截止</span>`;
 $('#collection-body').innerHTML=`<div class="collection-rule"><span>文件命名规则</span><code>${t.order==='class-id-name'?'班级-学号-姓名':'班级-姓名-学号'}</code><span class="collection-count">${receivedCount(t)} / ${t.records.length} 已提交</span></div><div class="collection-records" role="region" aria-label="提交记录，窄屏可左右滚动" tabindex="0"><table class="collection-table" aria-label="提交记录"><colgroup><col class="record-person"><col class="record-file"><col class="record-time"><col class="record-state"></colgroup><thead><tr><th scope="col">姓名</th><th scope="col">文件名</th><th scope="col">提交时间</th><th scope="col">状态</th></tr></thead><tbody>${t.records.map(r=>`<tr><td class="record-name">${esc(r.name)}</td><td>${r.filename?`<span class="record-filename" title="${esc(r.filename)}">${esc(r.filename)}</span>`:'<span class="faint">—</span>'}</td><td class="record-submitted">${r.filename?esc(r.submittedAt):'<span class="faint">—</span>'}</td><td>${statePill(Boolean(r.filename))}</td></tr>`).join('')}</tbody></table></div>`;
 openDialog('collection-dialog');
}
function openNew(){$('#new-form').reset();$('#new-error').textContent='';updateExample();openDialog('new-dialog')}
function updateExample(){const className=$('#new-class').value.trim()||'计算机24-3',order=$('input[name=naming-order]:checked').value;$('#name-example').textContent=expected({className,order})+'.pdf'}
function createTask(e){e.preventDefault();const t={id:Math.max(...tasks.map(t=>t.id))+1,course:$('#new-course').value,no:Number($('#new-number').value),title:$('#new-name').value.trim(),due:$('#new-due').value,className:$('#new-class').value.trim(),order:$('input[name=naming-order]:checked').value,records:roster.map(r=>({...r,filename:null,submittedAt:null}))};if(!t.className||!t.no||!t.due){$('#new-error').textContent='请填写实验编号、截止时间和班级。';return}tasks.unshift(t);filter='all';courseFilter='all';$('#course-filter').value='all';closeDialog('new-dialog');render();toast('已发布，文件将按设定规则校验')}
function restart(){resetData();filter='all';courseFilter='all';pendingUploads.clear();clearFileDrag();$('#course-filter').value='all';$$('dialog[open]').forEach(d=>d.close());render();toast('已恢复示例数据')}
document.addEventListener('dragenter',e=>{if(!isFileDrag(e))return;fileDragDepth++;if(mode==='student')document.body.classList.add('file-dragging')});
document.addEventListener('dragover',e=>{if(!isFileDrag(e))return;e.preventDefault();if(mode==='student')document.body.classList.add('file-dragging');e.dataTransfer.dropEffect=mode==='student'&&e.target.closest('.homework-item')?'copy':'none'});
document.addEventListener('dragleave',()=>{if(!fileDragDepth)return;fileDragDepth=Math.max(0,fileDragDepth-1);if(!fileDragDepth)clearFileDrag()});
document.addEventListener('drop',e=>{if(!isFileDrag(e))return;e.preventDefault();clearFileDrag();if(!e.target.closest('.homework-item'))toast(mode==='student'?'请将文件拖到对应作业行':'请切换至学生端上传文件')});
document.addEventListener('dragend',clearFileDrag);
window.addEventListener('blur',clearFileDrag);
document.addEventListener('keydown',e=>{if(e.key==='Escape')clearFileDrag()});
$('#new-form').addEventListener('submit',createTask);document.addEventListener('click',e=>{if(e.target.tagName==='DIALOG'){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close()}});render();
