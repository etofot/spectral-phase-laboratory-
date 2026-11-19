# PhaseLab — карта проекта

## Дерево рабочих файлов

```text
PhaseLab/
├── src/
│   ├── app/
│   │   ├── page.tsx                 SSR: восстановить сессию или показать reference
│   │   ├── layout.tsx               Метаданные, глобальные стили
│   │   ├── globals.css              Токены, сетки, транспорт
│   │   ├── instruments.css          Приборы, спектр, карточки стемов
│   │   ├── overlays.css             Диалоги, инструктор, отпечатки
│   │   └── api/
│   │       ├── health/route.ts      Проверка PostgreSQL
│   │       ├── session/route.ts     Состояние, ориентиры, процессоры, snapshots
│   │       ├── analyze/route.ts     Измерение и сохранение рендера
│   │       ├── agent/route.ts       Пробное кросс-адаптивное сведение
│   │       ├── baseline/route.ts    Исходный суммарный WAV без обработки
│   │       ├── audio/route.ts       WAV, ZIP, JSON, A±B; поддержка byte ranges
│   │       ├── import/route.ts      Загрузка PCM/float WAV с компьютера
│   │       └── presets/route.ts     Отпечатки: список, save/load/delete
│   ├── components/lab/
│   │   ├── Workspace.tsx            Главная координация микса, снимков, модалок
│   │   ├── Instruments.tsx          Стемы, удалить, meters, фазоскоп
│   │   ├── Spectrum.tsx             Логарифмический спектр и маркеры
│   │   ├── AnchorInstructor.tsx     До 2 GOOD + 2 BAD, loop EQ и drag
│   │   ├── anchor-audio.ts          Web Audio: инструктор, фильтры, кроссфейд
│   │   ├── take-player.ts           Декодирование и переключение A/B
│   │   ├── Transport.tsx            Исходный/обработанный, seek, громкость
│   │   ├── AnalyzerDesk.tsx         12 модулей, L/R и M/S измерения
│   │   ├── Diagnostics.tsx          Карта конфликтов и обоснование
│   │   ├── Dialogs.tsx              Import, EQ strip, preview, export
│   │   └── Presets.tsx              Менеджер отпечатков сессии
│   ├── lib/
│   │   ├── lab-types.ts             JSON-протокол, роли, точки, дисплейные функции
│   │   └── lab-server.ts            Валидация, Python bridge, DB, snapshots
│   └── db/
│       ├── schema.ts                Drizzle-таблицы сессии и пресетов
│       └── index.ts                 PostgreSQL Pool
├── engine/
│   ├── ultra_eq_engine.py          RBJ EQ, all-pass, probe A±B
│   ├── spectral_sieve.py           Комплексный STFT/iSTFT, Norbert adapter
│   ├── dynamic_phase_eq.py         Кросс-адаптивное фазовое сайдчейн-подавление
│   ├── ms.py                       M=(L+R)/2, S=(L−R)/2 и обратное
│   ├── config.py                   Частота, роли, reference-настройки
│   └── render.py                   CLI для одной дорожки
├── analyzers/
│   ├── suite.py                    Чтение WAV → DSP → отчёт → атомарный снимок
│   ├── metrics.py                  LUFS, TP, спектр, стерео L/R/M/S
│   ├── priorities.py               GOOD/BAD, иерархия доноров, masking
│   ├── cli.py                      Общий JSON CLI
│   ├── 01_*.py … 06_*.py           Шесть измерителей отдельного стема
│   └── x01_*.py … x06_*.py         Шесть перекрёстных измерителей
├── agent/agent_loop.py            До 10 проходов; reject ухудшений, JSONL лог
├── tests/
│   ├── generate_synthetic_stems.py  4 конфликтующих float32 WAV
│   ├── test_pipeline.py             CPU-регрессии и физические инварианты
│   ├── browser_smoke.cjs            Полный браузерный сценарий
│   ├── playback_instructor.cjs      A/B, GOOD/BAD, live EQ
│   └── workstation_regression.cjs   Удаление до нуля, постоянный A/B, drag, пресеты
├── fixtures/*.wav                 4 исходных тестовых стема
├── data/reference/                Эталон: mix.wav, стемы, report.json
├── .lab-data/                     Импорт, контентные snapshots, JSONL логи [сохранить!]
├── .pydeps/                       Установленные CPU-зависимости [пересоздаётся]
├── skills/                        Инструкции AI-агенту при переносе
├── examples/before-after.json     Измеренный пример
├── requirements-runtime.txt       Минимум для сервера без GPU
├── requirements.txt               CPU + инструменты
├── requirements-accelerated.txt   Опциональный CUDA стек
├── README.md                      Пользовательская и CLI инструкция
├── AUDIT.md                       Физические ошибки и ограничения
└── drizzle.config.json            Конфигурация push
```

## Сигнальный поток

1. Загрузка WAV → `.lab-data/imports/u_HASH.wav` (исходник не меняется). Пустая сессия допускается.
2. `Workspace` → `/api/analyze` → `lab-server.ts` проверяет настройки → Python `agent_loop.py --stdin` → `suite.measure()`.
3. `suite.load_track()` читает не более 20 секунд 8–192 kHz PCM/float, ресемплирует в 48k и сохраняет L/R; `ultra_eq_engine.py` применяет статические EQ/фазу.
4. При включении — `dynamic_phase_eq.py`: лидер/ведомый по роли и GOOD/BAD, фазово-связанная часть в конфликтной полосе динамически подавляется. При включённом M/S — обработка Mid и Side отдельно и декодирование в L/R.
5. `metrics.py`: BS.1770, TP 4×, спектры L/R/M/S и парные Welch-проверки. `priorities.py` выбирает, кому уступать. Отчёт и **именно измеренный** WAV пишутся атомарно в `.lab-data/renders/<hash>/`.
6. `agent_loop.py` делает гипотезу на копии → измеряет → принимает или отвергает → записывает `.lab-data/logs/<uuid>.jsonl`; UI предлагает A/B и требует явного применения.
7. `/api/baseline` повторно рендерит те же входные стемы **без** EQ, gain, фазы и динамического блока. Кнопки «А исходный / Б после» в транспорте используют преддекодированные `AudioBuffer` с сохранением позиции.
8. `/api/presets` сохраняет конфигурацию в PostgreSQL (`lab_presets_v2`), а не дублирует WAV. Восстановление требует `.lab-data/imports` и `fixtures`.

## Данные и совместимость

- `lab_state_v2`: одна активная локальная сессия и ключ снимка. `lab_history_v2`: хронология. `lab_anchors_v2`: отдельно сохранённые предпочтения. `lab_extensions_v2`: настройки динамики/M/S. `lab_presets_v2`: именованные отпечатки.
- Не публиковать `.env` или `.lab-data`. При переносе копировать `.lab-data/`, `fixtures/`, `data/reference/` **вместе с дампом PostgreSQL**. `.pydeps/` не копировать между OS — переустановить по `requirements-runtime.txt`.
- Служебный reference может быть восстановлен из `tests/generate_synthetic_stems.py` и `agent/agent_loop.py --reference`; импортированные личные WAV восстановить из генератора невозможно.
- Для публичного сервера нужны аутентификация, сессионная изоляция, лимиты CPU и диска; текущая лаборатория локальная, однопользовательская.
