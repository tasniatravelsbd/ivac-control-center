export type WorkerHealthDto={online:boolean;activeJobCount:number;staleSessionCount:number;retryCount:number;timestamp:string}
export function workerHealth(input:Omit<WorkerHealthDto,'timestamp'>):WorkerHealthDto{return {...input,timestamp:new Date().toISOString()}}
