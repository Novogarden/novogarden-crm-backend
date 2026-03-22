import { Router } from 'express'
import { authMiddleware } from '../middleware/auth.js'
import { syncGmailEmails, getRecentEmails } from '../services/gmailService.js'
import { PrismaClient } from '@prisma/client'

const router = Router()
const prisma = new PrismaClient()
router.use(authMiddleware)

router.get('/emails', async (req, res) => {
  try {
    const emails = await getRecentEmails(parseInt(req.query.limit) || 30)
    res.json(emails)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/logs', async (req, res) => {
  try {
    const logs = await prisma.emailLog.findMany({
      orderBy: { dateEmail: 'desc' },
      take: 100
    })
    res.json(logs)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/sync', async (req, res) => {
  try {
    const results = await syncGmailEmails(req.body.maxResults || 50)
    res.json({ success: true, ...results })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/status', async (req, res) => {
  try {
    const token = await prisma.oAuthToken.findUnique({ where: { service: 'gmail' } })
    res.json({ connected: !!token, expiresAt: token?.expiresAt })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
