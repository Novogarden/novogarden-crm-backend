import axios from 'axios'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// ── INSTAGRAM / FACEBOOK (Meta Graph API) ──────────────────────────────
export async function getInstagramStats() {
  const token = process.env.META_ACCESS_TOKEN
  const accountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID
  if (!token || !accountId) throw new Error('Instagram non configuré')

  const [profileRes, mediaRes] = await Promise.all([
    axios.get(`https://graph.facebook.com/v19.0/${accountId}`, {
      params: {
        fields: 'followers_count,media_count,profile_views',
        access_token: token
      }
    }),
    axios.get(`https://graph.facebook.com/v19.0/${accountId}/media`, {
      params: {
        fields: 'like_count,comments_count,impressions,reach,timestamp',
        limit: 10,
        access_token: token
      }
    })
  ])

  const profile = profileRes.data
  const media = mediaRes.data.data || []

  const totals = media.reduce((acc, m) => ({
    likes: acc.likes + (m.like_count || 0),
    impressions: acc.impressions + (m.impressions || 0),
    reach: acc.reach + (m.reach || 0)
  }), { likes: 0, impressions: 0, reach: 0 })

  const stat = {
    reseau: 'instagram',
    abonnes: profile.followers_count || 0,
    vues: totals.impressions,
    likes: totals.likes,
    reach: totals.reach,
    raw: { profile, mediaCount: media.length }
  }

  await prisma.socialStat.create({ data: stat })
  return stat
}

export async function getFacebookStats() {
  const token = process.env.META_ACCESS_TOKEN
  const pageId = process.env.FACEBOOK_PAGE_ID
  if (!token || !pageId) throw new Error('Facebook non configuré')

  const res = await axios.get(`https://graph.facebook.com/v19.0/${pageId}`, {
    params: {
      fields: 'fan_count,followers_count,page_views_total,posts{likes.summary(true),shares,impressions}',
      access_token: token
    }
  })

  const data = res.data
  const stat = {
    reseau: 'facebook',
    abonnes: data.fan_count || 0,
    vues: data.page_views_total || 0,
    likes: data.posts?.data?.reduce((s, p) => s + (p.likes?.summary?.total_count || 0), 0) || 0,
    reach: 0,
    raw: data
  }

  await prisma.socialStat.create({ data: stat })
  return stat
}

// ── LINKEDIN ───────────────────────────────────────────────────────────
export async function getLinkedInStats() {
  const token = process.env.LINKEDIN_ACCESS_TOKEN
  if (!token) throw new Error('LinkedIn non configuré')

  const headers = { Authorization: `Bearer ${token}`, 'X-Restli-Protocol-Version': '2.0.0' }

  const orgRes = await axios.get('https://api.linkedin.com/v2/organizationalEntityFollowerStatistics', {
    headers,
    params: { q: 'organizationalEntity', organizationalEntity: `urn:li:organization:${process.env.LINKEDIN_ORG_ID}` }
  })

  const followers = orgRes.data.elements?.[0]?.followerCounts?.organicFollowerCount || 0

  const stat = {
    reseau: 'linkedin',
    abonnes: followers,
    vues: 0,
    likes: 0,
    reach: 0,
    raw: orgRes.data
  }

  await prisma.socialStat.create({ data: stat })
  return stat
}

export async function getLatestSocialStats() {
  const stats = await prisma.socialStat.findMany({
    orderBy: { date: 'desc' },
    take: 90
  })
  return stats
}
