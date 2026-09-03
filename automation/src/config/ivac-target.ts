const productionHost='appointment.ivacbd.com'
export function ivacBaseUrl(){return process.env.IVAC_BASE_URL??'https://appointment.ivacbd.com'}
export function assertFixtureTarget(){const url=new URL(ivacBaseUrl());if(url.host===productionHost)throw new Error('FIXTURE_TARGET_MUST_NOT_BE_PRODUCTION')}
export function ivacPath(path:string){return new URL(path,ivacBaseUrl()).toString()}
export interface IvacTargetResolver { url(path:string):string }
export class ConfigIvacTargetResolver implements IvacTargetResolver { url(path:string){return ivacPath(path)} }
export class FixedIvacTargetResolver implements IvacTargetResolver {
  private readonly base:URL
  constructor(baseUrl:string,{fixture=false}:{fixture?:boolean}={}){this.base=new URL(baseUrl);if(fixture&&this.base.hostname===productionHost)throw new Error('FIXTURE_TARGET_MUST_NOT_BE_PRODUCTION')}
  url(path:string){return new URL(path,this.base).toString()}
}
