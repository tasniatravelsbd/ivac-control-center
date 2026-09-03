import { access, mkdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { env } from './config.js'

export const documentStorageRoot = env.DOCUMENT_STORAGE_PATH
export function resolveDocumentStoragePath(filename:string) {
  const resolved = path.resolve(documentStorageRoot, filename)
  if (resolved !== documentStorageRoot && !resolved.startsWith(`${documentStorageRoot}${path.sep}`)) throw new Error('DOCUMENT_STORAGE_PATH_INVALID')
  return resolved
}
export async function ensureDocumentStorageReady() {
  await mkdir(documentStorageRoot, { recursive: true })
  await access(documentStorageRoot, constants.R_OK | constants.W_OK)
}
