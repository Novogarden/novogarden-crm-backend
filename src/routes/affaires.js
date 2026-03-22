import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { authMiddleware } from '../middleware/auth.js'

const router = Router()
const prisma = new PrismaClient()

const ETAPES_ORDER = [
  'CONTACT', 'DEVIS_EN_COURS', 'DEVIS_ENVOYE', 'DEVIS_ACCEPTE',
  'RDV_PLANIFIE', 'TRAVAUX_EN_COURS', 'FACTURE_EMISE', 'PAYE'
]

router.use(authMiddleware)

// GET toutes les affaires (avec filtres)
router.get('/', async (req, res) => {
  try {
    const { etape, clientId, search, priorite } = req.query
    const where = {}
    if (etape) where.etape = etape
    if (clientId) where.clientId = clientId
    if (priorite) where.priorite = priorite
    if (search) {
      where.OR = [
        { titre: { contains: search, mode: 'insensitive' } },
        { client: { nom: { contains: search, mode: 'insensitive' } } },
        { reference: { contains: search, mode: 'insensitive' } }
      ]
    }

    const affaires = await prisma.affaire.findMany({
      where,
      include: {
        client: true,
        reclamations: { where: { statut: { in: ['OUVERTE', 'EN_COURS'] } } }
      },
      orderBy: { updatedAt: 'desc' }
    })
    res.json(affaires)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET pipeline (groupé par étape)
router.get('/pipeline', async (req, res) => {
  try {
    const affaires = await prisma.affaire.findMany({
      where: { etape: { not: 'ARCHIVE' } },
      include: { client: true, reclamations: { where: { statut: { in: ['OUVERTE', 'EN_COURS'] } } } },
      orderBy: { updatedAt: 'desc' }
    })

    const pipeline = ETAPES_ORDER.reduce((acc, etape) => {
      acc[etape] = affaires.filter(a => a.etape === etape)
      return acc
    }, {})

    const stats = {
      totalAffaires: affaires.length,
      montantDevisPotentiel: affaires
        .filter(a => ['DEVIS_ENVOYE', 'DEVIS_ACCEPTE'].includes(a.etape))
        .reduce((s, a) => s + (a.montantDevis || 0), 0),
      montantFacture: affaires
        .filter(a => ['FACTURE_EMISE', 'PAYE'].includes(a.etape))
        .reduce((s, a) => s + (a.montantFacture || 0), 0),
      montantEncaisse: affaires
        .filter(a => a.etape === 'PAYE')
        .reduce((s, a) => s + (a.montantFacture || 0), 0)
    }

    res.json({ pipeline, stats })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET une affaire
router.get('/:id', async (req, res) => {
  try {
    const affaire = await prisma.affaire.findUnique({
      where: { id: req.params.id },
      include: {
        client: true,
        historique: { orderBy: { createdAt: 'desc' } },
        reclamations: true
      }
    })
    if (!affaire) return res.status(404).json({ error: 'Affaire introuvable' })
    res.json(affaire)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST créer une affaire
router.post('/', async (req, res) => {
  try {
    const data = req.body
    const affaire = await prisma.affaire.create({
      data: {
        titre: data.titre,
        description: data.description,
        clientId: data.clientId,
        etape: data.etape || 'CONTACT',
        montantDevis: data.montantDevis ? parseFloat(data.montantDevis) : null,
        priorite: data.priorite || 'NORMALE',
        tags: data.tags || [],
        dateRdv: data.dateRdv ? new Date(data.dateRdv) : null
      },
      include: { client: true }
    })
    await prisma.historique.create({
      data: {
        affaireId: affaire.id,
        action: 'Affaire créée',
        etapeTo: affaire.etape
      }
    })
    res.status(201).json(affaire)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// PUT modifier une affaire
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params
    const data = req.body
    const current = await prisma.affaire.findUnique({ where: { id } })
    if (!current) return res.status(404).json({ error: 'Affaire introuvable' })

    const updated = await prisma.affaire.update({
      where: { id },
      data: {
        titre: data.titre,
        description: data.description,
        etape: data.etape,
        montantDevis: data.montantDevis !== undefined ? parseFloat(data.montantDevis) : undefined,
        montantFacture: data.montantFacture !== undefined ? parseFloat(data.montantFacture) : undefined,
        priorite: data.priorite,
        tags: data.tags,
        dateRdv: data.dateRdv ? new Date(data.dateRdv) : undefined,
        dateDevis: data.dateDevis ? new Date(data.dateDevis) : undefined,
        dateFacture: data.dateFacture ? new Date(data.dateFacture) : undefined,
        datePaiement: data.datePaiement ? new Date(data.datePaiement) : undefined
      },
      include: { client: true }
    })

    if (data.etape && data.etape !== current.etape) {
      await prisma.historique.create({
        data: {
          affaireId: id,
          action: `Étape modifiée`,
          etapeFrom: current.etape,
          etapeTo: data.etape,
          details: data.commentaire || null
        }
      })
    }

    res.json(updated)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// PATCH changer uniquement l'étape (pour drag & drop pipeline)
router.patch('/:id/etape', async (req, res) => {
  try {
    const { id } = req.params
    const { etape, commentaire } = req.body
    const current = await prisma.affaire.findUnique({ where: { id } })
    if (!current) return res.status(404).json({ error: 'Affaire introuvable' })

    const dateFields = {}
    if (etape === 'DEVIS_ENVOYE') dateFields.dateDevis = new Date()
    if (etape === 'RDV_PLANIFIE' && !current.dateRdv) dateFields.dateRdv = new Date()
    if (etape === 'TRAVAUX_EN_COURS') dateFields.dateDebut = new Date()
    if (etape === 'TRAVAUX_EN_COURS' || etape === 'FACTURE_EMISE') dateFields.dateFin = etape === 'FACTURE_EMISE' ? new Date() : undefined
    if (etape === 'FACTURE_EMISE') dateFields.dateFacture = new Date()
    if (etape === 'PAYE') dateFields.datePaiement = new Date()

    const updated = await prisma.affaire.update({
      where: { id },
      data: { etape, ...dateFields },
      include: { client: true }
    })

    await prisma.historique.create({
      data: {
        affaireId: id,
        action: `Avancement pipeline`,
        etapeFrom: current.etape,
        etapeTo: etape,
        details: commentaire || null
      }
    })

    res.json(updated)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// DELETE
router.delete('/:id', async (req, res) => {
  try {
    await prisma.affaire.update({ where: { id: req.params.id }, data: { etape: 'ARCHIVE' } })
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
