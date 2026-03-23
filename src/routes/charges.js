import { Router } from 'express'
import multer from 'multer'
import { PrismaClient } from '@prisma/client'
import { authMiddleware } from '../middleware/auth.js'
import pdfParse from 'pdf-parse/lib/pdf-parse.js'

const router = Router()
const prisma = new PrismaClient()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } })

const CATEGORIES = ['CARBURANT', 'MATERIEL', 'ASSURANCE', 'TELEPHONE', 'MARKETING', 'TRANSPORT', 'FOURNITURES', 'DIVERS']

function detectCategorie(text) {
  const t = (text || '').toLowerCase()
  if (/carburant|essence|gasoil|fuel|sp95|total|esso|bp |leclerc/.test(t)) return 'CARBURANT'
  if (/lymow|robot|tondeuse|pi[eè]ce|mat[eé]riel|outil|batterie/.test(t)) return 'MATERIEL'
  if (/assurance|mutuelle|maif|axa|april|allianz|covea/.test(t)) return 'ASSURANCE'
  if (/orange|sfr|bouygues|free|t[eé]l[eé]phone|internet|mobile/.test(t)) return 'TELEPHONE'
  if (/facebook|google|meta|publicit[eé]|marketing|canva|wix/.test(t)) return 'MARKETING'
  if (/transport|livraison|chronopost|ups|colissimo|dhl/.test(t)) return 'TRANSPORT'
  if (/fourniture|papier|bureau|imprimante|encre/.test(t)) return 'FOURNITURES'
  return 'DIVERS'
}

function parseCharge(text) {
  const t = text || ''
  const result = { fournisseur: '', categorie: detectCategorie(t), montantHT: '', montantTTC: '', tva: '', date: '', reference: '', notes: '' }

  // Fournisseur (nom en haut du document)
  const lines = t.split('\n').map(l => l.trim()).filter(l => l.length > 2)
  const nomLine = lines.find(l => /^[A-ZÀ-Ÿa-z]/.test(l) && l.length < 60 && !/^(facture|devis|bon de|date|total|montant)/i.test(l))
  if (nomLine) result.fournisseur = nomLine.substring(0, 60)

  // Référence
  const refMatch = t.match(/(?:facture|ref|n°|num[eé]ro)[^\n]*?([A-Z0-9\-\/]{4,20})/i)
  if (refMatch) result.reference = refMatch[1].trim()

  // Montants
  const montants = [...t.matchAll(/(\d+(?:[.,]\d{2})?)\s*€/g)].map(m => parseFloat(m[1].replace(',', '.')))
  if (montants.length) {
    const sorted = [...new Set(montants)].sort((a,b) => a-b)
    if (sorted.length >= 2) {
      result.montantHT = sorted[sorted.length - 2].toFixed(2)
      result.montantTTC = sorted[sorted.length - 1].toFixed(2)
      const tva = result.montantTTC - result.montantHT
      if (tva > 0) result.tva = tva.toFixed(2)
    } else {
      result.montantTTC = sorted[0].toFixed(2)
    }
  }

  // TVA explicite
  const tvaMatch = t.match(/TVA\s*(?:20|10|5[.,]5)?\s*%[^\d]*(\d+(?:[.,]\d{2})?)/i)
  if (tvaMatch) result.tva = parseFloat(tvaMatch[1].replace(',', '.')).toFixed(2)

  // Date
  const dateMatch = t.match(/(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})|(\d{1,2}\s+(?:janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+\d{4})/i)
  if (dateMatch) result.date = dateMatch[0].trim()

  return result
}

// POST /api/charges/parse
router.post('/parse', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier' })
    let text = ''
    if (req.file.mimetype === 'application/pdf') {
      try { const d = await pdfParse(req.file.buffer); text = d.text || '' } catch {}
    }
    res.json({ ...parseCharge(text), rawText: text.substring(0, 2000) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /api/charges
router.post('/', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier' })
    const data = req.body.data ? JSON.parse(req.body.data) : {}
    const charge = await prisma.charge.create({
      data: {
        fileName:    req.file.originalname,
        mimeType:    req.file.mimetype,
        fileData:    req.file.buffer.toString('base64'),
        fournisseur: data.fournisseur || null,
        categorie:   data.categorie   || 'DIVERS',
        montantHT:   data.montantHT   ? parseFloat(data.montantHT)  : null,
        montantTTC:  data.montantTTC  ? parseFloat(data.montantTTC) : null,
        tva:         data.tva         ? parseFloat(data.tva)        : null,
        date:        data.date        || null,
        reference:   data.reference   || null,
        notes:       data.notes       || null,
        rawText:     data.rawText     || null,
      }
    })
    res.json(charge)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// GET /api/charges
router.get('/', authMiddleware, async (req, res) => {
  try {
    const charges = await prisma.charge.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, fileName: true, categorie: true, fournisseur: true, montantHT: true, montantTTC: true, tva: true, date: true, reference: true, notes: true, createdAt: true }
    })
    res.json(charges)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// GET /api/charges/stats
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const charges = await prisma.charge.findMany({ select: { categorie: true, montantTTC: true, date: true } })
    const totalTTC = charges.reduce((s, c) => s + (c.montantTTC || 0), 0)
    const parCategorie = {}
    CATEGORIES.forEach(cat => {
      parCategorie[cat] = charges.filter(c => c.categorie === cat).reduce((s,c) => s + (c.montantTTC || 0), 0)
    })
    res.json({ totalTTC, parCategorie, count: charges.length })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// GET /api/charges/:id/file
router.get('/:id/file', authMiddleware, async (req, res) => {
  try {
    const c = await prisma.charge.findUnique({ where: { id: req.params.id } })
    if (!c) return res.status(404).json({ error: 'Introuvable' })
    res.setHeader('Content-Type', c.mimeType)
    res.setHeader('Content-Disposition', `inline; filename="${c.fileName}"`)
    res.send(Buffer.from(c.fileData, 'base64'))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// DELETE /api/charges/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await prisma.charge.delete({ where: { id: req.params.id } })
    res.json({ success: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

export default router
