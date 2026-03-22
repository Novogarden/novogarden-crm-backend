import { Router } from 'express'
import { authMiddleware } from '../middleware/auth.js'
import { getWixAnalytics, getWixContacts, getWixForms, getLatestWixStats } from '../services/wixService.js'

const router = Router()
router.use(authMiddleware)

router.get('/analytics', async (req, res) => {
  try {
    const { startDate, endDate } = req.query
    const data = await getWixAnalytics(startDate, endDate)
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/stats', async (req, res) => {
  try {
    const stats = await getLatestWixStats()
    res.json(stats)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/contacts', async (req, res) => {
  try {
    const contacts = await getWixContacts()
    res.json(contacts)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/forms', async (req, res) => {
  try {
    const forms = await getWixForms()
    res.json(forms)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
