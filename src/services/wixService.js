import axios from 'axios'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const WIX_BASE = 'https://www.wixapis.com'

function getHeaders() {
  return {
    Authorization: process.env.WIX_API_KEY,
    'wix-site-id': process.env.WIX_SITE_ID,
    'Content-Type': 'application/json'
  }
}

export async function getWixAnalytics(startDate, endDate) {
  try {
    const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const end = endDate || new Date().toISOString().split('T')[0]

    const res = await axios.get(`${WIX_BASE}/analytics/v2/site-analytics`, {
      headers: getHeaders(),
      params: { startDate: start, endDate: end }
    })

    const data = res.data
    const stat = await prisma.wixStat.create({
      data: {
        visiteurs: data.uniqueVisitors || 0,
        pageVues: data.pageViews || 0,
        sessions: data.sessions || 0,
        tauxRebond: data.bounceRate || null,
        sourcesTrafic: data.trafficSources || null,
        raw: data
      }
    })

    return stat
  } catch (e) {
    console.error('Wix analytics error:', e.message)
    throw e
  }
}

export async function getWixContacts() {
  try {
    const res = await axios.get(`${WIX_BASE}/contacts/v4/contacts`, {
      headers: getHeaders(),
      params: { limit: 100, sort: 'createdDate:desc' }
    })
    return res.data.contacts || []
  } catch (e) {
    console.error('Wix contacts error:', e.message)
    throw e
  }
}

export async function getWixForms() {
  try {
    const res = await axios.get(`${WIX_BASE}/forms/v4/submissions`, {
      headers: getHeaders(),
      params: { limit: 50 }
    })
    return res.data.submissions || []
  } catch (e) {
    console.error('Wix forms error:', e.message)
    return []
  }
}

export async function getLatestWixStats() {
  const stats = await prisma.wixStat.findMany({
    orderBy: { date: 'desc' },
    take: 30
  })
  return stats
}
