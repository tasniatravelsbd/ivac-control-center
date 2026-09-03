import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { prisma } from './prisma.js'

const email = process.env.SEED_ADMIN_EMAIL
const password = process.env.SEED_ADMIN_PASSWORD
if (!email || !password) throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD before creating the initial operator')
await prisma.user.upsert({ where: { email }, update: {}, create: { name: process.env.SEED_ADMIN_NAME ?? 'Initial Operator', email, passwordHash: await bcrypt.hash(password, 12) } })
await prisma.$disconnect()
