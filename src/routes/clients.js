import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { authMiddleware } from '../middleware/auth.js'

const router = Router()
const prisma = new PrismaClient()
router.use(authMiddleware)

router.get('/', async (req, res) => {
  try {
    const { search } = req.query
    const where = search ? {
      OR: [
        { nom: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { telephone: { contains: search } }
      ]
    } : {}
    const clients = await prisma.client.findMany({
      where,
      include: { _count: { select: { affaires: true } } },
      orderBy: { nom: 'asc' }
    })
    res.json(clients)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/:id', async (req, res) => {
  try {
    const client = await prisma.client.findUnique({
      where: { id: req.params.id },
      include: {
        affaires: {
          include: { reclamations: true },
          orderBy: { createdAt: 'desc' }
        }
      }
    })
    if (!client) return res.status(404).json({ error: 'Client introuvable' })
    res.json(client)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/', async (req, res) => {
  try {
    const client = await prisma.client.create({ data: req.body })
    res.status(201).json(client)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.put('/:id', async (req, res) => {
  try {
    const client = await prisma.client.update({ where: { id: req.params.id }, data: req.body })
    res.json(client)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
