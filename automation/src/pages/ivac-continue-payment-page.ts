import type { Page } from 'playwright'
export type PaymentHandoffInfo={handoffReady:boolean;provider:string|null;destinationHost:string|null;generatedAt:string;reference:string|null}
export class IvacContinuePaymentPage {
  constructor(private page:Page){}
  async waitUntilReady(){await this.page.locator('body').waitFor({state:'visible',timeout:20_000})}
  async detectPaymentSummary(){return await this.page.locator('text=/payment summary|invoice|amount payable|booking summary/i').count()>0}
  async detectPaymentAction(){return await this.page.getByRole('button',{name:/pay|continue.*payment|proceed/i}).count()>0||await this.page.getByRole('link',{name:/pay|continue.*payment|proceed/i}).count()>0}
  async detectPaymentHandoff(){return this.page.url().includes('checkout.dgepay.net')||(await this.detectPaymentSummary()&&await this.detectPaymentAction())}
  async getPaymentHandoffInfo():Promise<PaymentHandoffInfo>{const text=await this.page.locator('body').innerText();const reference=text.match(/(?:invoice|reference|booking)\s*(?:no\.?|#|:)?\s*([A-Z0-9-]{4,})/i)?.[1]??null;const host=new URL(this.page.url()).host;return {handoffReady:await this.detectPaymentHandoff(),provider:host.includes('dgepay')?'DGePay':null,destinationHost:host.includes('dgepay')?host:null,generatedAt:new Date().toISOString(),reference}}
}
