import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { prisma } from './prisma.js'
import { encryptSecret } from './crypto.js'
import { resolveDocumentStoragePath } from './document-storage.js'

export const applicationInclude = { preference: true, documents: true, events: { orderBy: { createdAt: 'desc' as const }, take: 50, include: { actor: { select: { id: true, name: true } } } }, assignedUser: { select: { id: true, name: true, email: true } }, creator: { select: { id: true, name: true } } }
export const safeApplication = (application: any) => application // Credentials intentionally are never included in any query/response.
export async function assertApplicationAccess(applicationId: string, userId: string) {
  const application = await prisma.application.findFirst({ where: { id: applicationId, OR: [{ createdBy: userId }, { assignedUserId: userId }] } })
  if (!application) { const exists = await prisma.application.findUnique({ where: { id: applicationId } }); const error: any = new Error(exists ? 'Forbidden' : 'Not found'); error.status = exists ? 403 : 404; throw error }
  return application
}
export async function event(applicationId: string, actorId: string, type: string, message: string, metadata?: object) { await prisma.applicationEvent.create({ data: { applicationId, actorId, type, message, metadata } }) }
export async function writePrivatePdf(file: Express.Multer.File) {
  const filename = `${randomUUID()}.pdf`; const storedPath = resolveDocumentStoragePath(filename)
  await writeFile(storedPath, file.buffer, { flag: 'wx' })
  return { storedPath, cleanup: () => rm(storedPath, { force: true }) }
}
