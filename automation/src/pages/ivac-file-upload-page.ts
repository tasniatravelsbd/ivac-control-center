import type { Page } from 'playwright'
export class IvacFileUploadPage {
  constructor(private page:Page){}
  async waitUntilReady(){await this.page.locator('input[type="file"]').first().waitFor({state:'visible',timeout:20_000})}
  async detectFileInput(){return await this.page.locator('input[type="file"]').count()>0}
  async validateCurrentApplication(){return await this.detectFileInput()}
  async uploadDocument(filePath:string){await this.page.locator('input[type="file"]').first().setInputFiles(filePath)}
  async detectUploadStarted(){return await this.page.locator('text=/uploading|processing/i').count()>0}
  async detectUploadSuccess(){const body=await this.page.locator('body').innerText().catch(()=>''), enabled=await this.page.locator('button:enabled').count();return /uploaded|upload complete|success|file selected/i.test(body)&&enabled>0}
  async detectUploadFailure(){return /upload failed|invalid file|unsupported|rejected|too large/i.test(await this.page.locator('body').innerText().catch(()=>''))}
  async detectConfirmationControl(){return await this.page.locator('button:enabled').count()>0}
  async detectApplicantSummary(){return await this.page.locator('text=/applicant|webfile|passport/i').count()>0}
  async isConfirmationEnabled(){const control=this.page.getByRole('button',{name:/confirm all information|information.*correct|confirm/i}).first();return await control.isEnabled().catch(()=>false)}
  async confirmInformation(){await this.page.getByRole('button',{name:/confirm all information|information.*correct|confirm/i}).first().click()}
  async detectValidationError(){
    const structuralAlert=this.page.locator('[role="alert"]')
    const textualAlert=this.page.getByText(/required|invalid|error/i)
    for(const locator of [structuralAlert,textualAlert]){
      const count=await locator.count()
      for(let index=0;index<count;index+=1) if(await locator.nth(index).isVisible().catch(()=>false)) return true
    }
    return false
  }
  async detectMissionTransition(){
    const structuralMission=this.page.locator('select[name="mission"], input[name="mission"]')
    const textualMission=this.page.getByText(/select mission|mission/i)
    return this.page.url().includes('/appointment/mission')&&((await structuralMission.count())>0||(await textualMission.count())>0)
  }
}
