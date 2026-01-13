import { useEffect, useMemo, useState } from 'react'
import {
  Calendar,
  ChartColumn,
  CircleAlert,
  FileSpreadsheet,
  UploadCloud,
} from 'lucide-react'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import * as XLSX from 'xlsx'
import './App.css'

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

const TARGET_COLUMN_INDEX = 3
const TARGET_COLUMN_LABEL = 'D열'
const REPORTS_ENDPOINT = import.meta.env.VITE_REPORTS_ENDPOINT || '/api/reports'
const MAX_FILE_LIST = 6

const buildFileRegex = (suffix) => {
  return new RegExp(`^(\\d{4}-\\d{2}-\\d{2})_${suffix}\\.(xlsx|xls)$`, 'i')
}

const parseDateString = (value) => {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  const date = new Date(year, month - 1, day)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null
  }
  return date
}

const formatDate = (date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const getWeekStartMonday = (date) => {
  const day = date.getDay()
  const diffToMonday = (day + 6) % 7
  const monday = new Date(date)
  monday.setDate(date.getDate() - diffToMonday)
  return monday
}

const buildExpectedWeekDates = (monday) => {
  const dates = []
  for (let offset = 0; offset <= 5; offset += 1) {
    const date = new Date(monday)
    date.setDate(monday.getDate() + offset)
    dates.push(formatDate(date))
  }
  return dates
}

const normalizeAge = (value) => {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const match = trimmed.match(/(\\d+(\\.\\d+)?)/)
    if (!match) return null
    const parsed = Number(match[1])
    if (!Number.isFinite(parsed)) return null
    return Math.floor(parsed)
  }
  return null
}

const findAgesInWorkbook = (workbook) => {
  let best = { ages: [], sheetName: '', count: 0 }
  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: true,
      defval: null,
    })
    const ages = []
    rows.forEach((row) => {
      const age = normalizeAge(row?.[TARGET_COLUMN_INDEX])
      if (age !== null && age >= 0 && age <= 120) {
        ages.push(age)
      }
    })
    if (ages.length > best.count) {
      best = { ages, sheetName, count: ages.length }
    }
  })
  return best
}

const buildCounts = (ages) => {
  const groups = AGE_GROUPS.map((group) => ({
    ...group,
    count: 0,
    children: (group.children || []).map((child) => ({ ...child, count: 0 })),
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

const combineCounts = (visitCounts, feverCounts) => {
  return visitCounts.map((group) => {
    const feverGroup = feverCounts.find((item) => item.id === group.id) || {
      count: 0,
      children: [],
    }

    return {
      ...group,
      totalCount: group.count,
      feverCount: feverGroup.count || 0,
      children: group.children.map((child) => {
        const feverChild = feverGroup.children?.find((item) => item.id === child.id) || {}
        return {
          ...child,
          totalCount: child.count,
          feverCount: feverChild.count || 0,
        }
      }),
    }
  })
}

const formatPercent = (value) => `${value.toFixed(1)}%`
const formatWeekLabel = (report) => `${report.weekStart} ~ ${report.weekEnd}`

const buildUploadWarnings = (files, weekCheck) => {
  const warnings = []
  const invalidNameFiles = files.filter((file) => file.nameIssue === 'pattern')
  const invalidDateFiles = files.filter((file) => file.nameIssue === 'date')
  const readErrors = files.filter((file) => file.error)
  const dateCounts = files.reduce((acc, file) => {
    if (!file.dateString || file.nameIssue) return acc
    acc.set(file.dateString, (acc.get(file.dateString) || 0) + 1)
    return acc
  }, new Map())
  const duplicateDates = Array.from(dateCounts.entries()).filter((entry) => entry[1] > 1)

  if (invalidNameFiles.length) {
    warnings.push(
      `파일명 규칙과 다른 파일: ${invalidNameFiles
        .map((file) => file.name)
        .join(', ')}`,
    )
  }

  if (invalidDateFiles.length) {
    warnings.push(
      `날짜 형식이 올바르지 않은 파일: ${invalidDateFiles
        .map((file) => file.name)
        .join(', ')}`,
    )
  }

  if (readErrors.length) {
    warnings.push(
      `읽기 오류 또는 나이 데이터 없음: ${readErrors
        .map((file) => file.name)
        .join(', ')}`,
    )
  }

  if (duplicateDates.length) {
    warnings.push(
      `같은 날짜 파일이 여러 개 있습니다: ${duplicateDates
        .map(([date, count]) => `${date} (${count}개)`)
        .join(', ')}`,
    )
  }

  if (weekCheck) {
    if (weekCheck.outOfRange.length) {
      warnings.push(
        `다른 주의 파일이 포함되었습니다: ${weekCheck.outOfRange.join(', ')}`,
      )
    }
    if (weekCheck.missingDays.length) {
      warnings.push(
        `누락된 요일 파일: ${weekCheck.missingDays.join(', ')}`,
      )
    }
  }

  return warnings
}

const analyzeWeekDates = (dateStrings) => {
  const uniqueDates = Array.from(new Set(dateStrings))
  if (!uniqueDates.length) return null

  const parsedDates = uniqueDates.map((value) => parseDateString(value)).filter(Boolean)
  if (!parsedDates.length) return null

  parsedDates.sort((a, b) => a - b)
  const weekStart = getWeekStartMonday(parsedDates[0])
  const expectedDates = buildExpectedWeekDates(weekStart)
  const expectedSet = new Set(expectedDates)

  const missingDays = expectedDates.filter((value) => !uniqueDates.includes(value))
  const outOfRange = uniqueDates.filter((value) => !expectedSet.has(value))

  return {
    weekStart: formatDate(weekStart),
    weekEnd: formatDate(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 5)),
    missingDays,
    outOfRange: outOfRange.sort(),
  }
}

const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  const data = payload[0].payload
  return (
    <div className="chart-tooltip">
      <strong>{label}</strong>
      <span>발열 비율: {formatPercent(data.ratio)}</span>
      <span>
        발열/총: {data.feverCount} / {data.totalCount}
      </span>
    </div>
  )
}

function App() {
  const [viewMode, setViewMode] = useState('weekly')
  const [reportDate, setReportDate] = useState(() => {
    return new Date().toISOString().slice(0, 10)
  })
  const [visitUpload, setVisitUpload] = useState({ files: [], ages: [], warnings: [] })
  const [feverUpload, setFeverUpload] = useState({ files: [], ages: [], warnings: [] })
  const [reports, setReports] = useState([])
  const [selectedWeek, setSelectedWeek] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let isMounted = true

    const loadReports = async () => {
      setIsLoading(true)
      setLoadError('')
      try {
        const response = await fetch(REPORTS_ENDPOINT)
        if (!response.ok) {
          throw new Error('보고서 데이터를 불러오지 못했습니다.')
        }
        const data = await response.json()
        const weeks = Array.isArray(data.weeks) ? data.weeks : []
        if (!isMounted) return
        setReports(weeks)
        setSelectedWeek((previous) => previous || (weeks[0]?.weekStart ?? ''))
      } catch (error) {
        if (isMounted) {
          setLoadError(error.message || '보고서 데이터를 불러오지 못했습니다.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    loadReports()

    return () => {
      isMounted = false
    }
  }, [])

  const handleUploadFiles = async (fileList, type, setter) => {
    const files = Array.from(fileList || [])
    if (!files.length) return

    const suffix = type === 'visit' ? '총환자수' : '발열환자수'
    const regex = buildFileRegex(suffix)

    const parsedFiles = await Promise.all(
      files.map(async (file) => {
        let dateString = null
        let nameIssue = ''
        const match = file.name.match(regex)
        if (match) {
          dateString = match[1]
          const parsedDate = parseDateString(dateString)
          if (!parsedDate) {
            nameIssue = 'date'
          }
        } else {
          nameIssue = 'pattern'
        }

        let ages = []
        let error = ''
        let source = ''
        try {
          const arrayBuffer = await file.arrayBuffer()
          const workbook = XLSX.read(arrayBuffer, { type: 'array' })
          const result = findAgesInWorkbook(workbook)
          ages = result.ages || []
          source = result.sheetName ? `${result.sheetName} / ${TARGET_COLUMN_LABEL}` : ''
          if (!ages.length) {
            error = `D열에서 0~120 사이 숫자 나이 데이터를 찾지 못했습니다.`
          }
        } catch (fileError) {
          error = '엑셀 파일을 읽지 못했습니다.'
        }

        return {
          name: file.name,
          dateString,
          nameIssue,
          ages,
          error,
          source,
        }
      }),
    )

    const sortedFiles = [...parsedFiles].sort((a, b) => {
      const dateA = a.dateString ? parseDateString(a.dateString) : null
      const dateB = b.dateString ? parseDateString(b.dateString) : null
      if (dateA && dateB) {
        return dateA - dateB
      }
      if (dateA) return -1
      if (dateB) return 1
      return a.name.localeCompare(b.name)
    })

    const validDates = parsedFiles
      .filter((file) => file.dateString && file.nameIssue !== 'pattern')
      .map((file) => file.dateString)

    const weekCheck = analyzeWeekDates(validDates)
    const warnings = buildUploadWarnings(parsedFiles, weekCheck)

    setter({
      files: sortedFiles,
      ages: parsedFiles.flatMap((file) => file.ages || []),
      warnings,
      weekCheck,
    })
  }

  const selectedReport = useMemo(() => {
    if (!reports.length) return null
    return reports.find((report) => report.weekStart === selectedWeek) || reports[0]
  }, [reports, selectedWeek])

  const weeklyGroups = selectedReport?.groups || []
  const weeklyTotalVisit = selectedReport?.totalVisit || 0
  const weeklyTotalFever = selectedReport?.totalFever || 0
  const weeklyOverallRatio = Number.isFinite(selectedReport?.overallRatio)
    ? selectedReport.overallRatio
    : weeklyTotalVisit
      ? (weeklyTotalFever / weeklyTotalVisit) * 100
      : 0

  const visitCounts = useMemo(() => buildCounts(visitUpload.ages), [visitUpload.ages])
  const feverCounts = useMemo(() => buildCounts(feverUpload.ages), [feverUpload.ages])
  const uploadGroups = useMemo(
    () => combineCounts(visitCounts, feverCounts),
    [visitCounts, feverCounts],
  )
  const uploadTotalVisit = visitUpload.ages.length
  const uploadTotalFever = feverUpload.ages.length
  const uploadOverallRatio = uploadTotalVisit
    ? (uploadTotalFever / uploadTotalVisit) * 100
    : 0

  const activeGroups = viewMode === 'weekly' ? weeklyGroups : uploadGroups
  const totalVisit = viewMode === 'weekly' ? weeklyTotalVisit : uploadTotalVisit
  const totalFever = viewMode === 'weekly' ? weeklyTotalFever : uploadTotalFever
  const overallRatio = viewMode === 'weekly' ? weeklyOverallRatio : uploadOverallRatio
  const hasData = totalVisit > 0 || totalFever > 0
  const missingDays = viewMode === 'weekly' ? selectedReport?.missingDays || [] : []

  const chartData = useMemo(() => {
    if (!activeGroups.length) return []
    return activeGroups.map((group) => ({
      label: group.label,
      ratio: group.totalCount ? (group.feverCount / group.totalCount) * 100 : 0,
      feverCount: group.feverCount,
      totalCount: group.totalCount,
    }))
  }, [activeGroups])

  const visitFileCount = visitUpload.files.length
  const feverFileCount = feverUpload.files.length

  return (
    <div className="app">
      <div className="container">
        <header className="hero">
          <div className="hero__copy">
            <span className="hero__tag">환자 보고용 웹앱</span>
            <h1>나이대별 내원·발열 환자 보고서</h1>
            <p>
              Drive 자동 집계 데이터 또는 직접 업로드한 엑셀로 즉시 통계를
              확인합니다.
            </p>
          </div>
          <div className="hero__meta">
            <div className="meta-card">
              <div className="meta-card__label">
                <Calendar size={18} />
                {viewMode === 'weekly' ? '보고서 주간' : '기준일'}
              </div>
              {viewMode === 'weekly' ? (
                <span className="meta-card__value">
                  {selectedReport ? formatWeekLabel(selectedReport) : '데이터 없음'}
                </span>
              ) : (
                <input
                  type="date"
                  value={reportDate}
                  onChange={(event) => setReportDate(event.target.value)}
                />
              )}
              <span className="meta-card__hint">
                {viewMode === 'weekly'
                  ? '매주 화요일 01:00 자동 집계'
                  : '수동 업로드용 기준일'}
              </span>
            </div>
            <div className="meta-card">
              <div className="meta-card__label">
                <FileSpreadsheet size={18} />
                파일명 규칙
              </div>
              <span className="meta-card__value">
                <code>YYYY-MM-DD_총환자수.xlsx</code>
              </span>
              <span className="meta-card__value">
                <code>YYYY-MM-DD_발열환자수.xlsx</code>
              </span>
            </div>
          </div>
        </header>

        <section className="panel">
          <div className="panel__header">
            <div>
              <h2>데이터 소스</h2>
              <p>주간 자동 집계 또는 수동 업로드 중에서 선택합니다.</p>
            </div>
            <span className="panel__chip">모드 선택</span>
          </div>
          <div className="mode-toggle">
            <button
              type="button"
              className={viewMode === 'weekly' ? 'is-active' : ''}
              aria-pressed={viewMode === 'weekly'}
              onClick={() => setViewMode('weekly')}
            >
              자동 주간 보고서
            </button>
            <button
              type="button"
              className={viewMode === 'upload' ? 'is-active' : ''}
              aria-pressed={viewMode === 'upload'}
              onClick={() => setViewMode('upload')}
            >
              파일 업로드
            </button>
          </div>
          <p className="mode-toggle__hint">
            자동 보고서는 Drive 업로드 파일을 주간(월~토)으로 합산하며, 업로드
            모드는 즉시 확인용입니다.
          </p>
        </section>

        {viewMode === 'weekly' ? (
          <section className="panel">
            <div className="panel__header">
              <div>
                <h2>주간 보고서 선택</h2>
                <p>월~토 파일을 모아 주간 합계로 보고서를 만듭니다.</p>
              </div>
              <span className="panel__chip">자동 집계</span>
            </div>
            <div className="week-selector">
              <label className="week-selector__field">
                <span>보고서 주간</span>
                <select
                  value={selectedWeek}
                  onChange={(event) => setSelectedWeek(event.target.value)}
                  disabled={isLoading || !reports.length}
                >
                  {reports.map((report) => (
                    <option key={report.weekStart} value={report.weekStart}>
                      {formatWeekLabel(report)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="week-selector__meta">
                <span>총 보고서 {reports.length}건</span>
                {selectedReport?.createdAt ? (
                  <span>최근 집계 {selectedReport.createdAt}</span>
                ) : null}
              </div>
            </div>
            {isLoading ? (
              <div className="panel__note">
                <FileSpreadsheet size={18} />
                <span>보고서를 불러오는 중입니다.</span>
              </div>
            ) : null}
            {loadError ? (
              <div className="panel__note panel__note--error">
                <CircleAlert size={18} />
                <span>{loadError}</span>
              </div>
            ) : null}
            {!isLoading && !loadError && !reports.length ? (
              <div className="empty-state">
                <FileSpreadsheet size={28} />
                <p>아직 저장된 주간 보고서가 없습니다.</p>
              </div>
            ) : null}
            {missingDays.length ? (
              <div className="panel__note">
                <CircleAlert size={18} />
                <span>
                  다음 날짜 파일이 없어 0으로 처리했습니다:{' '}
                  {missingDays.join(', ')}
                </span>
              </div>
            ) : null}
          </section>
        ) : (
          <section className="panel">
            <div className="panel__header">
              <div>
                <h2>데이터 불러오기</h2>
                <p>요일별 여러 파일을 업로드하면 자동으로 합산합니다.</p>
              </div>
              <span className="panel__chip">즉시 확인</span>
            </div>
            <div className="upload-grid">
              <label className={`upload-card ${visitUpload.warnings.length ? 'is-error' : ''}`}>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  multiple
                  onChange={(event) =>
                    handleUploadFiles(event.target.files, 'visit', setVisitUpload)
                  }
                />
                <div className="upload-card__top">
                  <UploadCloud size={20} />
                  <div>
                    <strong>총환자수 파일들</strong>
                    <span>월~토 내원 환자 나이 목록</span>
                  </div>
                </div>
                <div className="upload-card__status">
                  <span>
                    {visitFileCount
                      ? `${visitFileCount}개 파일 선택`
                      : '파일을 선택하세요'}
                  </span>
                  <span>{visitUpload.ages.length ? `${visitUpload.ages.length}명` : ''}</span>
                </div>
                {visitUpload.files.length ? (
                  <div className="upload-card__list">
                    {visitUpload.files.slice(0, MAX_FILE_LIST).map((file) => (
                      <div
                        key={file.name}
                        className={`upload-card__file ${
                          file.error || file.nameIssue ? 'is-error' : ''
                        }`}
                      >
                        <div>
                          <span className="upload-card__file-name">{file.name}</span>
                          {file.dateString ? (
                            <span className="upload-card__file-date">{file.dateString}</span>
                          ) : null}
                          {file.nameIssue === 'pattern' ? (
                            <span className="upload-card__file-note">파일명 규칙 불일치</span>
                          ) : null}
                          {file.nameIssue === 'date' ? (
                            <span className="upload-card__file-note">날짜 형식 오류</span>
                          ) : null}
                          {file.error ? (
                            <span className="upload-card__file-note">{file.error}</span>
                          ) : null}
                        </div>
                        <span>{file.ages.length ? `${file.ages.length}명` : '0명'}</span>
                      </div>
                    ))}
                    {visitUpload.files.length > MAX_FILE_LIST ? (
                      <div className="upload-card__more">
                        외 {visitUpload.files.length - MAX_FILE_LIST}개 파일
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {visitUpload.warnings.map((warning, index) => (
                  <div key={`${warning}-${index}`} className="upload-card__warning">
                    <CircleAlert size={14} />
                    <span>{warning}</span>
                  </div>
                ))}
              </label>

              <label className={`upload-card ${feverUpload.warnings.length ? 'is-error' : ''}`}>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  multiple
                  onChange={(event) =>
                    handleUploadFiles(event.target.files, 'fever', setFeverUpload)
                  }
                />
                <div className="upload-card__top">
                  <UploadCloud size={20} />
                  <div>
                    <strong>발열환자수 파일들</strong>
                    <span>월~토 발열 환자 나이 목록</span>
                  </div>
                </div>
                <div className="upload-card__status">
                  <span>
                    {feverFileCount
                      ? `${feverFileCount}개 파일 선택`
                      : '파일을 선택하세요'}
                  </span>
                  <span>{feverUpload.ages.length ? `${feverUpload.ages.length}명` : ''}</span>
                </div>
                {feverUpload.files.length ? (
                  <div className="upload-card__list">
                    {feverUpload.files.slice(0, MAX_FILE_LIST).map((file) => (
                      <div
                        key={file.name}
                        className={`upload-card__file ${
                          file.error || file.nameIssue ? 'is-error' : ''
                        }`}
                      >
                        <div>
                          <span className="upload-card__file-name">{file.name}</span>
                          {file.dateString ? (
                            <span className="upload-card__file-date">{file.dateString}</span>
                          ) : null}
                          {file.nameIssue === 'pattern' ? (
                            <span className="upload-card__file-note">파일명 규칙 불일치</span>
                          ) : null}
                          {file.nameIssue === 'date' ? (
                            <span className="upload-card__file-note">날짜 형식 오류</span>
                          ) : null}
                          {file.error ? (
                            <span className="upload-card__file-note">{file.error}</span>
                          ) : null}
                        </div>
                        <span>{file.ages.length ? `${file.ages.length}명` : '0명'}</span>
                      </div>
                    ))}
                    {feverUpload.files.length > MAX_FILE_LIST ? (
                      <div className="upload-card__more">
                        외 {feverUpload.files.length - MAX_FILE_LIST}개 파일
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {feverUpload.warnings.map((warning, index) => (
                  <div key={`${warning}-${index}`} className="upload-card__warning">
                    <CircleAlert size={14} />
                    <span>{warning}</span>
                  </div>
                ))}
              </label>
            </div>
            <div className="panel__note">
              <CircleAlert size={18} />
              <span>
                여러 파일은 자동 합산됩니다. 누락 요일이나 파일명 규칙 오류가
                있으면 경고가 표시됩니다.
              </span>
            </div>
          </section>
        )}

        <section className="panel">
          <div className="panel__header">
            <div>
              <h2>보고서</h2>
              <p>나이대별 총 환자수와 발열 환자수를 정리합니다.</p>
            </div>
            <span className="panel__chip">
              {viewMode === 'weekly'
                ? selectedReport
                  ? `보고서 주간 ${formatWeekLabel(selectedReport)}`
                  : '보고서'
                : `기준일 ${reportDate}`}
            </span>
          </div>
          <div className="summary-grid">
            <div className="summary-card">
              <span>총 내원 환자수</span>
              <strong>{totalVisit.toLocaleString()}</strong>
            </div>
            <div className="summary-card">
              <span>총 발열 환자수</span>
              <strong>{totalFever.toLocaleString()}</strong>
            </div>
            <div className="summary-card">
              <span>전체 발열 비율</span>
              <strong>{formatPercent(overallRatio)}</strong>
            </div>
          </div>

          {hasData ? (
            <div className="report-table">
              <div className="report-row report-row--head">
                <span>구분</span>
                <span>총 환자수</span>
                <span>발열 환자수</span>
                <span>발열 비율</span>
              </div>
              {activeGroups.map((group) => (
                <div key={group.id} className="report-group">
                  <div className="report-row report-row--group">
                    <span>{group.label}</span>
                    <span>{group.totalCount}</span>
                    <span>{group.feverCount}</span>
                    <span>
                      {group.totalCount
                        ? formatPercent((group.feverCount / group.totalCount) * 100)
                        : '0.0%'}
                    </span>
                  </div>
                  {group.children?.map((child) => (
                    <div key={child.id} className="report-row report-row--child">
                      <span>{child.label}</span>
                      <span>{child.totalCount}</span>
                      <span>{child.feverCount}</span>
                      <span>
                        {child.totalCount
                          ? formatPercent((child.feverCount / child.totalCount) * 100)
                          : '0.0%'}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <FileSpreadsheet size={28} />
              <p>보고서 데이터가 준비되면 표가 자동으로 채워집니다.</p>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel__header">
            <div>
              <h2>발열 비율 차트</h2>
              <p>상위 나이대 기준으로 발열 비율을 확인합니다.</p>
            </div>
            <span className="panel__chip">
              <ChartColumn size={16} />
              인터랙티브 차트
            </span>
          </div>
          {hasData ? (
            <div className="chart-card">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData}>
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="ratio" fill="var(--accent)" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="empty-state">
              <ChartColumn size={28} />
              <p>데이터가 준비되면 차트가 표시됩니다.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

export default App
