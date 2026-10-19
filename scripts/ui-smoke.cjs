const {chromium}=require(process.env.SKILLS_MANAGER_PLAYWRIGHT || 'playwright');
const fs=require('fs');fs.mkdirSync('.dev-reports',{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN || (process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined)});
 const page=await browser.newPage({viewport:{width:1440,height:980}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  let scopes=[],bindings=[];let serial=0;let imported=false;
  const catalog=[{id:'tts',name:'语音合成',description:'基础语音能力',targets:[],preset_ids:[],tags:[]},{id:'lanshu',name:'lanshu-create-ai-presenter-video',description:'讲解视频',targets:[],preset_ids:[],tags:[]}];
  window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{},registerListener:()=>{}};
  window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>1,invoke:async(cmd,args={})=>{
   switch(cmd){
    case 'get_settings':return args.key==='theme'?'dark':args.key==='language'?'zh':null;
    case 'get_managed_skills':case 'governance_catalog':return catalog;
    case 'get_presets':case 'get_projects':case 'get_tool_status':case 'get_tool_order_cmd':return [];
    case 'get_active_preset':return null;
    case 'governance_list_scopes':return scopes;
    case 'governance_add_scope':{const s={id:'scope-'+(++serial),name:args.name,kind:args.kind,parent_id:args.parentId,project_path:args.projectPath,created_at:1};scopes=[...scopes,s];return s;}
    case 'governance_reparent_scope':scopes=scopes.map(s=>s.id===args.scopeId?{...s,parent_id:args.parentId}:s);return null;
    case 'governance_attach_skill':bindings=bindings.filter(b=>!(b.scope===args.scopeId&&b.skill===args.skillId));bindings.push({scope:args.scopeId,skill:args.skillId,role:args.role,excluded:args.excluded});return null;
    case 'governance_remove_skill':bindings=bindings.filter(b=>!(b.scope===args.scopeId&&b.skill===args.skillId));return null;
    case 'governance_effective_skills':{const chain=[];let current=args.scopeId;while(current){chain.unshift(current);current=scopes.find(s=>s.id===current)?.parent_id;}const result=new Map();for(const id of chain)for(const b of bindings.filter(x=>x.scope===id)){result.set(b.skill,{scope_id:args.scopeId,skill_id:b.skill,role:b.role,excluded:b.excluded,origin_scope_id:id,inherited:id!==args.scopeId,overridden:result.has(b.skill)});}return [...result.values()];}
    case 'usage_status':return {db_path:'isolated-test/usage.sqlite3',event_count:imported?1:0,nmem_available:true,coverage_note:'simulated UI contract test'};
    case 'usage_import_nmem':imported=true;return {searched_threads:1,shown_threads:1,imported:1,skipped:0,error:null};
    case 'usage_import_local':return {scanned_files:5,imported:0,skipped:1,incomplete_files:0,malformed_lines:0,coverage_note:'模拟合同测试'};
    case 'usage_summaries':return imported?[7,30,90].map(window_days=>({skill:'lanshu-create-ai-presenter-video',project:null,window_days,events:1,sessions:1,explicit:0,declared:1,inferred:0,last_used_at:Math.floor(Date.now()/1000)})):[];
    case 'usage_events':return imported?[{id:'event',skill:'lanshu-create-ai-presenter-video',project:null,agent:'codex',occurred_at:Math.floor(Date.now()/1000),session_id:'test-session',evidence:'assistant_declaration',source:'nmem',source_ref:'nowledgemem://thread/test',excerpt:'我会使用 lanshu-create-ai-presenter-video。此为前端测试模拟证据。'}]:[];
    case 'plugin:event|listen':return 1;
    default:return null;
   }
  }};
  localStorage.setItem('skills-manager.helpSeen','true');
 });
 await page.goto('http://127.0.0.1:1420/skill-governance');
 await page.getByLabel('作用域名称').fill('个人技能');await page.getByRole('button',{name:'创建',exact:true}).click();
 await page.getByRole('button',{name:'全局 · 个人技能',exact:true}).waitFor();
 await page.getByLabel('绑定技能',{exact:true}).selectOption('tts');await page.getByLabel('技能职责',{exact:true}).selectOption('primitive');await page.getByRole('button',{name:'绑定',exact:true}).click();
 await page.getByText('语音合成',{exact:true}).first().waitFor();
 await page.getByLabel('作用域名称').fill('内容生产');await page.getByRole('button',{name:'创建',exact:true}).click();
 await page.getByRole('button',{name:'领域 · 内容生产',exact:true}).waitFor();
 await page.getByLabel('作用域级别').selectOption('project');await page.getByLabel('作用域名称').fill('投研社');await page.getByLabel('新作用域父级').selectOption('scope-2');await page.getByLabel('项目路径',{exact:true}).fill('/projects/research');await page.getByRole('button',{name:'创建',exact:true}).click();
 await page.getByText('继承 · 来源：个人技能',{exact:true}).waitFor();
 await page.getByRole('button',{name:'在本层排除'}).click();await page.getByText('已排除 · 来源：投研社',{exact:true}).waitFor();
 await page.getByRole('button',{name:'恢复上级规则'}).click();await page.getByText('继承 · 来源：个人技能',{exact:true}).waitFor();
 await page.screenshot({path:'.dev-reports/governance-ui.png',fullPage:true});
 await page.getByRole('link',{name:'使用统计',exact:true}).click();
 await page.getByLabel('核对技能').selectOption('lanshu-create-ai-presenter-video');await page.getByRole('button',{name:'检索并导入',exact:true}).click();
 await page.getByRole('status').filter({hasText:'新增 1 条'}).waitFor();
 await page.getByRole('columnheader',{name:'证据数',exact:true}).waitFor();await page.getByText('原始证据',{exact:true}).waitFor();
 await page.locator('summary').click();await page.locator('.scrollbar-hide').first().evaluate(el=>el.scrollTop=0);await page.screenshot({path:'.dev-reports/usage-ui.png',fullPage:true});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
 fs.writeFileSync('.dev-reports/ui-smoke.json',JSON.stringify({mode:'headless frontend with mocked Tauri contract',checks:['create 3-level scopes','inheritance','exclude','reset override','nmem import refresh','evidence expansion','no horizontal document overflow'],errors,overflow},null,2));
 if(errors.length||overflow)throw new Error(JSON.stringify({errors,overflow}));
 console.log('UI contract smoke passed: hierarchy, exclusion/reset, usage import, evidence view');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
