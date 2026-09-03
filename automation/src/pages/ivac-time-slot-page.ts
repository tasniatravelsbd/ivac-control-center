import type { Page } from 'playwright'

export type SlotSnapshot = { visibleMonth:string; availableDates:string[]; disabledDates:string[]; checkedAt:string }
export class IvacTimeSlotPage {
  constructor(private page:Page) {}
  private calendar(){ return this.page.locator('[role="grid"], .calendar, [data-calendar]').first() }
  async waitUntilReady(){ await this.calendar().waitFor({state:'visible',timeout:20_000}) }
  async detectCalendar(){ return await this.calendar().count()>0 }
  async readVisibleMonth(){ const text=await this.page.locator('[role="heading"], .calendar-caption, [data-calendar-month]').allTextContents(); const value=text.find(x=>/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/i.test(x)); if(!value)throw new Error('CALENDAR_MONTH_UNKNOWN'); return value.trim() }
  async getDateButtons(){ return this.calendar().locator('button,[role="gridcell"]').evaluateAll(nodes=>nodes.filter((n:any)=>n.offsetParent!==null).map((n:any)=>({text:n.textContent?.trim()??'',disabled:n.disabled===true||n.getAttribute('aria-disabled')==='true',outside:n.getAttribute('data-outside')==='true'||n.classList.contains('outside-month')})).filter((x:any)=>/^\d{1,2}$/.test(x.text)&&!x.outside)) }
  async snapshot():Promise<SlotSnapshot>{ const visibleMonth=await this.readVisibleMonth(),parts=visibleMonth.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i);if(!parts)throw new Error('CALENDAR_MONTH_UNKNOWN');const month=new Date(`${parts[1]} 1, ${parts[2]}`).getMonth()+1,dates=await this.getDateButtons();if(!dates.length)throw new Error('DATE_CONTROLS_NOT_FOUND');const normalize=(d:string)=>`${parts[2]}-${String(month).padStart(2,'0')}-${d.padStart(2,'0')}`;return {visibleMonth,availableDates:dates.filter(d=>!d.disabled).map(d=>normalize(d.text)),disabledDates:dates.filter(d=>d.disabled).map(d=>normalize(d.text)),checkedAt:new Date().toISOString()} }
  async getAvailableDates(){ return (await this.snapshot()).availableDates }
  async getDisabledDates(){ return (await this.snapshot()).disabledDates }
  async isDateStillAvailable(candidateDate:string){ if(!/^\d{4}-\d{2}-\d{2}$/.test(candidateDate))return false; return (await this.snapshot()).availableDates.includes(candidateDate) }
  private async dateControl(candidateDate:string){const [year,month,day]=candidateDate.split('-').map(Number),visible=await this.readVisibleMonth(),expected=new Date(year,month-1,day).toLocaleString('en-US',{month:'long',year:'numeric'});if(visible.toLowerCase()!==expected.toLowerCase())throw new Error('TARGET_DATE_NOT_FOUND');const label=new Date(year,month-1,day).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});const byData=this.calendar().locator(`[data-date="${candidateDate}"], [data-value="${candidateDate}"]`).first();if(await byData.count())return byData;return this.calendar().getByRole('button',{name:new RegExp(`${label}|^${day}$`)}).first()}
  async selectDate(candidateDate:string){if(!await this.isDateStillAvailable(candidateDate))throw new Error('SELECTED_DATE_NO_LONGER_AVAILABLE');const control=await this.dateControl(candidateDate);if(!await control.count())throw new Error('TARGET_DATE_NOT_FOUND');if(await control.isDisabled().catch(()=>false)||await control.getAttribute('aria-disabled')==='true')throw new Error('TARGET_DATE_DISABLED');await control.click()}
  async verifyDateSelected(candidateDate:string){const control=await this.dateControl(candidateDate);const selected=await control.getAttribute('aria-selected')==='true'||await control.getAttribute('data-selected')==='true'||(await control.getAttribute('class')??'').includes('selected');if(selected)return true;const summary=await this.page.locator('[data-selected-date], [aria-live="polite"], .selected-date').allTextContents();return summary.some(x=>x.includes(candidateDate))}
  private continueControl(){return this.page.getByRole('button',{name:/continue booking|continue/i}).first()}
  async detectContinueBookingControl(){return await this.continueControl().count()>0}
  async isContinueBookingEnabled(){return await this.continueControl().isEnabled().catch(()=>false)}
  async continueBooking(){await this.continueControl().click()}
  async detectContinuePaymentTransition(){const marker=this.page.locator('text=/payment summary|invoice|continue payment|payment preparation/i');return this.page.url().includes('/appointment/continue-payment')&&(await marker.count()>0)}
}
