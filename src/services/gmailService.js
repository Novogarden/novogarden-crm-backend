import { google } from 'googleapis'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Mots-clés pour classifier les emails
const KEYWORDS = {
  DEVIS_DEMANDE: ['devis', 'tarif', 'prix', 'combien', 'estimation', 'tonte', 'jardinage', 'robot', 'tondeuse'],
  RDV_DEMANDE: ['rendez-vous', 'rdv', 'rencontrer', 'disponible', 'passage', 'visite'],
  RECLAMATION: ['problème', 'réclamation', 'insatisfait', 'dysfonctionnement', 'remboursement', 'plainte', 'mauvais', 'déçu', 'pas content'],
  PAIEMENT: ['paiement', 'règlement', 'virement', 'payé', 'facture']
}

function classifyEmail(subject, body) {
  const text = (subject + ' ' + body).toLowerCase()
  for (const [type, keywords] of Object.entries(KEYWORDS)) {
    if (keywords.some(kw => text.includes(kw))) return type
  }
  return 'AUTRE'
}

function extractClientInfo(emailBody, from) {
  const emailMatch = from.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/)
  const nameMatch = from.match(/^(.+?)\s*</)
  const phoneMatch = emailBody.match(/(?:0|\+33)[1-9](?:[\s.-]?\d{2}){4}/)

  return {
    email: emailMatch?.[1] || null,
    nom: nameMatch?.[1]?.trim() || emailMatch?.[1]?.split('@')[0] || 'Inconnu',
    telephone: phoneMatch?.[0] || null
  }
}

export async function getGmailClient() {
  const token = await prisma.oAuthToken.findUnique({ where: { service: 'gmail' } })
  if (!token) throw new Error('Gmail non connecté - veuillez autoriser dans les paramètres')

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  )
  oauth2Client.setCredentials({
    access_token: token.accessToken,
    refresh_token: token.refreshToken
  })

  // Auto-refresh si expiré
  oauth2Client.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      await prisma.oAuthToken.update({
        where: { service: 'gmail' },
        data: { accessToken: tokens.access_token }
      })
    }
  })

  return google.gmail({ version: 'v1', auth: oauth2Client })
}

export async function syncGmailEmails(maxResults = 50) {
  const gmail = await getGmailClient()
  const results = { processed: 0, newEmails: 0, affairesCreated: 0 }

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    maxResults,
    q: 'in:inbox newer_than:7d'
  })

  const messages = listRes.data.messages || []

  for (const msg of messages) {
    const existing = await prisma.emailLog.findUnique({ where: { gmailId: msg.id } })
    if (existing) continue

    const full = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' })
    const headers = full.data.payload.headers
    const subject = headers.find(h => h.name === 'Subject')?.value || '(sans objet)'
    const from = headers.find(h => h.name === 'From')?.value || ''
    const dateStr = headers.find(h => h.name === 'Date')?.value
    const body = extractBody(full.data.payload)
    const snippet = full.data.snippet || ''

    const type = classifyEmail(subject, body)
    const dateEmail = dateStr ? new Date(dateStr) : new Date()
    const clientInfo = extractClientInfo(body, from)

    await prisma.emailLog.create({
      data: {
        gmailId: msg.id,
        sujet: subject,
        expediteur: from,
        dateEmail,
        type,
        snippet,
        traite: false
      }
    })

    results.newEmails++

    // Créer automatiquement les réclamations détectées
    if (type === 'RECLAMATION') {
      await prisma.reclamation.create({
        data: {
          clientNom: clientInfo.nom,
          clientEmail: clientInfo.email,
          objet: subject,
          description: snippet,
          emailId: msg.id,
          statut: 'OUVERTE'
        }
      })
    }

    // Créer une affaire pour les demandes de devis
    if (type === 'DEVIS_DEMANDE') {
      let client = clientInfo.email
        ? await prisma.client.findFirst({ where: { email: clientInfo.email } })
        : null

      if (!client) {
        client = await prisma.client.create({
          data: {
            nom: clientInfo.nom,
            email: clientInfo.email,
            telephone: clientInfo.telephone,
            source: 'email'
          }
        })
      }

      await prisma.affaire.create({
        data: {
          titre: subject,
          description: snippet,
          clientId: client.id,
          etape: 'CONTACT',
          emailIds: [msg.id]
        }
      })
      results.affairesCreated++
    }

    results.processed++
  }

  return results
}

function extractBody(payload) {
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8')
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8')
      }
    }
    for (const part of payload.parts) {
      const result = extractBody(part)
      if (result) return result
    }
  }
  return ''
}

export async function getRecentEmails(maxResults = 30) {
  const gmail = await getGmailClient()
  const listRes = await gmail.users.messages.list({
    userId: 'me',
    maxResults,
    q: 'in:inbox'
  })

  const messages = listRes.data.messages || []
  const results = []

  for (const msg of messages.slice(0, 20)) {
    const full = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'metadata',
      metadataHeaders: ['Subject', 'From', 'Date'] })
    const headers = full.data.payload.headers
    results.push({
      id: msg.id,
      subject: headers.find(h => h.name === 'Subject')?.value || '(sans objet)',
      from: headers.find(h => h.name === 'From')?.value || '',
      date: headers.find(h => h.name === 'Date')?.value || '',
      snippet: full.data.snippet || ''
    })
  }

  return results
}
