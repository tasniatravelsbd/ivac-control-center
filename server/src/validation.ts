import { z } from 'zod'

const date = z.string().date().optional().nullable()

const preferenceShape = {
  mission: z.string().trim().min(1).max(191),
  ivacCentre: z.string().trim().min(1).max(191),
  visaType: z.string().trim().min(1).max(191),
  preferredDate: date,
  allowAlternativeDates: z.boolean().default(false),
  allowedDateFrom: date,
  allowedDateTo: date,
}

const validateDateRange = (
  value: { allowedDateFrom?: string | null; allowedDateTo?: string | null },
  ctx: z.RefinementCtx,
) => {
  if (value.allowedDateFrom && value.allowedDateTo && value.allowedDateFrom > value.allowedDateTo) {
    ctx.addIssue({ code: 'custom', message: 'Date range is invalid', path: ['allowedDateTo'] })
  }
}

const preferenceInput = z.object(preferenceShape).superRefine(validateDateRange)
const applicationShape = {
  fullName: z.string().trim().min(2).max(191),
  webfileNumber: z.string().trim().min(2).max(191),
  email: z.string().trim().email().max(191),
  primaryPhone: z.string().trim().min(6).max(30),
  otpReceiverPhone: z.string().trim().min(6).max(30),
  notes: z.string().max(10000).optional().nullable(),
  loginPhone: z.string().trim().min(6).max(30),
  loginPassword: z.string().min(8).max(512).optional(),
  assignedUserId: z.string().cuid().optional().nullable(),
  status: z.enum(['DRAFT', 'ACTIVE']).optional(),
  preference: preferenceInput,
}

export const applicationInput = z.object(applicationShape)
export const updateApplicationInput = z.object(applicationShape).partial().extend({
  loginPassword: z.string().min(8).max(512).optional(),
  preference: z.object(preferenceShape).partial().superRefine(validateDateRange).optional(),
})
