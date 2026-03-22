import { Router } from 'express'
import { authMiddleware } from '../middleware/auth.js'
import { getInstagramStats, getFacebookStats, getLinkedInStats, getLatestSocialStats } from '../services/socialService.js'

const router = Router()
router.use(authMiddleware)

router.get('/stats', async (req, res) => {
  try {
    const stats = await getLatestSocialStats()
    res.json(stats)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/sync/instagram', async (req, res) => {
  try {
    const stat = await getInstagramStats()
    res.json(stat)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/sync/facebook', async (req, res) => {
  try {
    const stat = await getFacebookStats()
    res.json(stat)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/sync/linkedin', async (req, res) => {
  try {
    const stat = await getLinkedInStats()
    res.json(stat)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
