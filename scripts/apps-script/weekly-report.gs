const CONFIG = {
  timezone: 'Asia/Seoul',
  folderId: '13AxT5x_P-tk51dON_YNmQHv_blVRavVj',
  reportSpreadsheetId: '1P2xA__ttUTyw763wxtGvJS5qBXatV8KQiVI8ksl05GQ',
  reportSheetName: 'weekly_reports',
  fileSuffix: {
    visit: '총환자수.xlsx',
    fever: '발열환자수.xlsx',
  },
  headers: [
    'week_start',
    'week_end',
    'total_visit',
    'total_fever',
    'overall_ratio',
    'groups_json',
    'missing_days',
    'created_at',
  ],
}

const AGE_GROUPS = [
  {
    id: '0-6',
    label: '0-6세',
    range: [0, 6],
    children: [
      { id: '0', label: '0세', range: [0, 0] },
      { id: '1-6', label: '1-6세', range: [1, 6] },
    ],
  },
  {
    id: '7-18',
    label: '7-18세',
    range: [7, 18],
    children: [
      { id: '7-12', label: '7-12세', range: [7, 12] },
      { id: '13-18', label: '13-18세', range: [13, 18] },
    ],
  },
  { id: '19-49', label: '19-49세', range: [19, 49] },
  { id: '50-64', label: '50-64세', range: [50, 64] },
  { id: '65+', label: '65세 이상', range: [65, 120] },
]

function runWeeklyReport() {
  const range = getPreviousWeekRange()
  const aggregated = aggregateWeek(range)
  upsertReportRow(aggregated)
}

function getPreviousWeekRange() {
  const now = new Date()
  const day = now.getDay() // 0=Sun..6=Sat
  const diffToMonday = (day + 6) % 7
  const currentWeekMonday = new Date(now)
  currentWeekMonday.setDate(now.getDate() - diffToMonday)

  const start = new Date(currentWeekMonday)
  start.setDate(currentWeekMonday.getDate() - 7)
  const end = new Date(start)
  end.setDate(start.getDate() + 5)

  const days = []
  for (let offset = 0; offset <= 5; offset += 1) {
    const date = new Date(start)
    date.setDate(start.getDate() + offset)
    days.push(date)
  }

  return { start, end, days }
}

function aggregateWeek(range) {
  const visitAges = []
  const feverAges = []
  const missingDays = new Set()

  range.days.forEach((date) => {
    const dateLabel = formatDate(date)
    const visitFileName = `${dateLabel}_${CONFIG.fileSuffix.visit}`
    const feverFileName = `${dateLabel}_${CONFIG.fileSuffix.fever}`

    const visitFile = findFileByName(CONFIG.folderId, visitFileName)
    if (visitFile) {
      visitAges.push(...extractAgesFromExcel(visitFile))
    } else {
      missingDays.add(dateLabel)
    }

    const feverFile = findFileByName(CONFIG.folderId, feverFileName)
    if (feverFile) {
      feverAges.push(...extractAgesFromExcel(feverFile))
    } else {
      missingDays.add(dateLabel)
    }
  })

  const visitCounts = buildCounts(visitAges)
  const feverCounts = buildCounts(feverAges)
  const combinedGroups = combineCounts(visitCounts, feverCounts)

  const totalVisit = visitAges.length
  const totalFever = feverAges.length
  const overallRatio = totalVisit ? (totalFever / totalVisit) * 100 : 0

  return {
    weekStart: formatDate(range.start),
    weekEnd: formatDate(range.end),
    totalVisit,
    totalFever,
    overallRatio,
    combinedGroups,
    missingDays: Array.from(missingDays).sort(),
    createdAt: formatTimestamp(new Date()),
  }
}

function extractAgesFromExcel(file) {
  const tempFile = Drive.Files.copy(
    {
      title: `tmp_${file.getName()}`,
      mimeType: MimeType.GOOGLE_SHEETS,
    },
    file.getId(),
  )

  const spreadsheet = SpreadsheetApp.openById(tempFile.id)
  const sheets = spreadsheet.getSheets()
  let best = { ages: [], sheetName: '' }

  sheets.forEach((sheet) => {
    const values = sheet.getDataRange().getValues()
    const ages = []
    values.forEach((row) => {
      const age = normalizeAge(row[3])
      if (age !== null && age >= 0 && age <= 120) {
        ages.push(age)
      }
    })
    if (ages.length > best.ages.length) {
      best = { ages, sheetName: sheet.getName() }
    }
  })

  DriveApp.getFileById(tempFile.id).setTrashed(true)
  return best.ages
}

function normalizeAge(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' && isFinite(value)) {
    return Math.floor(value)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const match = trimmed.match(/(\d+(\.\d+)?)/)
    if (!match) return null
    const parsed = Number(match[1])
    if (!isFinite(parsed)) return null
    return Math.floor(parsed)
  }
  return null
}

function buildCounts(ages) {
  const groups = AGE_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    range: group.range,
    count: 0,
    children: (group.children || []).map((child) => ({
      id: child.id,
      label: child.label,
      range: child.range,
      count: 0,
    })),
  }))

  ages.forEach((age) => {
    groups.forEach((group) => {
      if (age >= group.range[0] && age <= group.range[1]) {
        group.count += 1
        group.children.forEach((child) => {
          if (age >= child.range[0] && age <= child.range[1]) {
            child.count += 1
          }
        })
      }
    })
  })

  return groups
}

function combineCounts(visitCounts, feverCounts) {
  return visitCounts.map((group) => {
    const feverGroup = feverCounts.find((item) => item.id === group.id) || {
      count: 0,
      children: [],
    }

    return {
      id: group.id,
      label: group.label,
      totalCount: group.count,
      feverCount: feverGroup.count || 0,
      children: group.children.map((child) => {
        const feverChild = feverGroup.children?.find((item) => item.id === child.id) || {}
        return {
          id: child.id,
          label: child.label,
          totalCount: child.count,
          feverCount: feverChild.count || 0,
        }
      }),
    }
  })
}

function upsertReportRow(result) {
  const spreadsheet = SpreadsheetApp.openById(CONFIG.reportSpreadsheetId)
  const sheet = getOrCreateSheet(spreadsheet)

  const data = sheet.getDataRange().getValues()
  const headerRow = data[0] || CONFIG.headers
  if (!data.length) {
    sheet.appendRow(CONFIG.headers)
  } else if (headerRow.join('|') !== CONFIG.headers.join('|')) {
    sheet.getRange(1, 1, 1, CONFIG.headers.length).setValues([CONFIG.headers])
  }

  const weekStartIndex = CONFIG.headers.indexOf('week_start')
  let targetRow = -1
  for (let i = 1; i < data.length; i += 1) {
    if (data[i][weekStartIndex] === result.weekStart) {
      targetRow = i + 1
      break
    }
  }

  const rowValues = [
    result.weekStart,
    result.weekEnd,
    result.totalVisit,
    result.totalFever,
    result.overallRatio,
    JSON.stringify(result.combinedGroups),
    JSON.stringify(result.missingDays),
    result.createdAt,
  ]

  if (targetRow === -1) {
    sheet.appendRow(rowValues)
  } else {
    sheet.getRange(targetRow, 1, 1, rowValues.length).setValues([rowValues])
  }
}

function getOrCreateSheet(spreadsheet) {
  const existing = spreadsheet.getSheetByName(CONFIG.reportSheetName)
  if (existing) return existing
  return spreadsheet.insertSheet(CONFIG.reportSheetName)
}

function findFileByName(folderId, fileName) {
  const folder = DriveApp.getFolderById(folderId)
  const files = folder.getFilesByName(fileName)
  return files.hasNext() ? files.next() : null
}

function formatDate(date) {
  return Utilities.formatDate(date, CONFIG.timezone, 'yyyy-MM-dd')
}

function formatTimestamp(date) {
  return Utilities.formatDate(date, CONFIG.timezone, 'yyyy-MM-dd HH:mm')
}
