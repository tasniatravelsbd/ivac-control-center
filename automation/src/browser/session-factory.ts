import { BrowserSession } from './session.js'
export interface BrowserSessionFactory { create(jobId:string):Promise<BrowserSession> }
export class PlaywrightBrowserSessionFactory implements BrowserSessionFactory { async create(_jobId:string){return new BrowserSession()} }
