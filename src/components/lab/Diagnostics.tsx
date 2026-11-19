"use client";
import {
  Crosshair,
  ArrowUpRight,
  ArrowRight,
  ChevronRight,
  Cpu,
  ScanLine,
  SlidersHorizontal,
  GitCompareArrows,
  CheckCheck,
  TriangleAlert,
  Activity,
} from "lucide-react";
import type { LabReport, Issue } from "@/lib/lab-types";
import { frequency } from "@/lib/lab-types";
import { ChannelTag } from "./Instruments";
export function Diagnostics({
  r,
  onIssue,
  onExplore,
  onAgent,
  busy,
}: {
  r: LabReport;
  onIssue: (v: Issue) => void;
  onExplore: () => void;
  onAgent: () => void;
  busy: boolean;
}) {
  return (
    <div className="diagnostics-row">
      <section className="instrument conflict-panel">
        <div className="panel-heading">
          <div className="heading-text">
            <Crosshair />
            <h2>Карта конфликтов</h2>
            <b className="count-badge warm">
              {String(r.issues.length).padStart(2, "0")}
            </b>
          </div>
          <button className="text-action" onClick={onExplore}>
            Диагностика <ArrowUpRight size={12} />
          </button>
        </div>
        <div className="conflict-table-wrap">
          <table className="conflict-table">
            <thead>
              <tr>
                <th>Частота</th>
                <th>Источник</th>
                <th>Тип конфликта</th>
                <th>Приоритет</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {r.issues.map((z, i) => (
                <tr key={z.id} onClick={() => onIssue(z)}>
                  <td>
                    <small className="issue-idx">
                      {String(i + 1).padStart(2, "0")}
                    </small>
                    <b className="freq-val">
                      {frequency(z.hz)}
                      {z.endHz !== z.hz ? "–" + frequency(z.endHz) : ""}{" "}
                      <em>Hz</em>
                    </b>
                  </td>
                  <td>
                    <div className="track-pair">
                      {z.tracks.map((id, i) => (
                        <span key={id}>
                          {i > 0 && <span className="pair-cross">×</span>}
                          <ChannelTag
                            channel={r.channels.find((c) => c.id === id)}
                          />
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="issue-type">{z.title}</td>
                  <td>
                    <span className={`severity ${z.severity}`}>
                      <i />
                      {z.severity === "high" ? "Высокий" : z.severity === "medium" ? "Средний" : "Инфо"}
                    </span>
                  </td>
                  <td>
                    <button
                      className="row-open"
                      aria-label={`Разобрать конфликт ${z.hz} Гц`}
                    >
                      <ChevronRight size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!r.issues.length && (
            <div className="clean-state">
              <CheckCheck />
              Контрольные конфликты не обнаружены
            </div>
          )}
        </div>
      </section>
      <section className="instrument assistant-panel">
        <div className="panel-heading">
          <div className="heading-text">
            <Cpu />
            <h2>Ассистент сведения</h2>
          </div>
          <span className="status-chip">
            <i className="dot mint" />
            Готов
          </span>
        </div>
        <div className="assistant-content">
          <div className="agent-meta">SEMI-AUTOMATIC MODE</div>
          <p>
            {r.issues.length
              ? "Контролируемая коррекция"
              : "Проверка завершена"}
          </p>
          <small className="agent-description">
            Правки на копии микса. Вы принимаете решение.
          </small>
          <div className="agent-flow">
            <span>
              <ScanLine />
              Анализ
            </span>
            <i />
            <span>
              <SlidersHorizontal />
              Коррекция
            </span>
            <i />
            <span>
              <GitCompareArrows />
              A/B
            </span>
          </div>
          <button
            className="agent-button"
            onClick={onAgent}
            disabled={busy || !r.issues.length}
          >
            <Cpu size={14} />
            {r.issues.length ? "Подобрать коррекции" : "Коррекции не требуются"}
            <ArrowRight size={15} />
          </button>
        </div>
      </section>
    </div>
  );
}
export function IssueDetail({
  z,
  r,
  onPreview,
  busy,
}: {
  z: Issue;
  r: LabReport;
  onPreview: () => void;
  busy: boolean;
}) {
  return (
    <div className="issue-details">
      <div className="detail-hero">
        <div className="detail-icon warm">
          <Activity />
        </div>
        <div>
          <span className="eyebrow">CONFLICT INSPECTOR</span>
          <h3>{z.title}</h3>
        </div>
      </div>
      <div className="detail-reading">
        <b>
          {frequency(z.hz)}
          {z.endHz !== z.hz ? "–" + frequency(z.endHz) : ""}
        </b>{" "}
        Hz
        <span className={`severity ${z.severity}`}>
          <i />
          {z.severity === "high" ? "Высокий приоритет" : z.severity === "medium" ? "Средний приоритет" : "Информация"}
        </span>
      </div>
      <div className="detail-channels">
        {z.tracks.map((id) => (
          <ChannelTag key={id} channel={r.channels.find((t) => t.id === id)} />
        ))}
      </div>
      {z.zoom && (
        <div className="micro-scope">
          <div className="micro-scope-title">
            <span>FREQUENCY MICROSCOPE</span>
            <b>Δf {z.zoom.resolution} Hz</b>
          </div>
          <svg
            viewBox="0 0 376 106"
            role="img"
            aria-label="Детальный спектр в окрестности конфликта, разрешение 0.2 Гц"
          >
            <g stroke="#283831" strokeWidth=".65">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <path key={i} d={`M${8 + i * 72} 7V85M8 ${7 + i * 15.6}H368`} />
              ))}
            </g>
            {Object.entries(z.zoom.lines).map(([id, ys]) => {
              const ceil =
                Math.ceil(
                  Math.max(...Object.values(z.zoom!.lines).flat()) / 6,
                ) * 6;
              const x = (i: number) => 8 + (360 * i) / (ys.length - 1);
              const y = (v: number) =>
                8 + Math.min(1, Math.max(0, (ceil - v) / 48)) * 77;
              return (
                <path
                  key={id}
                  d={ys
                    .map(
                      (v, i) =>
                        `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`,
                    )
                    .join(" ")}
                  stroke={r.channels.find((c) => c.id === id)?.color}
                  strokeWidth="1.45"
                  fill="none"
                />
              );
            })}
            <g fill="#8b9f95" fontSize="8.5" fontFamily="monospace">
              {[0, 0.25, 0.5, 0.75, 1].map((k) => (
                <text
                  key={k}
                  x={8 + 360 * k}
                  y="100"
                  textAnchor={k === 0 ? "start" : k === 1 ? "end" : "middle"}
                >
                  {z.zoom!.freqs[Math.round(k * (z.zoom!.freqs.length - 1))]} Hz
                </text>
              ))}
            </g>
          </svg>
        </div>
      )}
      <p className="explanation">{z.reason}</p>
      <div className="measurement-grid">
        {(z.metrics ?? [["Значение", `${z.value} ${z.unit}`], ["Тип", z.type]]).map(([k, v]) => (
          <div key={k}><span>{k}</span><strong>{v}</strong></div>
        ))}
      </div>
      {z.command ? (
        <>
          <h4 className="small-heading">Предлагаемая коррекция</h4>
          <pre className="code-block">{JSON.stringify(z.command, null, 2)}</pre>
          <div className="info-note"><TriangleAlert size={15} /><span>Пробный рендер не меняет исходные стемы. Ориентиры защищены: вырез, задевающий их больше чем на 1 дБ, будет сужен или отклонён.</span></div>
          <button className="btn primary full" onClick={onPreview} disabled={busy}>Проверить коррекцию <ArrowRight size={15} /></button>
        </>
      ) : (
        <div className="info-note"><TriangleAlert size={15} /><span>Автоматической коррекции нет: система не жертвует полезными частотами пользователя. Перенесите один из ориентиров, отметьте полосу у одного из инструментов как нежелательную или измените аранжировку.</span></div>
      )}
    </div>
  );
}
