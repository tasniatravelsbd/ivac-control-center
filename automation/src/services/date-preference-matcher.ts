export type DatePreferences={preferredDate?:string|null;allowedDateFrom?:string|null;allowedDateTo?:string|null;allowAlternativeDates:boolean}
export type DateClassification='PREFERRED_AVAILABLE'|'ALTERNATIVE_AVAILABLE'|'OUTSIDE_ALLOWED_RANGE'|'NO_ALLOWED_DATE'
export class DatePreferenceMatcher {
  private readonly preferences:DatePreferences
  constructor(preferences:DatePreferences){this.preferences={...preferences,preferredDate:this.normalized(preferences.preferredDate),allowedDateFrom:this.normalized(preferences.allowedDateFrom),allowedDateTo:this.normalized(preferences.allowedDateTo)}}
  private normalized(value?:string|null){if(!value)return value;const match=value.match(/^\d{4}-\d{2}-\d{2}/);return match?.[0]??value}
  isPreferredDate(date:string){return !!this.preferences.preferredDate&&date===this.preferences.preferredDate}
  isWithinAllowedRange(date:string){const from=this.preferences.allowedDateFrom,to=this.preferences.allowedDateTo;return (!from||date>=from)&&(!to||date<=to)}
  classifyAvailableDates(dates:string[]){const preferred=dates.filter(x=>this.isPreferredDate(x));if(preferred.length)return {classification:'PREFERRED_AVAILABLE' as DateClassification,allowedDates:preferred,bestCandidate:preferred[0]};const alternatives=dates.filter(x=>this.isWithinAllowedRange(x));if(this.preferences.allowAlternativeDates&&alternatives.length)return {classification:'ALTERNATIVE_AVAILABLE' as DateClassification,allowedDates:alternatives,bestCandidate:alternatives.sort()[0]};return {classification:dates.length?'OUTSIDE_ALLOWED_RANGE' as DateClassification:'NO_ALLOWED_DATE' as DateClassification,allowedDates:[],bestCandidate:null}}
  getBestAllowedDate(dates:string[]){return this.classifyAvailableDates(dates).bestCandidate}
}
