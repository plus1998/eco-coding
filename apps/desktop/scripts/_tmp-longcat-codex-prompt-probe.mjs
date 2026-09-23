import { chromium } from '@playwright/test';
const cdpUrl=process.env.ECO_DEV_CDP_URL||'http://127.0.0.1:9333';
const timeoutMs=Number(process.env.ECO_TIMEOUT||90000);
const browser=await chromium.connectOverCDP(cdpUrl); const page=browser.contexts()[0]?.pages()?.[0]; if(!page) throw new Error('no page');
const template=await page.evaluate(async()=>{
 const ts=await window.eco.listThreads?.()??[];
 return ts.find(t=>t.coreKind==='codex'&&t.runtimeConfig?.resolvedOrchestrationSnapshot?.mainAgent?.modelRef?.modelId==='LongCat-2.0'&&((t.runtimeConfig?.resolvedOrchestrationSnapshot?.agents?.length??0)===0));
});
if(!template) throw new Error('no template');
const marker=`V2_LONGCAT_PROMPT_${Date.now().toString(36).toUpperCase()}`;
const variants=[
 {name:'user_only', dev:'', user:[`只做一个动作。立即调用 Bash。命令必须逐字等于：printf \'${marker}_USER\'。Bash 成功后只回复 ${marker}_USER。禁止解释、禁止思考文本、禁止其他工具。`].join(' ')},
 {name:'developer_contract', dev:[
  '工具执行协议（必须遵守）：当用户要求执行 Bash 时，下一步必须发送一个 Bash 工具调用，不能先输出文字、不能只思考。',
  '本轮只允许调用一次 Bash，命令必须逐字使用用户给出的命令。工具返回后只输出工具返回内容。',
  '如果工具可用，禁止用普通文本代替工具调用。',
 ].join('\n'), user:`执行 Bash，命令逐字等于 printf '${marker}_DEV'。完成后只回复 ${marker}_DEV。`},
 {name:'tool_name_contract', dev:[
  '必须使用名为 Bash 的工具执行命令。不要把 Bash 当作文字描述。',
  '调用参数必须是 {"command":"printf \'${marker}_TOOL\'"}。调用后不要解释。',
 ].join('\n'), user:`现在调用 Bash 工具。`},
];
function tune(cfg,dev){const c=JSON.parse(JSON.stringify(cfg)); c.thinkingEffort='minimal'; const s=c.resolvedOrchestrationSnapshot; if(s){s.mainAgent.modelRef.thinkingEffort='minimal'; if(dev){s.mainAgent.systemPromptPreset='custom_append'; s.mainAgent.prompt=dev;}} c.sessionMode='agent'; c.bashReviewMode='allow_all'; return c;}
async function read(id){return page.evaluate(async id=>{const [t,h,b]=await Promise.all([window.eco.getThread(id),window.eco.conversationV2Head?.(id),window.eco.conversationV2Bootstrap?.(id,{pageSize:100})]);return {t,h,b,text:(b?.messages??[]).map(x=>String(x?.body??'')).join('\n'),tools:b?.tools?.length??0,agents:b?.agents?.length??0};},id)}
for (const v of variants){
 const started=await page.evaluate(async x=>window.eco.startThread({workspacePath:x.path,coreKind:'codex',runtimeConfig:x.cfg,prompt:x.user}),{path:template.workspacePath,cfg:tune(template.runtimeConfig,v.dev),user:v.user});
 const id=started?.thread?.id; let state; const startedAt=Date.now(); while(Date.now()-startedAt<timeoutMs){state=await read(id); if(['completed','failed','blocked','interrupted'].includes(state?.t?.status)) break; await page.waitForTimeout(1000);}
 if(['running','queued','awaiting_plan'].includes(state?.t?.status)){const result=await page.evaluate(async id=>{const h=await window.eco.conversationV2Head?.(id);return window.eco.cancelThread?.({principalId:'desktop-local',clientCommandId:`cancel_${id}_${Date.now()}`,threadId:id,expectedHistoryRevision:Number.isSafeInteger(h?.historyRevision)?h.historyRevision:0,worktreeDisposition:'keep'});},id); await page.waitForTimeout(500); state=await read(id); state.cancel=result;}
 console.log(JSON.stringify({variant:v.name,id,status:state?.t?.status,message:state?.t?.message,tools:state?.tools,agents:state?.agents,text:state?.text?.slice(-2000),timedOut:Date.now()-startedAt>=timeoutMs}));
}
await browser.close();
