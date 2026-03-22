import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import authRoutes from './routes/auth.js'
import clientsRoutes from './routes/clients.js'
import affairesRoutes from './routes/affaires.js'
import reclamationsRoutes from './routes/reclamations.js'
import gmailRoutes from './routes/gmail.js'
import wixRoutes from './routes/wix.js'
import socialRoutes from './routes/social.js'
import dashboardRoutes from './routes/dashboard.js'
import { startSyncJobs } from './services/syncService.js'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}))
app.use(express.json())

// Routes
app.use('/api/auth', authRoutes)
app.use('/api/clients', clientsRoutes)
app.use('/api/affaires', affairesRoutes)
app.use('/api/reclamations', reclamationsRoutes)
app.use('/api/gmail', gmailRoutes)
app.use('/api/wix', wixRoutes)
app.use('/api/social', socialRoutes)
app.use('/api/dashboard', dashboardRoutes)

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }))

app.listen(PORT, () => {
  console.log(`CRM Novogarden API running on port ${PORT}`)
  if (process.env.NODE_ENV !== 'test') {
    startSyncJobs()
  }
})

export default app
