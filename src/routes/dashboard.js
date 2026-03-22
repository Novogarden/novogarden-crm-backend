import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { authMiddleware } from '../middleware/auth.js'

const router = Router()
const prisma = new PrismaClient()
router.use(authMiddleware)

router.get('/', async (req, res) => {
  try {
    const now = new Date()
    const debut30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const debut7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    const [
      totalClients,
      affairesActives,
      affairesMois,
      devisEnAttente,
      reclamationsOuvertes,
      rdvSemaine,
      caFactureMois,
      caEncaisseMois,
      emailsNonTraites,
      recentEmails,
      wixStats,
      socialStats
    ] = await Promise.all([
      prisma.client.count(),

      prisma.affaire.count({
        where: { etape: { notIn: ['PAYE', 'ARCHIVE', 'DEVIS_REFUSE'] } }
      }),

      prisma.affaire.count({
        where: { createdAt: { gte: debut30 } }
      }),

      prisma.affaire.count({
        where: { etape: 'DEVIS_ENVOYE' }
      }),

      prisma.reclamation.count({
        where: { statut: { in: ['OUVERTE', 'EN_COURS'] } }
      }),

      prisma.affaire.count({
        where: {
          etape: 'RDV_PLANIFIE',
          dateRdv: { gte: now, lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) }
        }
      }),

      prisma.affaire.aggregate({
        where: { etape: { in: ['FACTURE_EMISE', 'PAYE'] }, dateFacture: { gte: debut30 } },
        _sum: { montantFacture: true }
      }),

      prisma.affaire.aggregate({
        where: { etape: 'PAYE', datePaiement: { gte: debut30 } },
        _sum: { montantFacture: true }
      }),

      prisma.emailLog.count({ where: { traite: false } }),

      prisma.emailLog.findMany({
        orderBy: { dateEmail: 'desc' },
        take: 5
      }),

      prisma.wixStat.findFirst({ orderBy: { date: 'desc' } }),

      prisma.socialStat.findMany({
        orderBy: { date: 'desc' },
        distinct: ['reseau'],
        take: 3
      })
    ])

    // Évolution CA sur 12 mois
    const caParMois = await prisma.$queryRaw`
      SELECT
        DATE_TRUNC('month', "datePaiement") as mois,
        SUM("montantFacture") as total
      FROM "Affaire"
      WHERE etape = 'PAYE'
        AND "datePaiement" >= NOW() - INTERVAL '12 months'
      GROUP BY mois
      ORDER BY mois ASC
    `

    // Taux de conversion devis -> accepté
    const totalDevisEnvoyes = await prisma.affaire.count({ where: { etape: { in: ['DEVIS_ENVOYE', 'DEVIS_ACCEPTE', 'RDV_PLANIFIE', 'TRAVAUX_EN_COURS', 'FACTURE_EMISE', 'PAYE', 'DEVIS_REFUSE'] } } })
    const totalDevisAcceptes = await prisma.affaire.count({ where: { etape: { in: ['DEVIS_ACCEPTE', 'RDV_PLANIFIE', 'TRAVAUX_EN_COURS', 'FACTURE_EMISE', 'PAYE'] } } })

    res.json({
      kpis: {
        totalClients,
        affairesActives,
        affairesMois,
        devisEnAttente,
        reclamationsOuvertes,
        rdvSemaine,
        caFactureMois: caFactureMois._sum.montantFacture || 0,
        caEncaisseMois: caEncaisseMois._sum.montantFacture || 0,
        emailsNonTraites,
        tauxConversionDevis: totalDevisEnvoyes > 0
          ? Math.round((totalDevisAcceptes / totalDevisEnvoyes) * 100)
          : 0
      },
      caParMois,
      recentEmails,
      wixStats,
      socialStats
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
