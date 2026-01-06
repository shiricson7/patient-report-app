import { useMemo, useState } from 'react'
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

const formatPercent = (value) => `${value.toFixed(1)}%`

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
  const [reportDate, setReportDate] = useState(() => {
    return new Date().toISOString().slice(0, 10)
  })
  const [visitFile, setVisitFile] = useState({
    name: '',
    ages: [],
    error: '',
  })
  const [feverFile, setFeverFile] = useState({
    name: '',
    ages: [],
    error: '',
  })

  const handleFile = async (file, setter) => {
    if (!file) return
    try {
      const arrayBuffer = await file.arrayBuffer()
      const workbook = XLSX.read(arrayBuffer, { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        raw: true,
      })
      const ages = rows
        .map((row) => normalizeAge(row?.[0]))
        .filter((age) => age !== null && age >= 0 && age <= 120)

      if (ages.length === 0) {
        setter({
          name: file.name,
          ages: [],
          error: '숫자 나이 데이터를 찾지 못했습니다.',
        })
        return
      }

      setter({ name: file.name, ages, error: '' })
    } catch (error) {
      setter({
        name: file.name,
        ages: [],
        error: '엑셀 파일을 읽지 못했습니다.',
      })
    }
  }

  const visitCounts = useMemo(() => buildCounts(visitFile.ages), [visitFile.ages])
  const feverCounts = useMemo(() => buildCounts(feverFile.ages), [feverFile.ages])

  const combinedGroups = useMemo(() => {
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
          const feverChild =
            feverGroup.children?.find((item) => item.id === child.id) || {}
          return {
            ...child,
            totalCount: child.count,
            feverCount: feverChild.count || 0,
          }
        }),
      }
    })
  }, [visitCounts, feverCounts])

  const totalVisit = visitFile.ages.length
  const totalFever = feverFile.ages.length
  const overallRatio = totalVisit ? (totalFever / totalVisit) * 100 : 0
  const hasData = totalVisit > 0 || totalFever > 0

  const chartData = useMemo(() => {
    return combinedGroups.map((group) => ({
      label: group.label,
      ratio: group.totalCount ? (group.feverCount / group.totalCount) * 100 : 0,
      feverCount: group.feverCount,
      totalCount: group.totalCount,
    }))
  }, [combinedGroups])

  return (
    <div className="app">
      <div className="container">
        <header className="hero">
          <div className="hero__copy">
            <span className="hero__tag">환자 보고용 웹앱</span>
            <h1>나이대별 내원·발열 환자 보고서</h1>
            <p>
              내원환자수.xlsx와 발열환자.xlsx를 업로드하면 나이대별 통계를
              자동으로 정리합니다.
            </p>
          </div>
          <div className="hero__meta">
            <div className="meta-card">
              <div className="meta-card__label">
                <Calendar size={18} />
                기준일
              </div>
              <input
                type="date"
                value={reportDate}
                onChange={(event) => setReportDate(event.target.value)}
              />
              <span className="meta-card__hint">
                매주 월요일 기준으로 기록하면 비교가 쉬워요.
              </span>
            </div>
            <div className="meta-card">
              <div className="meta-card__label">
                <FileSpreadsheet size={18} />
                파일명 규칙
              </div>
              <span className="meta-card__value">
                <code>YYYY-MM-DD_내원환자수.xlsx</code>
              </span>
              <span className="meta-card__value">
                <code>YYYY-MM-DD_발열환자.xlsx</code>
              </span>
            </div>
          </div>
        </header>

        <section className="panel">
          <div className="panel__header">
            <div>
              <h2>데이터 불러오기</h2>
              <p>엑셀 첫 번째 열의 숫자만 집계하고 머리말은 제외합니다.</p>
            </div>
            <span className="panel__chip">Vercel 배포용</span>
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
                  <strong>내원환자수.xlsx</strong>
                  <span>전체 내원 환자 나이 목록</span>
                </div>
              </div>
              <div className="upload-card__status">
                <span>{visitFile.name || '파일을 선택하세요'}</span>
                <span>{visitFile.ages.length ? `${visitFile.ages.length}명` : ''}</span>
              </div>
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
                  <strong>발열환자.xlsx</strong>
                  <span>발열 환자 나이 목록</span>
                </div>
              </div>
              <div className="upload-card__status">
                <span>{feverFile.name || '파일을 선택하세요'}</span>
                <span>{feverFile.ages.length ? `${feverFile.ages.length}명` : ''}</span>
              </div>
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
              Vercel에서는 로컬 디렉토리를 직접 읽을 수 없습니다. 지금은
              업로드 방식으로 작동하며, 추후 클라우드 저장소 연동으로
              자동화를 확장할 수 있습니다.
            </span>
          </div>
        </section>

        <section className="panel">
          <div className="panel__header">
            <div>
              <h2>보고서</h2>
              <p>나이대별 총 환자수와 발열 환자수를 정리합니다.</p>
            </div>
            <span className="panel__chip">보고서 기준일 {reportDate}</span>
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
              {combinedGroups.map((group) => (
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
                  {group.children.map((child) => (
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
              <p>엑셀 파일을 업로드하면 보고서가 자동으로 채워집니다.</p>
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
