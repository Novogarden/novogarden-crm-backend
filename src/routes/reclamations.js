import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { authMiddleware } from '../middleware/auth.js'

const router = Router()
const prisma = new PrismaClient()
router.use(authMiddleware)

router.get('/', async (req, res) => {
  try {
    const { statut } = req.query
    const where = statut ? { statut } : {}
    const reclamations = await prisma.reclamation.findMany({
      where,
      include: { affaire: { include: { client: true } } },
      orderBy: { createdAt: 'desc' }
    })
    res.json(reclamations)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/', async (req, res) => {
  try {
    const rec = await prisma.reclamation.create({ data: req.body })
    res.status(201).json(rec)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.patch('/:id/statut', async (req, res) => {
  try {
    const { statut } = req.body
    const data = { statut }
    if (statut === 'RESOLUE') data.resolueAt = new Date()
    const rec = await prisma.reclamation.update({ where: { id: req.params.id }, data })
    res.json(rec)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
