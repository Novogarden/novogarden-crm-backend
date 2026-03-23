import { Router } from 'express'
import multer from 'multer'
import { PrismaClient } from '@prisma/client'
import { authMiddleware } from '../middleware/auth.js'
import { pdf } from 'pdf-to-img'
import { createWorker } from 'tesseract.js'

const router = Router()
const prisma = new PrismaClient()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } })

// Extraction intelligente depuis le texte brut
function parseDocument(text) {
  const t = text || ''
  const result = { type: 'AUTRE', clientNom: '', adresse: '', reference: '', pack: '', surface: '', montant: '', date: '', notes: '' }

  // Type de document
  if (/facture/i.test(t)) result.type = 'FACTURE'
  else if (/contrat/i.test(t)) result.type = 'CONTRAT'
  else if (/devis/i.test(t)) result.type = 'DEVIS'

  // Référence / numéro
  const refMatch = t.match(/(?:facture|contrat|devis|ref|n°|num[eé]ro)\s*[:#]?\s*([A-Z0-9\-\/]{4,20})/i)
  if (refMatch) result.reference = refMatch[1].trim()

  // Nom client (Monsieur/Madame/M./Mme suivi d'un nom)
  const clientMatch = t.match(/(?:client|destinataire|factur[eé] [àa]|pour)\s*[:\n]?\s*(?:M(?:onsieur|adame|\.)?\.?\s+)?([A-ZÀ-Ÿ][a-zà-ÿ]+(?:\s+[A-ZÀ-Ÿ][a-zà-ÿ]+)+)/m)
  if (clientMatch) result.clientNom = clientMatch[1].trim()

  // Pack Novogarden
  if (/s[eé]r[eé]nit[eé]|10\s*tontes?/i.test(t)) result.pack = 'SERENITE'
  else if (/essentiel|5\s*tontes?/i.test(t)) result.pack = 'ESSENTIEL'
  else if (/solo|1\s*tonte/i.test(t)) result.pack = 'SOLO'

  // Surface en m²
  const surfMatch = t.match(/(\d+(?:[.,]\d+)?)\s*m[²2]/i)
  if (surfMatch) result.surface = surfMatch[1].replace(',', '.')

  // Montant en euros
  const montants = [...t.matchAll(/(\d+(?:[.,]\d{2})?)\s*€/g)].map(m => parseFloat(m[1].replace(',', '.')))
  if (montants.length) result.montant = Math.max(...montants).toFixed(2)

  // Date française (DD/MM/YYYY ou D MOIS YYYY)
  const dateMatch = t.match(/(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})|(\d{1,2}\s+(?:janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+\d{4})/i)
  if (dateMatch) result.date = dateMatch[0].trim()

  // Adresse (code postal français)
  const adrMatch = t.match(/(\d+.{1,40}\b(?:61|53|72)\d{3}\b.{0,30})/i)
  if (adrMatch) result.adresse = adrMatch[1].replace(/\n/g, ' ').trim().substring(0, 100)

  return result
}

async function extractText(file) {
  let text = ''
  try {
    if (file.mimetype === 'application/pdf') {
      const pages = await pdf(file.buffer, { scale: 2 })
      let imgBuf = null
      for await (const page of pages) { imgBuf = page; break }
      if (imgBuf) {
        const worker = await createWorker('fra')
        const { data: { text: t } } = await worker.recognize(imgBuf)
        await worker.terminate()
        text = t || ''
      }
    } else if (/^image\//.test(file.mimetype)) {
      const worker = await createWorker('fra')
      const { data: { text: t } } = await worker.recognize(file.buffer)
      await worker.terminate()
      text = t || ''
    }
  } catch (e) {
    console.error('OCR error:', e.message)
  }
  return text
}

// POST /api/documents/parse — analyse sans sauvegarder
router.post('/parse', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier' })
    const text = await extractText(req.file)
    const extracted = parseDocument(text)
    res.json({ ...extracted, rawText: text.substring(0, 2000) })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/documents — sauvegarde
router.post('/', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier' })
    const data = req.body.data ? JSON.parse(req.body.data) : {}
    const fileData = req.file.buffer.toString('base64')

    const doc = await prisma.document.create({
      data: {
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        fileData,
        type:      data.type      || 'AUTRE',
        clientNom: data.clientNom || null,
        adresse:   data.adresse   || null,
        reference: data.reference || null,
        pack:      data.pack      || null,
        surface:   data.surface   || null,
        montant:   data.montant   || null,
        date:      data.date      || null,
        notes:     data.notes     || null,
        rawText:   data.rawText   || null,
      }
    })
    res.json(doc)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/documents
router.get('/', authMiddleware, async (req, res) => {
  try {
    const docs = await prisma.document.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, fileName: true, mimeType: true, type: true, clientNom: true, adresse: true, reference: true, pack: true, surface: true, montant: true, date: true, notes: true, createdAt: true }
    })
    res.json(docs)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/documents/:id/file — télécharger le fichier
router.get('/:id/file', authMiddleware, async (req, res) => {
  try {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } })
    if (!doc) return res.status(404).json({ error: 'Introuvable' })
    const buf = Buffer.from(doc.fileData, 'base64')
    res.setHeader('Content-Type', doc.mimeType)
    res.setHeader('Content-Disposition', `inline; filename="${doc.fileName}"`)
    res.send(buf)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// DELETE /api/documents/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await prisma.document.delete({ where: { id: req.params.id } })
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
