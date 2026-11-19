import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { t } from '../lib/i18n.js'
echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer])

export default function AddonTrendChart({ rows, unit = 'kg' }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!ref.current) return
    const plot = echarts.init(ref.current, undefined, { renderer: 'canvas' })
    plot.setOption({
      animation: !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
      grid: { left: 44, right: 10, top: 18, bottom: 28 },
      tooltip: { trigger: 'axis', valueFormatter: v => `${Number(v).toLocaleString()} ${unit}` },
      xAxis: { type: 'category', data: rows.map(r => r.day.slice(5)), axisLabel: { color: '#9aa3ab', interval: Math.max(0, Math.ceil(rows.length / 7) - 1) }, axisTick: { show: false }, axisLine: { lineStyle: { color: '#48505b' } } },
      yAxis: { type: 'value', min: 0, axisLabel: { color: '#9aa3ab' }, splitLine: { lineStyle: { color: '#37414a', opacity: .32 } } },
      series: [{ type: 'bar', name: t('Training volume'), data: rows.map(r => r.volume), barMaxWidth: 20, itemStyle: { color: '#ff6b2c', borderRadius: [5, 5, 0, 0] } }]
    })
    const resize = () => plot.resize()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
    if (observer) observer.observe(ref.current)
    else window.addEventListener('resize', resize)
    return () => { observer?.disconnect(); if (!observer) window.removeEventListener('resize', resize); plot.dispose() }
  }, [rows, unit])
  return <>
    <div ref={ref} className="addon-chart" role="img"
      aria-label={t('Recorded training volume by day across {0} days', rows.length)} />
    <table className="addon-chart-fallback"><caption>{t('Recorded training volume by day')}</caption><thead><tr><th scope="col">{t('Date')}</th><th scope="col">{t('Volume ({0})', unit)}</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.day}><th scope="row">{r.day}</th><td>{r.volume}</td></tr>)}</tbody></table>
  </>
}
