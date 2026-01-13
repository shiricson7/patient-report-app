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

const normalizeAge = (value) => {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const match = trimmed.match(/(\d+(\.\d+)?)/)
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
const REPORTS_ENDPOINT = import.meta.env.VITE_REPORTS_ENDPOINT || '/api/reports'

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
  const [visitFile, setVisitFile] = useState({
    name: '',
    ages: [],
    error: '',
    source: '',
  })
  const [feverFile, setFeverFile] = useState({
    name: '',
    ages: [],
    error: '',
    source: '',
  })
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

  const handleFile = async (file, setter) => {
    if (!file) return
    try {
      const arrayBuffer = await file.arrayBuffer()
      const workbook = XLSX.read(arrayBuffer, { type: 'array' })
      const result = findAgesInWorkbook(workbook)
      const ages = result.ages || []
      const source = result.sheetName ? `${result.sheetName} / ${TARGET_COLUMN_LABEL}` : ''

      if (ages.length === 0) {
        setter({
          name: file.name,
          ages: [],
          error: `D열에서 0~120 사이 숫자 나이 데이터를 찾지 못했습니다.`,
          source: '',
        })
        return
      }

      setter({ name: file.name, ages, error: '', source })
    } catch (error) {
      setter({
        name: file.name,
        ages: [],
        error: '엑셀 파일을 읽지 못했습니다.',
        source: '',
      })
    }
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

  const visitCounts = useMemo(() => buildCounts(visitFile.ages), [visitFile.ages])
  const feverCounts = useMemo(() => buildCounts(feverFile.ages), [feverFile.ages])
  const uploadGroups = useMemo(
    () => combineCounts(visitCounts, feverCounts),
    [visitCounts, feverCounts],
  )
  const uploadTotalVisit = visitFile.ages.length
  const uploadTotalFever = feverFile.ages.length
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
                <p>엑셀 {TARGET_COLUMN_LABEL}의 숫자 나이만 집계합니다.</p>
              </div>
              <span className="panel__chip">즉시 확인</span>
            </div>
            <div className="upload-grid">
              <label className={`upload-card ${visitFile.error ? 'is-error' : ''}`}>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(event) => handleFile(event.target.files?.[0], setVisitFile)}
                />
                <div className="upload-card__top">
                  <UploadCloud size={20} />
                  <div>
                    <strong>총환자수.xlsx</strong>
                    <span>전체 내원 환자 나이 목록</span>
                  </div>
                </div>
                <div className="upload-card__status">
                  <span>{visitFile.name || '파일을 선택하세요'}</span>
                  <span>{visitFile.ages.length ? `${visitFile.ages.length}명` : ''}</span>
                </div>
                {visitFile.source ? (
                  <div className="upload-card__hint">사용: {visitFile.source}</div>
                ) : null}
                {visitFile.error ? (
                  <div className="upload-card__error">
                    <CircleAlert size={16} />
                    {visitFile.error}
                  </div>
                ) : null}
              </label>

              <label className={`upload-card ${feverFile.error ? 'is-error' : ''}`}>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(event) => handleFile(event.target.files?.[0], setFeverFile)}
                />
                <div className="upload-card__top">
                  <UploadCloud size={20} />
                  <div>
                    <strong>발열환자수.xlsx</strong>
                    <span>발열 환자 나이 목록</span>
                  </div>
                </div>
                <div className="upload-card__status">
                  <span>{feverFile.name || '파일을 선택하세요'}</span>
                  <span>{feverFile.ages.length ? `${feverFile.ages.length}명` : ''}</span>
                </div>
                {feverFile.source ? (
                  <div className="upload-card__hint">사용: {feverFile.source}</div>
                ) : null}
                {feverFile.error ? (
                  <div className="upload-card__error">
                    <CircleAlert size={16} />
                    {feverFile.error}
                  </div>
                ) : null}
              </label>
            </div>
            <div className="panel__note">
              <CircleAlert size={18} />
              <span>
                업로드 모드는 파일을 바로 분석해 보여줍니다. 주간 자동 보고서는
                Drive 연동으로 별도 집계됩니다.
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
