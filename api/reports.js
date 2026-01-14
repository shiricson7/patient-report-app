import crypto from 'node:crypto'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'
const DEFAULT_SHEET_NAME = 'weekly_reports'

const base64UrlEncode = (input) => {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

const buildJwt = ({ clientEmail, privateKey }) => {
  const now = Math.floor(Date.now() / 1000)
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64UrlEncode(
    JSON.stringify({
      iss: clientEmail,
      scope: SHEETS_SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 60 * 60,
    }),
  )

  const data = `${header}.${payload}`
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(data)
  signer.end()
  const signature = base64UrlEncode(signer.sign(privateKey))
  return `${data}.${signature}`
}

const fetchAccessToken = async ({ clientEmail, privateKey }) => {
  const jwt = buildJwt({ clientEmail, privateKey })
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Token request failed: ${response.status} ${errorText}`)
  }

  const data = await response.json()
  return data.access_token
}

const fetchSheetValues = async ({ accessToken, sheetId, sheetName }) => {
  const encodedSheetName = encodeURIComponent(sheetName)
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodedSheetName}?valueRenderOption=UNFORMATTED_VALUE`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Sheets API failed: ${response.status} ${errorText}`)
  }

  const data = await response.json()
  return data.values || []
}

const parseMissingDays = (value) => {
  if (!value) return []
  if (Array.isArray(value)) return value
  const text = String(value).trim()
  if (!text) return []
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text)
      return Array.isArray(parsed) ? parsed : []
    } catch (error) {
      return []
    }
  }
  return text.split(',').map((item) => item.trim()).filter(Boolean)
}

const parseReports = (values) => {
  if (!values.length) return []
  const headerRow = values[0]
  const headerIndex = headerRow.reduce((acc, header, index) => {
    acc[String(header).trim()] = index
    return acc
  }, {})

  const getCell = (row, key) => {
    const index = headerIndex[key]
    if (index === undefined) return ''
    return row[index]
  }

  return values.slice(1).map((row) => {
    const groupsRaw = getCell(row, 'groups_json')
    let groups = []
    if (typeof groupsRaw === 'string' && groupsRaw.trim()) {
      try {
        groups = JSON.parse(groupsRaw)
      } catch (error) {
        groups = []
      }
    } else if (Array.isArray(groupsRaw)) {
      groups = groupsRaw
    }

    const totalVisit = Number(getCell(row, 'total_visit')) || 0
    const totalFever = Number(getCell(row, 'total_fever')) || 0
    const overallRatioValue = getCell(row, 'overall_ratio')
    const overallRatio = Number.isFinite(Number(overallRatioValue))
      ? Number(overallRatioValue)
      : totalVisit
        ? (totalFever / totalVisit) * 100
        : 0

    return {
      weekStart: getCell(row, 'week_start'),
      weekEnd: getCell(row, 'week_end'),
      totalVisit,
      totalFever,
      overallRatio,
      groups,
      missingDays: parseMissingDays(getCell(row, 'missing_days')),
      createdAt: getCell(row, 'created_at'),
    }
  })
}

export default async function handler(request, response) {
  try {
    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    const sheetId = process.env.GOOGLE_SHEETS_ID
    const sheetName = process.env.GOOGLE_SHEETS_TAB || DEFAULT_SHEET_NAME

    if (!clientEmail || !privateKey || !sheetId) {
      response.status(500).json({
        error: 'Missing GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, or GOOGLE_SHEETS_ID',
      })
      return
    }

    const accessToken = await fetchAccessToken({ clientEmail, privateKey })
    const values = await fetchSheetValues({ accessToken, sheetId, sheetName })
    const reports = parseReports(values).filter((report) => report.weekStart)
    reports.sort((a, b) => String(b.weekStart).localeCompare(String(a.weekStart)))

    response.setHeader('Cache-Control', 'no-store')
    response.status(200).json({ weeks: reports })
  } catch (error) {
    response.status(500).json({ error: error.message })
  }
}
