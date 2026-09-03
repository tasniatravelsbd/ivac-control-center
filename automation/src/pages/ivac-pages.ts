import type { Page } from 'playwright'
export class IvacLoginPage { constructor(private p:Page){} async login(){await this.p.locator('input[name="phone"]').fill('+8801700000000');await this.p.locator('input[name="password"]').fill('fixture-password');await this.p.getByRole('button',{name:'Login'}).click()} }
export class IvacOtpPage { constructor(private p:Page){} async submit(){await this.p.locator('input[name="otp"]').fill('000000');await this.p.getByRole('button',{name:'Verify'}).click()} }
export class IvacFileUploadPage { constructor(private p:Page){} async upload(){await this.p.locator('input[type="file"]').setInputFiles({name:'bgdr.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 fixture')});await this.p.getByRole('button',{name:'Upload'}).click()} }
export class IvacMissionPage { constructor(private p:Page){} async select(){await this.p.locator('select[name="mission"]').selectOption('Italy');await this.p.locator('select[name="centre"]').selectOption('Dhaka');await this.p.getByRole('button',{name:'Continue'}).click()} }
export class IvacTimeSlotPage { constructor(private p:Page){} async choose(){const slot=this.p.locator('[data-slot="available"]'); if(!await slot.count()) throw new Error('NO_SLOT_AVAILABLE');await slot.click()} }
export class IvacContinuePaymentPage { constructor(private p:Page){} async continue(){await this.p.getByRole('button',{name:'Continue to payment'}).click()} }
export class DgePayPage { constructor(private p:Page){} async isReady(){return this.p.getByText('Manual payment required').isVisible()} }
