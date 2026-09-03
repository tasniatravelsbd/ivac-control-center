import { describe,it,expect } from 'vitest'
import { ConfigIvacTargetResolver, FixedIvacTargetResolver } from '../src/config/ivac-target.js'

describe('IVAC target resolvers',()=>{
  it('keeps the configured production default',()=>{const prior=process.env.IVAC_BASE_URL;process.env.IVAC_BASE_URL='https://example.test';expect(new ConfigIvacTargetResolver().url('/signin')).toBe('https://example.test/signin');process.env.IVAC_BASE_URL=prior})
  it('keeps two injected targets isolated',()=>{const a=new FixedIvacTargetResolver('http://127.0.0.1:4101',{fixture:true}),b=new FixedIvacTargetResolver('http://127.0.0.1:4102',{fixture:true});expect(a.url('/signin')).toBe('http://127.0.0.1:4101/signin');expect(b.url('/signin')).toBe('http://127.0.0.1:4102/signin')})
  it('rejects production in fixture mode',()=>expect(()=>new FixedIvacTargetResolver('https://appointment.ivacbd.com',{fixture:true})).toThrow('FIXTURE_TARGET_MUST_NOT_BE_PRODUCTION'))
})
