import crypto from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'
const DEFAULT_SHEET_NAME = 'weekly_reports'
const REPORT_ID_REGEX = /reportSpreadsheetId:\s*['"]([^'"]+)['"]/
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30)
const MS_PER_DAY = 24 * 60 * 60 * 1000
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

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

const readSheetIdFromAppsScript = async () => {
  try {
    const filePath = path.resolve(process.cwd(), 'scripts/apps-script/weekly-report.gs')
    const contents = await readFile(filePath, 'utf8')
    const match = contents.match(REPORT_ID_REGEX)
    return match?.[1] || null
  } catch (error) {
    return null
  }
}

const getSheetId = async () => {
  if (process.env.GOOGLE_SHEETS_ID) return process.env.GOOGLE_SHEETS_ID
  return readSheetIdFromAppsScript()
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

const formatDateParts = (date) => {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return { year, month, day }
}

const serialToKstDate = (value) => {
  const ms = EXCEL_EPOCH_MS + value * MS_PER_DAY + KST_OFFSET_MS
  return new Date(ms)
}

const normalizeDateCell = (value, withTime = false) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = serialToKstDate(value)
    const { year, month, day } = formatDateParts(date)
    if (!withTime) {
      return `${year}-${month}-${day}`
    }
    const hours = String(date.getUTCHours()).padStart(2, '0')
    const minutes = String(date.getUTCMinutes()).padStart(2, '0')
    return `${year}-${month}-${day} ${hours}:${minutes}`
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      const parsed = Number(trimmed)
      if (Number.isFinite(parsed)) {
        return normalizeDateCell(parsed, withTime)
      }
    }
    return trimmed
  }
  return ''
}

const parseReports = (values) => {
  if (!values.length) return []
  const headerRow = values[0]
  const headerIndex = headerRow.reduce((acc, header, index) => {
    acc[String(header).trim()] = index
    return acc
  }, {})

  const getCell = (row, key, fallbackIndex) => {
    const index = headerIndex[key]
    if (index !== undefined) return row[index]
    if (fallbackIndex !== undefined) return row[fallbackIndex]
    return ''
  }

  return values.slice(1).map((row) => {
    const groupsRaw = getCell(row, 'groups_json', 5)
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

    const totalVisit = Number(getCell(row, 'total_visit', 2)) || 0
    const totalFever = Number(getCell(row, 'total_fever', 3)) || 0
    const overallRatioValue = getCell(row, 'overall_ratio', 4)
    const overallRatio = Number.isFinite(Number(overallRatioValue))
      ? Number(overallRatioValue)
      : totalVisit
        ? (totalFever / totalVisit) * 100
        : 0

    return {
      weekStart: normalizeDateCell(getCell(row, 'week_start', 0)),
      weekEnd: normalizeDateCell(getCell(row, 'week_end', 1)),
      totalVisit,
      totalFever,
      overallRatio,
      groups,
      missingDays: parseMissingDays(getCell(row, 'missing_days', 6)),
      createdAt: normalizeDateCell(getCell(row, 'created_at', 7), true),
    }
  })
}

export default async function handler(request, response) {
  try {
    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    const sheetId = await getSheetId()
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
