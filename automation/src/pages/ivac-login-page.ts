import type { Page } from 'playwright'
export class IvacLoginPage {
  constructor(private page: Page) {}
  async waitUntilReady(timeout = 20_000) { await this.page.locator('form.space-y-5').waitFor({ state: 'visible', timeout }); await this.page.locator('input[name="phone"]').waitFor({ state: 'visible', timeout }); await this.page.locator('input[name="password"]').waitFor({ state: 'visible', timeout }) }
  async enterPhone(phone: string) { await this.page.locator('input[name="phone"]').fill(phone) }
  async enterPassword(password: string) { await this.page.locator('input[name="password"]').fill(password) }
  async detectVerification() {
    const structuralVerification = this.page.locator(
      'iframe[src*="turnstile"], iframe[src*="captcha"], [data-sitekey], .cf-turnstile',
    )
    const textualVerification = this.page.getByText(
      /verify you are human|security check|captcha/i,
    )

    const hasVisibleMatch = async (locator: ReturnType<Page['locator']>) => {
      const count = await locator.count()
      for (let index = 0; index < count; index += 1) {
        if (await locator.nth(index).isVisible().catch(() => false)) return true
      }
      return false
    }

    return (await hasVisibleMatch(structuralVerification)) || (await hasVisibleMatch(textualVerification))
  }
  async submit() { await this.page.locator('form.space-y-5').getByRole('button', { name: /sign in|login/i }).click() }
  async detectLoginFailure() { const text = await this.page.locator('body').innerText().catch(() => ''); return /invalid (phone|password|credentials)|incorrect password|try again/i.test(text) }
  async detectOtpTransition() { const url = this.page.url(); const otpInput = await this.page.locator('input[name="otp"], input[autocomplete="one-time-code"], input[inputmode="numeric"]').count() > 0; const text = await this.page.locator('body').innerText().catch(() => ''); const loginGone = await this.page.locator('form.space-y-5 input[name="password"]').count() === 0; return (url.includes('/verify-login-phone-otp') && (otpInput || /verification code|one.?time password|otp/i.test(text))) || (otpInput && loginGone) }
}
