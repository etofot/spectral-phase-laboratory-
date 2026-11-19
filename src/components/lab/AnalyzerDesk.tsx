"use client";
import { useState } from "react";
import {
  Activity,
  ArrowRight,
  ChevronRight,
  FlaskConical,
  FileJson,
  GitCompareArrows,
  Layers3,
  ScanLine,
} from "lucide-react";
import type { LabReport } from "@/lib/lab-types";
import { frequency, value, signed } from "@/lib/lab-types";
import { ChannelTag } from "./Instruments";
const MODULES = [
  ["A01", "Громкость и динамика", "LUFS · TRUE PEAK"],
  ["A02", "Спектральный профиль", "31 BAND · PEAKS"],
  ["A03", "Огибающая транзиентов", "ATTACK · DECAY"],
  ["A04", "Фазовая стабильность", "L/R · GROUP DELAY"],
  ["A05", "Гармонический состав", "F0 · HARMONICS"],
  ["A06", "Пик-фактор по полосам", "BAND CREST"],
  ["X01", "Противофазная проба", "A+B / A−B"],
  ["X02", "Когерентность Уэлча", "CROSS SPECTRUM"],
  ["X03", "Частотное маскирование", "20 MS WINDOWS"],
  ["X04", "Низкочастотный запас", "20–150 HZ"],
  ["X05", "Стереосовместимость", "MID / SIDE"],
  ["X06", "Готовность микса", "READINESS INDEX"],
];
function Readings({ rows }: { rows: (string | number)[][] }) {
  return (
    <div className="readings-list">
      {rows.map(([k, v]) => (
        <div key={k}>
          <span>{k}</span>
          <b>{v}</b>
        </div>
      ))}
    </div>
  );
}
export default function AnalyzerDesk({
  r,
  initial = 0,
  onPreview,
}: {
  r: LabReport;
  initial?: number;
  onPreview: () => void;
}) {
  const [active, setActive] = useState(initial);
  const [track, setTrack] = useState(r.channels[0].id);
  const [pairIndex, setPairIndex] = useState(
    Math.max(
      0,
      r.pairs.findIndex((p) => p.a === "kick" && p.b === "sub_synth"),
    ),
  );
  const [probeMode, setProbeMode] = useState("sum");
  const m = MODULES[active],
    t = r.trackInfo[track] || r.trackInfo[r.channels[0].id];
  const c = r.channels.find((c) => c.id === track) || r.channels[0];
  const p = r.pairs[Math.min(pairIndex, r.pairs.length - 1)];
  return (
    <div className="analysis-desk">
      <aside className="instrument module-nav">
        <div className="panel-heading">
          <div className="heading-text">
            <Layers3 />
            <h2>Измерители</h2>
          </div>
          <b className="count-badge">12</b>
        </div>
        {MODULES.map(([code, title], i) => (
          <button
            className={active === i ? "active" : ""}
            key={code}
            onClick={() => setActive(i)}
          >
            <span>{code}</span>
            {title}
            <ChevronRight size={12} />
          </button>
        ))}
      </aside>
      <section className="instrument analysis-detail">
        <div className="panel-heading">
          <div className="heading-text">
            <FlaskConical />
            <h2>{m[1]}</h2>
          </div>
          <span className="micro-tag">{m[0]}</span>
        </div>
        <div className="analysis-content">
          <div className="analysis-meta">
            <span className="eyebrow">{m[2]}</span>
            {(active < 6 || active === 10) && (
              <select
                aria-label="Анализируемый канал"
                value={track}
                onChange={(e) => setTrack(e.target.value)}
              >
                {r.channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          {active === 0 && (
            <>
              <h3>Измеренная динамика</h3>
              <Readings
                rows={[
                  ["Интегральная громкость", `${value(t.lufs, 2)} LUFS`],
                  [
                    "Кратковременный максимум, 3 с",
                    `${value(t.shortMax, 2)} LUFS`,
                  ],
                  ["True Peak · 4×", `${value(t.truePeak, 2)} dBTP`],
                  ["Пик-фактор", `${value(t.crest, 2)} dB`],
                  ["Среднеквадратический уровень", `${value(t.rms, 2)} dBFS`],
                  ["LRA", "Н/Д · короткий фрагмент"],
                ]}
              />
              <p className="info-note">
                BS.1770, K-взвешивание, абсолютный и относительный гейты. Для
                LRA пятисекундный фрагмент недостаточен.
              </p>
            </>
          )}
          {active === 1 && (
            <>
              <h3>Третьеоктавный профиль</h3>
              <div className="octave-chart">
                {t.thirdOctave.map((b) => (
                  <div
                    key={b.hz}
                    title={`${b.hz} Hz: ${b.db} dBFS`}
                    style={{
                      height: `${Math.max(2, ((Math.max(-90, b.db) + 90) / 90) * 100)}%`,
                      background: c.color,
                    }}
                  />
                ))}
              </div>
              <div className="scale-labels">
                <span>20 Hz</span>
                <span>1 kHz</span>
                <span>20 kHz</span>
              </div>
              <h4 className="small-heading">
                Узкие пики · разрешение {t.resolution} Hz
              </h4>
              <div className="peak-chips">
                {t.peaks.slice(0, 10).map((p) => (
                  <div key={p.hz}>
                    <b>{frequency(p.hz)} Hz</b>
                    <small>{value(p.db)} dBFS</small>
                  </div>
                ))}
              </div>
            </>
          )}
          {active === 2 && (
            <Readings
              rows={[
                ["Медианная атака", `${t.envelope.attackMs} ms`],
                ["Затухание до 1/e", `${t.envelope.decayMs} ms`],
                ["Отношение сустейна", t.envelope.sustain],
                [
                  "Доля энергии транзиентов",
                  `${(100 * t.envelope.transientRatio).toFixed(1)} %`,
                ],
              ]}
            />
          )}
          {active === 3 && (
            <Readings
              rows={[
                ["Корреляция L/R", signed(t.phase.correlation, 3)],
                ["Корреляция ниже 120 Hz", signed(t.phase.lowCorrelation, 3)],
                ["Корреляция выше 120 Hz", signed(t.phase.highCorrelation, 3)],
                [
                  "Межканальная групповая задержка",
                  `${value(t.phase.groupDelayLRMs, 4)} ms`,
                ],
                ["Стабильность корреляции", value(t.phase.stability, 3)],
              ]}
            />
          )}
          {active === 4 && (
            <>
              <Readings
                rows={[
                  ["Доминирующий тон", `${value(t.harmonics.f0)} Hz`],
                  [
                    "Энергия гармоник / основного тона",
                    value(t.harmonics.harmonicEnergyRatio, 3),
                  ],
                  ["Чётные гармоники", value(t.harmonics.even, 3)],
                  ["Нечётные гармоники", value(t.harmonics.odd, 3)],
                  [
                    "Энергия ниже основного тона",
                    value(t.harmonics.subharmonicRatio, 3),
                  ],
                ]}
              />
              <p className="info-note">
                Гармоническая энергия музыкального сигнала не равнозначна THD
                измерительного синуса.
              </p>
            </>
          )}
          {active === 5 && (
            <Readings
              rows={t.crestBands.map((b) => [
                `${frequency(b.lo)}–${frequency(b.hi)} Hz`,
                `${value(b.crest)} dB`,
              ])}
            />
          )}
          {(active === 6 || active === 7) &&
            (!p ? (
              <p className="muted-copy">
                Включите минимум два канала для парных проверок.
              </p>
            ) : (
              <>
                <label className="field">
                  Пара каналов
                  <select
                    value={pairIndex}
                    onChange={(e) => setPairIndex(+e.target.value)}
                  >
                    {r.pairs.map((p, i) => (
                      <option key={p.a + p.b} value={i}>
                        {r.channels.find((c) => c.id === p.a)?.name} ↔{" "}
                        {r.channels.find((c) => c.id === p.b)?.name}
                      </option>
                    ))}
                  </select>
                </label>
                {active === 6 ? (
                  <>
                    <Readings
                      rows={[
                        [
                          "Сдвиг выравнивания",
                          `${p.lagSamples} samples / ${p.lagMs} ms`,
                        ],
                        ["A+B · RMS после выравнивания", `${p.sumDb} dBFS`],
                        ["A−B · RMS после выравнивания", `${p.diffDb} dBFS`],
                        ["Потеря до выравнивания", `${p.loss} dB @ ${p.hz} Hz`],
                      ]}
                    />
                    <div className="probe-player">
                      <div className="section-heading">
                        <h3>
                          <GitCompareArrows size={14} />
                          Прослушать пробу
                        </h3>
                        <div className="view-tabs">
                          {["sum", "diff"].map((s) => (
                            <button
                              key={s}
                              className={s === probeMode ? "active" : ""}
                              onClick={() => setProbeMode(s)}
                            >
                              {s === "sum" ? "A + B" : "A − B"}
                            </button>
                          ))}
                        </div>
                      </div>
                      <audio
                        controls
                        preload="none"
                        key={r.key + p.a + p.b + probeMode}
                        src={`/api/audio?key=${r.key}&format=probe&a=${p.a}&b=${p.b}&mode=${probeMode}`}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <Readings
                      rows={[
                        [
                          "Когерентность в контрольном бине",
                          p.validBins
                            ? value(p.coherence, 3)
                            : "Н/Д · нет общей энергии",
                        ],
                        ["Центр бина", `${p.hz} Hz`],
                        ["Межканальная фаза", `${p.phase}°`],
                        ["FFT / перекрытие", "8192 / 50 %"],
                      ]}
                    />
                    <h4 className="small-heading">
                      Энергетически значимые бины · Cxy &gt; 0.6
                    </h4>
                    <div className="peak-chips">
                      {p.coherentBins.length
                        ? p.coherentBins.map((f) => <div key={f}>{f} Hz</div>)
                        : "Совпадений нет"}
                    </div>
                    <p className="info-note">
                      Высокая когерентность — не ошибка сама по себе. Для
                      рекомендации требуются также достаточный уровень и
                      деструктивное сложение.
                    </p>
                  </>
                )}
              </>
            ))}
          {active === 8 && (
            <>
              <p className="muted-copy">
                Доля 20-мс окон, где разность уровней пары в одной полосе ниже 6
                дБ. Четыре диапазона; порог активности −55 dBFS.
              </p>
              <Readings
                rows={r.masking.map((p) => [
                  `${p.a} × ${p.b}`,
                  `${Math.round(p.overlap * 100)} %`,
                ])}
              />
            </>
          )}
          {active === 9 && (
            <Readings
              rows={[
                ["Диапазон измерения", "20–150 Hz"],
                ["Пиковый уровень", `${r.lowEnd.peakDb} dBFS`],
                ["RMS", `${r.lowEnd.rmsDb} dBFS`],
                ["Запас по пику", `${r.lowEnd.headroom} dB`],
              ]}
            />
          )}
          {active === 10 && (
            <>
              <Readings
                rows={[
                  ["Mid · RMS", `${r.stereo.midDb} dBFS`],
                  ["Side · RMS", `${r.stereo.sideDb} dBFS`],
                  ["Отношение Side / Mid", r.stereo.width],
                  ["Моносовместимость L/R", signed(r.correlation, 3)],
                ]}
              />
              <h4 className="small-heading">Четыре независимых сигнальных домена</h4>
              <p className="muted-copy">Выберите дорожку выше. Каждая кривая измерена отдельно по её PCM — Left, Right, Mid=(L+R)/2 и Side=(L−R)/2.</p>
              {t.domains && <div className="domain-inspector">
                <div className="domain-correl">L/R корреляция <strong>{signed(t.domains.lrCorrelation, 3)}</strong></div>
                {(["left", "right", "mid", "side"] as const).map((domain) => {
                  const data = t.domains![domain];
                  const colors = { left: "#7ee2bb", right: "#9c9be0", mid: "#f2bd80", side: "#79b2e3" };
                  return <div className="domain-row" key={domain}>
                    <span style={{ color: colors[domain] }}>{domain.toUpperCase()}</span>
                    {data.active ? <><svg viewBox="0 0 96 24" preserveAspectRatio="none" aria-label={`Спектр ${domain}`}><polyline fill="none" stroke={colors[domain]} strokeWidth="1.4" points={data.spectrum.map((v, i) => `${i},${Math.max(1, Math.min(23, 24 - (v + 95) * 0.24))}`).join(" ")} /></svg><b>{value(data.rmsDb)} dBFS</b><small>peak {value(data.peakDb)}</small></> : <em>Нет бокового сигнала — дорожка моно</em>}
                  </div>;
                })}
              </div>}
              <h4 className="small-heading">Перекрытие Side / Mid</h4>
              <p className="muted-copy">
                Доля энергии Side первого стема, совпадающей по частоте с Mid
                второго. Перекрытие само по себе не означает дефект.
              </p>
              <Readings
                rows={(r.stereoCross || []).map((v) => [
                  `${v.side} S → ${v.mid} M`,
                  `${(v.overlap * 100).toFixed(1)} %`,
                ])}
              />
              {r.msReport && (
                <>
                  <h4 className="small-heading">Конфликты по левому каналу</h4>
                  <Readings rows={r.msReport.left?.length ? r.msReport.left.map((p) => [`${p.a} × ${p.b}`, `${p.hz} Hz · Cxy ${p.coherence ?? "—"} · φ ${p.phaseDeg ?? "—"}°`]) : [["Совпадений", "нет"]]} />
                  <h4 className="small-heading">Конфликты по правому каналу</h4>
                  <Readings rows={r.msReport.right?.length ? r.msReport.right.map((p) => [`${p.a} × ${p.b}`, `${p.hz} Hz · Cxy ${p.coherence ?? "—"} · φ ${p.phaseDeg ?? "—"}°`]) : [["Совпадений", "нет"]]} />
                  <h4 className="small-heading">Конфликты в Mid</h4>
                  <Readings rows={r.msReport.mid.length ? r.msReport.mid.map((p) => [`${p.a} × ${p.b}`, `${p.hz} Hz · ${p.gap} dB · Cxy ${p.coherence ?? "—"} · φ ${p.phaseDeg ?? "—"}°`]) : [["Совпадений", "нет"]]} />
                  <h4 className="small-heading">Конфликты в Side</h4>
                  <Readings rows={r.msReport.side.length ? r.msReport.side.map((p) => [`${p.a} × ${p.b}`, `${p.hz} Hz · ${p.gap} dB · Cxy ${p.coherence ?? "—"} · φ ${p.phaseDeg ?? "—"}°`]) : [["Боковых конфликтов", "нет"]]} />
                </>
              )}
              <h4 className="small-heading">Ширина по каналам</h4>
              <Readings
                rows={r.channels.map((c) => [
                  c.name,
                  r.trackInfo[c.id].stereo.width,
                ])}
              />
            </>
          )}
          {active === 11 && (
            <>
              <div className="score-large">
                {r.score}
                <span> / 100</span>
              </div>
              <p className="muted-copy">
                Диагностический индекс тестовой сессии, не оценка
                художественного качества. Учитывает фазовые потери, контрольные
                резонансы и запас до клиппинга.
              </p>
              <Readings
                rows={r.issues.map((z) => [
                  `${z.title} · ${z.hz} Hz`,
                  `−${z.penalty.toFixed(1)}`,
                ])}
              />
              {r.priorities?.total || r.priorities?.avoidTotal ? (
              <>
                {r.priorities.total > 0 && <><h4 className="small-heading">▲ Полезные частоты · цель SMR +{r.priorities.target} dB</h4>
                <Readings rows={r.priorities.rows.map((x) => [`${r.channels.find((c) => c.id === x.track)?.name ?? x.track} · ${frequency(x.freq)} Hz`, `${x.smr > 0 ? "+" : ""}${x.smr} dB ${x.clear ? "· ясно" : `· маскер ${r.channels.find((c) => c.id === x.masker)?.name ?? "—"}`}`])} /></>}
                {(r.priorities.avoidRows?.length ?? 0) > 0 && <><h4 className="small-heading">▼ Нежелательные частоты · доноры при конфликтах</h4>
                <Readings rows={(r.priorities.avoidRows ?? []).map((x) => [`${r.channels.find((c) => c.id === x.track)?.name ?? x.track} · ${frequency(x.freq)} Hz`, `доля ${x.shareDb > 0 ? "+" : ""}${x.shareDb} dB · вырез ${x.cutDb} dB ${x.settled ? "· очищено" : "· ожидает"}`])} /></>}
                {(r.priorities.plan?.length ?? 0) > 0 && <><h4 className="small-heading">План приоритетов при совпадении полос</h4>
                <Readings rows={(r.priorities.plan ?? []).map((x) => [`${frequency(x.hz)} Hz`, x.note])} /></>}
              </>
            ) : <p className="muted-copy">Ориентиры не заданы: двойной клик по дорожке открывает инструктор — до двух полезных и двух нежелательных частот на инструмент (у саба одна полезная).</p>}
            <button
                className="btn primary"
                disabled={!r.issues.length}
                onClick={onPreview}
              >
                Проверить коррекции <ArrowRight size={14} />
              </button>
            </>
          )}
          <div className="analysis-footer">
            <span className="dot mint" />
            ИЗМЕРЕНО ПО PCM{" "}
            <a href={`/api/audio?key=${r.key}&format=json&download=1`} download>
              <FileJson size={12} />
              JSON
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
