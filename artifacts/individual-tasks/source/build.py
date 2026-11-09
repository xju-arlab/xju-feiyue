from pathlib import Path
import json
source=Path(__file__).resolve().parent
root=source.parents[2]
icons=json.loads((source/'icons.json').read_text())
variants=[('01-inbox.html','方案一 · 任务收件箱','个人处理优先','查看分配给你的任务，独立提交，跟进反馈。'),('02-collection.html','方案二 · 任务收发台','发布与收集优先','发布一份任务，逐人收取与验收。'),('03-board.html','方案三 · 任务看板','进度一目了然','从待提交到已完成，每一步都有迹可循。')]
for i,(file,title,note,subtitle) in enumerate(variants,1):
 if i!=3:continue
 s=(source/'template.html').read_text()
 mapping={'TITLE':title,'TOKENS':(root/'frontend/src/styles/tokens.css').read_text(),'CSS':(source/'prototype.css').read_text(),'JS':(source/'prototype.js').read_text(),'VARIANT':str(i),'ICONS':json.dumps(icons,ensure_ascii=False),'LINKS':''.join(f'<a href="{f}" class="{"active" if j==i else ""}">{label}</a>' for j,((f,*_),label) in enumerate(zip(variants,['01 收件箱','02 收发台','03 看板']),1)),'NOTE':note,'SUBTITLE':subtitle}
 for k,n in {'RESET':'RotateCcw','BACK':'ArrowLeft','CLASS':'GraduationCap','CHEVRON':'ChevronRight','USERS':'Users','PLUS':'Plus','CLOSE':'X','UPLOAD':'Upload','LOCK':'LockKeyhole','CHECK':'Check','SEND':'Send'}.items():mapping[k+'_ICON']=icons[n]
 for k,v in mapping.items():s=s.replace('__'+k+'__',v)
 (root/'artifacts/individual-tasks'/file).write_text(s)
print('Built three standalone previews.')

for filename,mode in [('01-inbox.html','student'),('02-collection.html','publisher'),('04-final.html','student')]:
 s=(source/'final-template.html').read_text()
 mapping={'TOKENS':(root/'frontend/src/styles/tokens.css').read_text(),'CSS':(source/'prototype.css').read_text(),'FINAL_CSS':(source/'final.css').read_text(),'FINAL_JS':(source/'final.js').read_text(),'MODE':mode,'ICONS':json.dumps(icons,ensure_ascii=False)}
 for k,n in {'RESET':'RotateCcw','BACK':'ArrowLeft','CLASS':'GraduationCap','PLUS':'Plus','CLOSE':'X'}.items():mapping[k+'_ICON']=icons[n]
 for k,v in mapping.items():s=s.replace('__'+k+'__',v)
 (root/'artifacts/individual-tasks'/filename).write_text(s)
print('Updated inbox, collection and combined homework preview.')
