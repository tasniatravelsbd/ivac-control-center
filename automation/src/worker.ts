import { WorkerApi } from './api/client.js'
import { JobCoordinator } from './coordinator/job-coordinator.js'
import { WorkflowOrchestrator } from './coordinator/workflow-orchestrator.js'

const api = new WorkerApi()
const coordinator = new JobCoordinator(api)
const orchestrator = new WorkflowOrchestrator(coordinator)

await api.heartbeat(); setInterval(()=>api.heartbeat().catch(()=>undefined),30_000)
setInterval(()=>coordinator.cleanupStale().catch(()=>undefined),60_000)
setInterval(async()=>{try{const {command}=await api.claimNextCommand();if(!command)return;try{await coordinator.executeCommand(command);await api.acknowledgeCommand(command.id,true)}catch(error){const code=error instanceof Error?error.message:'COMMAND_FAILED';await api.acknowledgeCommand(command.id,false,code)}}catch{/* command polling is intentionally secret-free */}},3_000)
setInterval(async()=>{try{const {job}=await api.next();if(job&&!coordinator.registry.has(job.id))await orchestrator.runJobWorkflow(job.id)}catch{/* deliberately no secret-bearing logging */}},5_000)
process.on('SIGTERM',()=>void coordinator.shutdown().finally(()=>process.exit(0)))
