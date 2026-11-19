# Skill: диагностика PhaseLab

Если Deploy/страница упала, не угадывать: `npx next typegen`, `npm exec tsc -- --noEmit --pretty false`, `npm run build`, затем открыть `/api/health`, `/api/session`. Ошибки сборки фронтенда и ошибки Python-рендера — разные этапы.

- **TypeScript/Next:** смотреть полный первый stack в `/tmp/next-typegen.log`, `/tmp/tsc.log`, `/tmp/build.log`. Проверить `src/app/page.tsx` и структуры `src/lib/lab-types.ts`.
- **Страница есть, но API 500:** `/api/health`, `DATABASE_URL`, `npx drizzle-kit push`; затем `/api/session`. Не прятать исключения. Если зависимость не импортируется — `PYTHON_BIN`, `.pydeps/`, `python -m pip install -r requirements-runtime.txt`.
- **Отсутствует импортированный WAV:** проверить `.lab-data/imports/u_HASH.wav`, переносить данные с PostgreSQL. У пресета восстановление проверяет исходник и не должно менять сессию при ошибке.
- **Нет звука в «до/после»:** `POST /api/baseline` с `report.channels` и `fft`, проверить `key`, `GET /api/audio?key=<key>` (RIFF WAV), затем браузерный Web Audio decode. Переключение A/B не меняет `audio.src`; запросы не должны постоянно прерываться. Индикатор `data-playing` и `data-source` у `.transport`.
- **Точка EQ не движется:** SVG преобразовывает координаты через `getScreenCTM().inverse()`, pointer ID синхронно хранится в ref; проверить `pointerdown`, `pointermove`, `pointerup`, `pointercancel` и `lostpointercapture`. На touch нужна `touch-action:none` у SVG. Изменение точки не перезапускает Web Audio узлы.
- **Неверное стерео:** `sf.info` должен видеть два канала; `suite.load_track()` не усредняет stereo; только отдельный анализатор `spectrum()` использует mono для обзорной трассы. X05 получает `trackInfo[id].domains` (L/R/M/S) и `msReport` по реальным сигналам. Для mono Side неактивен.
- **Динамический EQ изменяет звук при выключении:** проверить `extensions.dynamic=false`, `depth=0` и инвариант из `tests/test_pipeline.py`. Сравнивать рендер по PCM, а не по субъективному score. `mid=(L+R)/2`, `side=(L-R)/2`, обратная сборка должна совпадать с L/R.
- **Физически подозрительные числа:** проверить sample rate, frames, FFT resolution; 8192/48k = 5.859 Hz/bin, полная 5-сек запись = 0.2 Hz. LRA для коротких отрывков null. Readiness — эвристика, не профессиональная сертификация.

При ошибке обновления не стирать `.lab-data/`, DB или пользовательские WAV. Перед reset сохранить дамп и отпечаток. Последовательность исправления: воспроизвести → добавить регрессионный тест → исправить DSP/UI → проверить тест, typegen, tsc, build, healthcheck → сравнить A/B.
