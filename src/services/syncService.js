import cron from 'node-cron'
import { syncGmailEmails } from './gmailService.js'
import { getWixAnalytics } from './wixService.js'
import { getInstagramStats, getFacebookStats, getLinkedInStats } from './socialService.js'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export function startSyncJobs() {
  // Sync Gmail toutes les 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    try {
      const result = await syncGmailEmails(30)
      console.log(`[SYNC Gmail] ${result.newEmails} nouveaux emails, ${result.affairesCreated} affaires créées`)
    } catch (e) {
      console.error('[SYNC Gmail] Erreur:', e.message)
    }
  })

  // Sync stats Wix chaque jour à 7h
  cron.schedule('0 7 * * *', async () => {
    try {
      await getWixAnalytics()
      console.log('[SYNC Wix] Stats mises à jour')
    } catch (e) {
      console.error('[SYNC Wix] Erreur:', e.message)
    }
  })

  // Sync réseaux sociaux chaque jour à 8h
  cron.schedule('0 8 * * *', async () => {
    const syncs = [
      { name: 'Instagram', fn: getInstagramStats },
      { name: 'Facebook', fn: getFacebookStats },
      { name: 'LinkedIn', fn: getLinkedInStats }
    ]
    for (const { name, fn } of syncs) {
      try {
        await fn()
        console.log(`[SYNC ${name}] OK`)
      } catch (e) {
        console.error(`[SYNC ${name}] Erreur: ${e.message}`)
      }
    }
  })

  console.log('[SYNC] Jobs démarrés (Gmail: /30min, Wix+Social: quotidien 7-8h)')
}
