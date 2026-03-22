import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { PrismaClient } from '@prisma/client'
import { google } from 'googleapis'

const router = Router()
const prisma = new PrismaClient()

router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) return res.status(400).json({ error: 'Email déjà utilisé' })

    const hashed = await bcrypt.hash(password, 10)
    const user = await prisma.user.create({ data: { email, password: hashed, name } })
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' })
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) return res.status(401).json({ error: 'Identifiants invalides' })

    const valid = await bcrypt.compare(password, user.password)
    if (!valid) return res.status(401).json({ error: 'Identifiants invalides' })

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' })
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/google', (req, res) => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  )
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/calendar.readonly'
    ]
  })
  res.redirect(url)
})

router.get('/google/callback', async (req, res) => {
  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    )
    const { tokens } = await oauth2Client.getToken(req.query.code)
    await prisma.oAuthToken.upsert({
      where: { service: 'gmail' },
      create: {
        service: 'gmail',
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null
      },
      update: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || undefined,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null
      }
    })
    res.redirect(`${process.env.FRONTEND_URL}/settings?gmail=connected`)
  } catch (e) {
    res.redirect(`${process.env.FRONTEND_URL}/settings?gmail=error`)
  }
})

export default router
