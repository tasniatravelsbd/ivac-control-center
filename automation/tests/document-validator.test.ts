import { describe,it,expect } from 'vitest'
import { validatePdf } from '../src/services/document-validator.js'
describe('document validation',()=>{it('rejects wrong types before upload',async()=>{await expect(validatePdf({storedPath:'C:/tmp/nope.txt',mimeType:'text/plain',size:1},1024)).rejects.toThrow('DOCUMENT_INVALID')});it('rejects oversized metadata before file access',async()=>{await expect(validatePdf({storedPath:'C:/tmp/a.pdf',mimeType:'application/pdf',size:2000},100)).rejects.toThrow('DOCUMENT_TOO_LARGE')})})
