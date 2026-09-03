import type { Page } from 'playwright'
export class IvacMissionPage {
  constructor(private page:Page){}
  private control(){return this.page.locator('select[name="mission"], select#mission, [role="combobox"][name="mission"]').first()}
  async waitUntilReady(){await this.control().waitFor({state:'visible',timeout:20_000})}
  async detectMissionControl(){return await this.control().count()>0}
  async getAvailableMissions(){return await this.control().locator('option').allTextContents()}
  async selectMission(value:string){await this.control().selectOption({label:value}).catch(async()=>this.control().selectOption({value}))}
  async verifyMissionSelected(value:string){const selected=await this.control().inputValue().catch(()=>''), text=await this.control().locator('option:checked').textContent().catch(()=>null);return selected.trim().toLowerCase()===value.trim().toLowerCase()||text?.trim().toLowerCase()===value.trim().toLowerCase()}
  async detectValidationError(){
    const structuralAlert=this.page.locator('[role="alert"]')
    const textualAlert=this.page.getByText(/required|invalid|error/i)
    for(const locator of [structuralAlert,textualAlert]){
      const count=await locator.count()
      for(let index=0;index<count;index+=1) if(await locator.nth(index).isVisible().catch(()=>false)) return true
    }
    return false
  }
  private centre(){return this.page.locator('select[name="centre"], select[name="ivac_centre"], select#centre, [role="combobox"][name="centre"]').first()}
  async detectCentreControl(){return await this.centre().count()>0}
  async getAvailableCentres(){return await this.centre().locator('option').allTextContents()}
  async selectCentre(value:string){await this.centre().selectOption({label:value}).catch(async()=>this.centre().selectOption({value}))}
  async verifyCentreSelected(value:string){const selected=await this.centre().inputValue().catch(()=>''), text=await this.centre().locator('option:checked').textContent().catch(()=>null);return selected.trim().toLowerCase()===value.trim().toLowerCase()||text?.trim().toLowerCase()===value.trim().toLowerCase()}
  async detectMissionCentreConfirmControl(){return await this.page.getByRole('button',{name:/continue|confirm|next/i}).count()>0}
  async confirmMissionCentre(){await this.page.getByRole('button',{name:/continue|confirm|next/i}).first().click()}
  async detectSlotTransition(){
    const structuralSlot=this.page.locator('input[type="date"], [data-slot]')
    const textualSlot=this.page.getByText(/select date|time slot|available dates/i)
    return this.page.url().includes('/appointment/time-slot')&&((await structuralSlot.count())>0||(await textualSlot.count())>0)
  }
}
