import type { Page } from 'playwright'
export async function diagnostic(page:Page,label:string, code:string){ const safe=`artifacts/${Date.now()}-${label.replace(/[^a-z0-9]/gi,'-')}.png`; await page.screenshot({path:safe,fullPage:true}).catch(()=>undefined); return { url:page.url(), title:await page.title().catch(()=>''), expectedSelector:label, errorCode:code, screenshotPath:safe } }
